"""What a game runs on, read from PE headers, the Proton prefix and /proc."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import game_environment
import trainer_events


def pe(path: Path, *, managed: bool, wide: bool = False):
    """A minimal PE file; `managed` sets the CLR runtime header directory."""
    data = bytearray(1024)
    data[:2] = b"MZ"
    data[60:64] = (128).to_bytes(4, "little")
    data[128:132] = b"PE\0\0"
    optional = 128 + 24
    data[optional:optional + 2] = (0x20B if wide else 0x10B).to_bytes(2, "little")
    if managed:
        entry = optional + (112 if wide else 96) + 14 * 8
        data[entry:entry + 4] = (0x2008).to_bytes(4, "little")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(data))


class GameEnvironmentTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_a_dotnet_framework_game_is_told_from_a_native_one(self):
        pe(self.root / "net.exe", managed=True)
        pe(self.root / "net64.exe", managed=True, wide=True)
        pe(self.root / "native.exe", managed=False)
        (self.root / "text.exe").write_text("not a program")
        self.assertEqual([game_environment.managed(self.root / name) for name in ("net.exe", "net64.exe", "native.exe", "text.exe")],
                         [True, True, False, False])

    def test_before_the_start_the_game_folder_and_prefix_are_read(self):
        steamapps = self.root / "steamapps"
        game = steamapps / "common" / "Game"
        pe(game / "Game.exe", managed=True)
        pe(game / "CrashReporter.exe", managed=False)
        prefix = steamapps / "compatdata" / "413150" / "pfx"
        framework = prefix / "drive_c" / "windows" / "Microsoft.NET" / "Framework" / "v4.0.30319"
        framework.mkdir(parents=True)
        with patch.object(game_environment.steam_library, "find_game", return_value={"game_directory": str(game)}), \
                patch.object(game_environment.steam_library, "_library_folders", return_value=[str(steamapps)]), \
                patch.object(game_environment.steam_library, "_steam_root", return_value=None):
            self.assertEqual(game_environment.prelaunch("413150"), {"managed": True, "prefix": True, "ms_dotnet": False})
            (framework / "clr.dll").write_bytes(b"MZ")
            # Microsoft's runtime is installed, but Wine's own mscoree still picks Wine Mono.
            system32 = prefix / "drive_c" / "windows" / "system32"
            system32.mkdir(parents=True)
            (system32 / "mscoree.dll").write_bytes(b"MZ" + b"\0" * 62 + b"Wine builtin DLL")
            self.assertFalse(game_environment.prelaunch("413150")["ms_dotnet"])
            (system32 / "mscoree.dll").write_bytes(b"MZ" + b"\0" * 100)
            self.assertTrue(game_environment.prelaunch("413150")["ms_dotnet"])

    def test_the_running_game_shows_what_it_loaded(self):
        proc = self.root / "proc"
        tool = self.root / "Proton" / "files"
        (tool / "share" / "wine" / "mono" / "wine-mono-11.2.0").mkdir(parents=True)
        trainer = self.root / "Trainer.exe"
        pe(trainer, managed=True)
        game = proc / "40"
        game.mkdir(parents=True)
        (game / "cmdline").write_bytes(b"Z:\\games\\Game.exe\0")
        (game / "environ").write_bytes(f"SteamAppId=413150\0WINEDLLPATH={tool}/lib/vkd3d:{tool}/lib/wine\0".encode())
        (game / "statm").write_text("100 50")
        (game / "maps").write_bytes(b"7f0 r-xp 0 0:0 0 /p/share/wine/mono/wine-mono-11.2.0/lib/mono/4.5/mscorlib.dll\n")
        (game / "exe").write_bytes(b"\x7fELF\x01")
        facts = game_environment.runtime("413150", [str(trainer)], proc)
        self.assertEqual(facts, {"wine_mono": "11.2.0", "ms_clr": False, "elf32": True, "tool_mono": "11.2.0",
                                 "managed_trainers": ["Trainer.exe"]})
        # Without a process of the game, there is nothing to read.
        self.assertIsNone(game_environment.runtime("620", [], proc))

    def test_a_game_that_reports_another_steam_id_is_found_by_its_reaper(self):
        proc = self.root / "proc"
        zero = bytes(1)
        processes = (
            (10, 1, "reaper", zero.join([b"reaper", b"SteamLaunch", b"AppId=2334159533"]), b""),
            (20, 10, "Game.exe", rb"Z:\g\Game.exe" + zero, b"SteamAppId=105600" + zero),
        )
        for pid, parent, comm, cmdline, environ in processes:
            folder = proc / str(pid)
            folder.mkdir(parents=True)
            (folder / "comm").write_text(comm + "\n")
            (folder / "stat").write_text(f"{pid} ({comm}) S {parent} 0 0")
            (folder / "cmdline").write_bytes(cmdline)
            (folder / "environ").write_bytes(environ)
            (folder / "statm").write_text("10 5")
            (folder / "maps").write_bytes(b"")
        self.assertIsNotNone(game_environment.runtime("2334159533", [], proc))
        self.assertEqual(trainer_events.steam_launches(proc), ["2334159533"])


if __name__ == "__main__":
    unittest.main()
