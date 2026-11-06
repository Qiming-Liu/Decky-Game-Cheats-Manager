"""The shared launcher script and the settings that shape it."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import launcher
import plugin_settings


class LauncherTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for target, name, value in ((launcher, "PATH", str(self.root / "launch.bat")),
                                    (plugin_settings, "PATH", str(self.root / "settings.json"))):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def read(self):
        return Path(launcher.script()).read_bytes().decode("ascii")

    def test_script_follows_the_shared_settings(self):
        text = self.read()
        self.assertIn('start "" /d "%~dp1" "%~1"\r\ngoto started', text)
        self.assertIn(':started\r\ngoto :eof', text)
        # Tables are handed to Cheat Engine, named by the --ce pair before the programs.
        self.assertIn('if /I "%~x1"==".ct" goto table', text)
        self.assertIn('if defined GCM_CE start "" /d "%GCM_CE_DIR%" "%GCM_CE%" "%~1"', text)
        self.assertNotIn("ping", text)
        plugin_settings.update({"launch_delay": 10, "allow_multiple": True})
        text = self.read()
        self.assertIn("ping -n 11 127.0.0.1 >nul", text)
        self.assertNotIn(':started\r\ngoto :eof', text)
        self.assertTrue(text.endswith("shift\r\ngoto next\r\n"))

    def test_settings_reject_unknown_keys_and_values(self):
        self.assertEqual(plugin_settings.load(), plugin_settings.DEFAULTS)
        for changes in ({}, {"launch_delay": 7}, {"launch_delay": True}, {"auto_select": 1}, {"other": True}, None):
            with self.assertRaises(ValueError):
                plugin_settings.update(changes)
        self.assertEqual(plugin_settings.load(), plugin_settings.DEFAULTS)
