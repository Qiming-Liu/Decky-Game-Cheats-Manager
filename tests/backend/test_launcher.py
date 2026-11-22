"""The shared launcher script and the settings that shape it."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import launcher
import plugin_settings
import trainer_library


class LauncherTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.library = self.root / "library"
        for target, name, value in ((launcher, "LEGACY_PATH", str(self.root / "launch.bat")),
                                    (launcher, "STARTER", str(self.root / "plugin/bin/gcm-start.exe")),
                                    (launcher, "PIPE_WAIT", str(self.root / "plugin/bin/gcm-pipewait.dll")),
                                    (trainer_library, "SETTINGS_PATH", str(self.root / "library.json")),
                                    (trainer_library, "DEFAULT_DIRECTORY", str(self.library)),
                                    (plugin_settings, "PATH", str(self.root / "settings.json"))):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def read(self):
        return Path(launcher.script()["path"]).read_bytes().decode("ascii")

    def test_script_lives_in_the_library_and_the_old_one_stays(self):
        result = launcher.script()
        self.assertEqual(result, {"path": str(self.library.resolve() / ".gcm.bat"),
                                  "legacy": [str(self.root / "launch.bat")]})
        self.assertEqual((self.root / "launch.bat").read_bytes(), Path(result["path"]).read_bytes())
        # Hidden, so the library does not list it as a trainer.
        self.assertEqual(trainer_library.scan()["trainers"], [])
        # Without a writable library, new launch options use the old place.
        trainer_library.write_json(trainer_library.SETTINGS_PATH, {"directory": str(self.root / "launch.bat" / "x")})
        self.assertEqual(launcher.script(), {"path": str(self.root / "launch.bat"), "legacy": []})

    def test_relative_programs_start_from_the_script_folder(self):
        self.assertIn('set "GCM_PROGRAM=%~1"\r\nif not "%GCM_PROGRAM:~1,1%"==":" set "GCM_PROGRAM=%~dp0%~1"\r\n',
                      self.read())

    def test_script_follows_the_shared_settings(self):
        text = self.read()
        self.assertIn('start "" /d "%GCM_FOLDER%" "%GCM_PROGRAM%"\r\ngoto started\r\n', text)
        self.assertIn(':started\r\ngoto :eof', text)
        # Tables are handed to Cheat Engine, named by the --ce pair before the programs.
        self.assertIn('if not "%GCM_CE:~1,1%"==":" set "GCM_CE=%~dp0%~2"\r\n', text)
        self.assertIn('if /i "%GCM_TYPE%"==".ct" goto table\r\n', text)
        self.assertIn(f'if not exist "%GCM_CE_DIR%{trainer_library.MANAGED_CE_MARKER}" goto started\r\n', text)
        # Cheat Engine is told the table, and where to log, by ASCII short paths.
        self.assertIn('for %%i in ("%GCM_PROGRAM%") do set "GCM_TABLE=%%~si"\r\n', text)
        self.assertIn('set "GCM_LOG=%%~dpsiautorun\\decky_gcm.log"\r\nset "LANG=en_US"\r\nreg add "HKCU\\Software\\Cheat Engine\\ceshare" /v enabled /d 0 /f >nul 2>&1', text)
        # The welcome question and the table Lua question are answered once; a later choice stays.
        for name in ("First Time User", "LuaScriptAction"):
            self.assertIn(f'reg query "HKCU\\Software\\Cheat Engine" /v "{name}" >nul 2>&1 || '
                          f'reg add "HKCU\\Software\\Cheat Engine" /v "{name}" /t REG_DWORD /d 0 /f >nul 2>&1\r\n', text)
        self.assertIn('"%GCM_START%" "%GCM_CE%" "%GCM_PROGRAM%" && goto started\r\n'
                      ':direct\r\nstart "" /d "%GCM_CE_DIR%" "%GCM_CE%" "%GCM_PROGRAM%"\r\n:started', text)
        self.assertNotIn("ping", text)
        plugin_settings.update({"launch_delay": 10, "allow_multiple": True})
        text = self.read()
        self.assertIn("ping -n 11 127.0.0.1 >nul", text)
        self.assertNotIn(':started\r\ngoto :eof', text)
        self.assertTrue(text.endswith("shift\r\ngoto next\r\n"))

    def test_cheat_engine_speaks_chinese_only_when_steam_does(self):
        for steam, expected in (("schinese", "zh_CN"), ("tchinese", "zh_CN"), ("japanese", "en_US"), ("", "en_US")):
            with patch.object(launcher.steam_library, "language", return_value=steam):
                self.assertIn(f'set "LANG={expected}"\r\n', self.read())

    def test_exe_programs_use_the_starter_beside_the_script(self):
        text = self.read()
        self.assertIn('set "GCM_START=%~dp0.gcm-start.exe"', text)
        self.assertIn('if not exist "%GCM_START%" goto plain\r\n"%GCM_START%" "%GCM_PROGRAM%" && goto started\r\n', text)
        # Every step is appended to the launch log beside the script.
        self.assertIn('echo %date% %time% launcher: started>>"%~dp0.gcm-launch.log"\r\n', text)
        copies = (self.root / ".gcm-start.exe", self.library / ".gcm-start.exe")
        self.assertFalse(any(copy.exists() for copy in copies))
        # Earlier versions' copy is removed.
        (self.root / "gcm-start.exe").write_bytes(b"MZ old")
        starter = self.root / "plugin/bin/gcm-start.exe"
        starter.parent.mkdir(parents=True)
        starter.write_bytes(b"MZ first")
        self.read()
        self.assertFalse((self.root / "gcm-start.exe").exists())
        self.assertEqual([copy.read_bytes() for copy in copies], [b"MZ first"] * 2)
        starter.write_bytes(b"MZ second")
        self.read()
        self.assertEqual([copy.read_bytes() for copy in copies], [b"MZ second"] * 2)
        starter.unlink()
        self.read()
        self.assertFalse(any(copy.exists() for copy in copies))

    def test_the_pipe_wait_library_sits_beside_the_starter(self):
        library = self.root / "plugin/bin/gcm-pipewait.dll"
        library.parent.mkdir(parents=True)
        library.write_bytes(b"MZ hook")
        self.read()
        copies = (self.root / ".gcm-pipewait.dll", self.library / ".gcm-pipewait.dll")
        self.assertEqual([copy.read_bytes() for copy in copies], [b"MZ hook"] * 2)
        library.unlink()
        self.read()
        self.assertFalse(any(copy.exists() for copy in copies))

    def test_reset_restores_default_settings(self):
        plugin_settings.update({"launch_delay": 10, "skip_launcher_check": True})
        self.assertEqual(plugin_settings.reset(), plugin_settings.DEFAULTS)
        self.assertEqual(plugin_settings.load(), plugin_settings.DEFAULTS)

    def test_ignores_the_removed_auto_select_setting(self):
        Path(plugin_settings.PATH).write_text('{"auto_select": false, "allow_multiple": true}', encoding="utf-8")
        self.assertEqual(plugin_settings.load(), {**plugin_settings.DEFAULTS, "allow_multiple": True})

    def test_settings_reject_unknown_keys_and_values(self):
        self.assertEqual(plugin_settings.load(), plugin_settings.DEFAULTS)
        self.assertTrue(plugin_settings.DEFAULTS["auto_attach"])
        self.assertFalse(plugin_settings.update({"auto_attach": False})["auto_attach"])
        plugin_settings.reset()
        for changes in ({}, {"launch_delay": 7}, {"launch_delay": True}, {"auto_select": False}, {"auto_attach": "no"},
                        {"skip_launcher_check": "yes"}, {"other": True}, None):
            with self.assertRaises(ValueError):
                plugin_settings.update(changes)
        self.assertEqual(plugin_settings.load(), plugin_settings.DEFAULTS)
