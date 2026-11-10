"""The persistent plugin log: redaction, persistence, reading and export."""
from __future__ import annotations

import asyncio
import logging
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import decky
import main
import plugin_log


class PluginLogTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.logger = logging.getLogger(f"gcm-log-test-{id(self)}")
        self.logger.propagate = False
        self.log = plugin_log.PluginLog(self.root / "logs", "deckygcm")
        self.addCleanup(lambda: self.log.detach())

    def test_home_directories_and_secrets_are_redacted(self):
        self.log.attach(self.logger, "started")
        self.logger.info("path /home/deck/Games/x.exe token=abc %s", {"api_key": "x"})
        self.logger.info("fetch https://example.invalid/file.zip?signature=s3cr3t&expires=1")
        text = (self.root / "logs" / "deckygcm.log").read_text(encoding="utf-8")
        self.assertIn("path ~/Games/x.exe token=*** {'api_key': '***'}", text)
        self.assertIn("https://example.invalid/file.zip?***", text)
        for secret in ("/home/deck", "abc", "'x'", "s3cr3t"):
            self.assertNotIn(secret, text)

    def test_entries_survive_a_new_instance_and_tracebacks_join_their_entry(self):
        self.log.attach(self.logger, "first start")
        try:
            raise ValueError("broken")
        except ValueError:
            self.logger.exception("failed")
        self.log.detach()
        # A plugin reload attaches a new instance to the same file.
        self.log = plugin_log.PluginLog(self.root / "logs", "deckygcm")
        self.log.attach(self.logger, "second start")
        entries = self.log.read()
        self.assertEqual([e["message"].splitlines()[0] for e in entries], ["first start", "failed", "second start"])
        self.assertEqual(entries[1]["level"], "ERROR")
        self.assertIn("ValueError: broken", entries[1]["message"])

    def test_export_writes_rotated_files_oldest_first(self):
        logs = self.root / "logs"
        logs.mkdir()
        (logs / "deckygcm.log.2").write_text("oldest /home/deck/a\n", encoding="utf-8")
        (logs / "deckygcm.log.1").write_text("older\n", encoding="utf-8")
        (logs / "deckygcm.log").write_text("newest\n", encoding="utf-8")
        home = self.root / "home"
        path = self.log.export(home)
        self.assertTrue(path.startswith("~/Downloads/deckygcm-log-") and path.endswith(".log"))
        exported = (home / "Downloads" / path.removeprefix("~/Downloads/")).read_text(encoding="utf-8")
        self.assertEqual(exported, "oldest ~/a\nolder\nnewest\n")

    def test_export_writes_into_the_chosen_folder(self):
        home = self.root / "home"
        chosen = home / "Desktop"
        chosen.mkdir(parents=True)
        self.assertEqual(self.log.export_directory(home), str(home))
        path = self.log.export(home, chosen)
        self.assertTrue(path.startswith("~/Desktop/deckygcm-log-"))
        self.assertTrue((chosen / path.removeprefix("~/Desktop/")).is_file())
        self.assertFalse((home / "Downloads").exists())
        with self.assertRaises(NotADirectoryError):
            self.log.export(home, home / "missing")


class LogRpcTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.log = plugin_log.PluginLog(self.root / "logs", "deckygcm")
        self.log.attach(decky.logger, "started")
        self.addCleanup(self.log.detach)
        for target, name, value in ((main, "LOG", self.log), (decky, "DECKY_USER_HOME", str(self.root))):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_rpcs_read_clear_export_and_record_frontend_failures(self):
        plugin = main.Plugin()
        asyncio.run(plugin.log_frontend("error", "Writing launch options failed: denied"))
        entries = asyncio.run(plugin.get_log(10))
        self.assertEqual(entries[-1]["level"], "ERROR")
        self.assertEqual(entries[-1]["message"], "[frontend] Writing launch options failed: denied")
        self.assertEqual(set(entries[-1]), {"time", "level", "message"})
        path = asyncio.run(plugin.export_log())
        self.assertTrue((self.root / "Downloads" / Path(path).name).is_file())
        asyncio.run(plugin.clear_log())
        # Clearing is itself a user action, so it is the only line left.
        self.assertEqual([e["message"] for e in asyncio.run(plugin.get_log())], ["[user] Clear the log: done"])

    def test_user_actions_log_one_line_with_their_outcome(self):
        records = [{"url": "secret-path", "id": "a"}]
        with patch("main.custom_options.save", return_value=records):
            asyncio.run(main.Plugin().save_custom_options(records))
        with patch("main.custom_options.save", side_effect=OSError("disk full")):
            asyncio.run(main.Plugin().save_custom_options(records))
        asyncio.run(main.Plugin().get_settings())
        entries = self.log.read()[1:]  # after the start banner
        self.assertEqual([(e["level"], e["message"]) for e in entries], [
            ("INFO", "[user] Save custom launch options (1 in the list): done"),
            ("WARNING", "[user] Save custom launch options (1 in the list): failed: disk full"),
        ])


if __name__ == "__main__":
    unittest.main()
