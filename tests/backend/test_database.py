"""Catalog freshness, release seeding and preservation without network access."""
from __future__ import annotations

import json
import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import trainer_db
import main


class DatabaseTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.local = self.root / "settings" / "db"
        self.bundle = self.root / "plugin" / "db"
        self.local.mkdir(parents=True)
        self.bundle.mkdir(parents=True)
        for target, value in (("trainer_db.DATABASE_PATH", str(self.local)),
                              ("trainer_db.gcm_bridge.PLUGIN_DIR", str(self.bundle.parent)),
                              ("trainer_db.time.time", lambda: 2_000_000)):
            mocked = patch(target, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.signer = patch("trainer_db.data_source.get_signed_download_url", return_value="https://example.invalid/db").start()
        self.downloader = patch("trainer_db.http_download.download").start()
        self.addCleanup(patch.stopall)

    def catalog(self, directory, checked_at, value="old"):
        for name in trainer_db.DATABASE_FILES:
            (directory / name).write_text(json.dumps([value]), encoding="utf-8")
        (directory / trainer_db.STATE_FILE).write_text(
            json.dumps(dict.fromkeys(trainer_db.DATABASE_FILES, checked_at)), encoding="utf-8")

    def test_opening_before_seven_days_makes_no_requests_but_manual_refresh_does(self):
        self.catalog(self.local, 2_000_000 - trainer_db.MAX_AGE + 1)
        self.assertTrue(trainer_db.refresh(force=False)["skipped"])
        self.signer.assert_not_called()
        trainer_db.refresh()
        self.assertEqual(self.downloader.call_count, 6)

    def test_seven_day_check_including_unchanged_files_resets_age(self):
        self.catalog(self.local, 2_000_000 - trainer_db.MAX_AGE)
        self.assertTrue(trainer_db.refresh(force=False)["success"])
        self.assertEqual(self.downloader.call_count, 6)
        self.assertTrue(trainer_db.refresh(force=False)["skipped"])
        self.assertEqual(self.downloader.call_count, 6)

    def test_failed_file_keeps_old_data_and_is_retried(self):
        self.catalog(self.local, 1)
        failed = next(iter(trainer_db.DATABASE_FILES))

        def download(*args, filename):
            if filename == failed:
                raise OSError("Unavailable")

        self.downloader.side_effect = download
        self.assertFalse(trainer_db.refresh(force=False)["success"])
        self.assertEqual(json.loads((self.local / failed).read_text()), ["old"])
        self.downloader.reset_mock()
        trainer_db.refresh(force=False)
        self.assertEqual(self.downloader.call_count, 1)

    def test_release_seed_preserves_fetch_age_and_does_not_use_network(self):
        self.catalog(self.bundle, 1_900_000, "bundled")
        trainer_db.initialize()
        self.assertEqual(trainer_db._checks(self.local), trainer_db._checks(self.bundle))
        self.assertEqual(json.loads((self.local / "translations.json").read_text()), ["bundled"])
        self.signer.assert_not_called()

    def test_upgrade_does_not_overwrite_newer_local_catalog(self):
        self.catalog(self.bundle, 1_000_000, "bundled")
        self.catalog(self.local, 1_900_000, "local")
        trainer_db.initialize()
        self.assertEqual(json.loads((self.local / "translations.json").read_text()), ["local"])

    def test_new_release_replaces_older_local_catalog(self):
        self.catalog(self.bundle, 1_900_000, "bundled")
        self.catalog(self.local, 1_000_000, "local")
        trainer_db.initialize()
        self.assertEqual(json.loads((self.local / "translations.json").read_text()), ["bundled"])

    def test_legacy_installation_keeps_its_original_age(self):
        self.catalog(self.local, 1_900_000, "local")
        (self.local / trainer_db.STATE_FILE).unlink()
        import os
        for name in trainer_db.DATABASE_FILES:
            os.utime(self.local / name, (1_900_000, 1_900_000))
        trainer_db.initialize()
        self.assertTrue(trainer_db.refresh(force=False)["skipped"])
        self.signer.assert_not_called()

    def test_simultaneous_sidebar_checks_share_one_update(self):
        self.catalog(self.local, 1)
        entered, release = threading.Event(), threading.Event()

        def download(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise TimeoutError("Test worker timed out")

        self.downloader.side_effect = download

        async def run():
            plugin = main.Plugin()
            first = asyncio.create_task(plugin.check_database_update())
            await asyncio.to_thread(entered.wait, 5)
            second = asyncio.create_task(plugin.check_database_update())
            await asyncio.sleep(0)
            release.set()
            return await asyncio.gather(first, second)

        try:
            self.assertTrue(all(item["success"] for item in asyncio.run(run())))
            self.assertEqual(self.downloader.call_count, 6)
        finally:
            release.set()


if __name__ == "__main__":
    unittest.main()
