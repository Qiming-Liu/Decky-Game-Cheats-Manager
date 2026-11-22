"""Finding the game's window among the trainers' (values seen on a ROG Xbox Ally X, 2026-11-21)."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import game_window


class GameWindowTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.proc = Path(temporary.name)

    def process(self, pid, words, pages, app="2211630218"):
        folder = self.proc / str(pid)
        folder.mkdir()
        (folder / "environ").write_bytes(f"HOME=/home/deck\0SteamGameId={app}\0".encode())
        (folder / "cmdline").write_bytes("\0".join(words).encode() + b"\0")
        (folder / "statm").write_bytes(f"{pages * 2} {pages} 0 0 0 0 0".encode())

    def test_game_window_is_found_and_a_trainer_in_front_is_noticed(self):
        self.process(26632, [r"Z:\home\deck\DeckyGCM\CE\cheatengine-x86_64-SSE4-AVX2.exe", r"Z:\t\Table.ct"], 900)
        self.process(26611, [r"Z:\home\deck\Games\Sekiro\sekiro.exe"], 800)
        self.process(26700, [r"Z:\home\deck\Games\Sekiro\Launcher.exe"], 50)
        self.process(26800, [r"Z:\home\deck\DeckyGCM\Sekiro Trainer\Trainer.exe"], 300)
        seen = {
            "GAMESCOPE_FOCUSED_WINDOW": [41943045],
            "GAMESCOPE_FOCUSABLE_WINDOWS": [41943045, 2211630218, 26632, 37748737, 2211630218, 26611,
                                            37748990, 2211630218, 26700, 37749000, 2211630218, 26800,
                                            31457333, 769, 22608],
        }
        programs = ["/home/deck/DeckyGCM/[CT] Sekiro/Table.ct", "/home/deck/DeckyGCM/Sekiro Trainer/Trainer.exe"]
        read = lambda display: seen if display == ":0" else {}
        self.assertEqual(game_window.windows("2211630218", programs, self.proc, read),
                         {"game": 37748737, "focused": 41943045, "trainer_in_front": True})
        seen["GAMESCOPE_FOCUSED_WINDOW"] = [37748737]
        self.assertFalse(game_window.windows("2211630218", programs, self.proc, read)["trainer_in_front"])
        # Another app's windows, or no gamescope at all, give nothing to switch to.
        self.assertEqual(game_window.windows("42", programs, self.proc, read)["game"], 0)
        self.assertEqual(game_window.windows("42", programs, self.proc, lambda display: {}),
                         {"game": 0, "focused": 0, "trainer_in_front": False})

    def test_processes_are_ranked_window_first_then_steams_program_then_memory(self):
        app = "42"
        none = lambda display: {}
        self.assertEqual(game_window.candidates(app, [], self.proc, none), [])
        self.process(10, ["reaper", "SteamLaunch", "AppId=42", "--", "proton", "waitforexitandrun", "/g/Launcher.exe"], 10, app)
        self.process(11, [r"C:\windows\system32\steam.exe", r"Z:\g\Launcher.exe"], 30, app)
        self.process(12, [r"Z:\g\Launcher.exe"], 50, app)
        self.process(13, [r"Z:\g\Game-Win64-Shipping.exe", "-dx12"], 800, app)
        self.process(14, [r"Z:\g\CrashReporter.exe"], 900, app)
        self.process(15, [r"Z:\l\CE\cheatengine-x86_64.exe", r"Z:\t\Table.CT"], 5000, app)
        self.process(16, [r"Z:\l\Trainer\Trainer.exe"], 3000, app)
        self.process(17, [r"C:\windows\system32\explorer.exe", "/desktop"], 70, app)
        self.process(18, [r"Z:\other\Other.exe"], 9000, "7")
        programs = ["/l/Trainer/Trainer.exe", "/l/CT/Table.CT"]
        # Without gamescope: Steam's own program first, then by memory.
        names = [row["name"] for row in game_window.candidates(app, programs, self.proc, none)]
        self.assertEqual(names, ["Launcher.exe", "CrashReporter.exe", "Game-Win64-Shipping.exe"])
        # The process whose window gamescope lists comes first, whatever its size.
        seen = {"GAMESCOPE_FOCUSED_WINDOW": [5], "GAMESCOPE_FOCUSABLE_WINDOWS": [5, 42, 15, 6, 42, 13]}
        rows = game_window.candidates(app, programs, self.proc, lambda display: seen if display == ":0" else {})
        self.assertEqual([row["name"] for row in rows], ["Game-Win64-Shipping.exe", "Launcher.exe", "CrashReporter.exe"])
        self.assertEqual((rows[0]["window"], rows[1]["launched"], rows[0]["memory"]), (True, True, 800 * 4096 // 1048576))
        with self.assertRaises(ValueError):
            game_window.candidates("", programs, self.proc, none)

    def test_a_non_steam_shortcuts_processes_are_found_by_its_app_id(self):
        # As seen on the ROG: a shortcut's SteamGameId is the 64-bit game ID, SteamAppId the app ID.
        folder = self.proc / "27667"
        folder.mkdir()
        (folder / "environ").write_bytes(b"STEAM_COMPAT_APP_ID=0\0SteamAppId=2211630218\0SteamGameId=9498879457188904960\0")
        (folder / "cmdline").write_bytes(b"Z:\\home\\deck\\Games\\Sekiro\\sekiro.exe\0")
        (folder / "statm").write_bytes(b"400 200 0 0 0 0 0")
        names = [row["name"] for row in game_window.candidates("2211630218", [], self.proc, lambda display: {})]
        self.assertEqual(names, ["sekiro.exe"])
        # The shortcut's SteamGameId alone still finds it.
        (folder / "environ").write_bytes(b"SteamGameId=9498879457188904960\0")
        self.assertEqual(len(game_window.candidates("2211630218", [], self.proc, lambda display: {})), 1)

    def test_cheat_engines_own_list_is_ranked_with_what_linux_knows(self):
        # Cheat Engine's list as seen inside Proton on the VM, plus a game and a trainer.
        reported = [
            {"pid": 48, "name": "services.exe", "window": False}, {"pid": 32, "name": "steam.exe", "window": True},
            {"pid": 424, "name": "cheatengine-x86_64-SSE4-AVX2.exe", "window": True},
            {"pid": 352, "name": "Game-Win64-Shipping.exe", "window": False},
            {"pid": 360, "name": "Launcher.exe", "window": True},
            {"pid": 380, "name": "Trainer.exe", "window": True},
            {"pid": 390, "name": "CrashReporter.exe", "window": False},
            {"pid": "x", "name": "Bad.exe"}, "junk",
        ]
        app = "42"
        self.process(13, [r"Z:\g\Game-Win64-Shipping.exe"], 800, app)
        self.process(12, [r"Z:\g\Launcher.exe"], 50, app)
        self.process(14, [r"Z:\g\CrashReporter.exe"], 900, app)
        seen = {"GAMESCOPE_FOCUSABLE_WINDOWS": [6, 42, 13]}
        rows = game_window.rank(reported, app, ["/l/Trainer/Trainer.exe"], self.proc,
                                lambda display: seen if display == ":0" else {})
        # gamescope's window wins over Cheat Engine's own window hint; then memory.
        self.assertEqual([(row["pid"], row["name"]) for row in rows],
                         [(352, "Game-Win64-Shipping.exe"), (360, "Launcher.exe"), (390, "CrashReporter.exe")])
        self.assertTrue(rows[1]["window"])


if __name__ == "__main__":
    unittest.main()
