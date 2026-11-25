"""Proton's log: who wrote PROTON_LOG, what the export takes along, and the build-dependent default."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import plugin_log
import plugin_settings
import proton_log
from library_storage import read_json


class ProtonLogTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_ownership_is_remembered_per_game(self):
        with patch.object(proton_log, "PATH", str(self.root / "proton_log.json")):
            self.assertFalse(proton_log.owned("10"))
            proton_log.set_owned("10", True)
            proton_log.set_owned("20", True)
            proton_log.set_owned("10", False)
            self.assertFalse(proton_log.owned("10"))
            self.assertTrue(proton_log.owned("20"))
            with self.assertRaises(ValueError):
                proton_log.set_owned("../x", True)

    def test_export_appends_the_end_of_the_newest_proton_logs_as_they_are(self):
        home = self.root / "home"
        home.mkdir()
        old, new = home / "steam-10.log", home / "steam-20.log"
        old.write_text("old\n", encoding="utf-8")
        new.write_text("".join(f"/home/deck line {index}\n" for index in range(1500)), encoding="utf-8")
        (home / "steam-other.log").write_text("not proton\n", encoding="utf-8")
        os.utime(old, (1, 1))
        log = plugin_log.PluginLog(self.root / "logs", "deckygcm")
        (self.root / "logs").mkdir()
        (self.root / "logs" / "deckygcm.log").write_text("plugin\n", encoding="utf-8")
        path = log.export(home, home, proton_log.sections(home))
        text = (home / path.removeprefix("~/")).read_text(encoding="utf-8")
        self.assertTrue(text.startswith("plugin\n"))
        self.assertLess(text.index("~/steam-20.log"), text.index("~/steam-10.log"))
        self.assertNotIn("line 499\n", text)
        self.assertIn("/home/deck line 500\n", text)
        self.assertIn("/home/deck line 1499\n", text)
        self.assertNotIn("not proton", text)


class ProtonLogSettingTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "settings.json"
        patcher = patch.object(plugin_settings, "PATH", str(self.path))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_only_a_chosen_value_is_saved_so_the_default_follows_the_build(self):
        with patch.dict(plugin_settings.DEFAULTS, {"proton_log": True}):
            self.assertTrue(plugin_settings.load()["proton_log"])
            plugin_settings.update({"allow_multiple": True})
            self.assertNotIn("proton_log", read_json(str(self.path)))
        with patch.dict(plugin_settings.DEFAULTS, {"proton_log": False}):
            self.assertFalse(plugin_settings.load()["proton_log"])
            plugin_settings.update({"proton_log": True})
            plugin_settings.update({"launch_delay": 5})
            self.assertIs(read_json(str(self.path))["proton_log"], True)


if __name__ == "__main__":
    unittest.main()
