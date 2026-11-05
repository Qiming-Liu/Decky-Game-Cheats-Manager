"""Downloads behavior and data integrity regressions."""
from __future__ import annotations

import asyncio
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch

import main
import trainer_download
import trainer_library

from library import LibraryCase, zip_bytes


class DownloadsTest(LibraryCase):
    def test_stale_displayed_version_cannot_download_a_replaced_search_result(self):
        trainer = {"id": "stale-version", "version": "2"}
        with patch.dict(main.Plugin._last_results, {trainer["id"]: trainer}), patch("main.trainer_download.start") as start:
            result = asyncio.run(main.Plugin().download_trainer(trainer["id"], "42", str(self.library), "1"))
        self.assertFalse(result["success"])
        start.assert_not_called()

    def test_cancel_download_checks_game_and_signals_worker(self):
        token = threading.Event()
        trainer_download.manager._jobs["cancel"] = {"id": "cancel", "state": "downloading", "app_ids": ["42"]}
        trainer_download.manager._cancel["cancel"] = token
        try:
            with self.assertRaises(ValueError):
                trainer_download.cancel("cancel", "43")
            self.assertFalse(token.is_set())
            self.assertEqual(trainer_download.cancel("cancel", "42")["state"], "downloading")
            self.assertTrue(token.is_set())
        finally:
            trainer_download.manager._cancel.pop("cancel", None)

    def test_cancelling_during_progress_cleans_files_and_never_publishes(self):
        def download(url, directory, callback):
            Path(directory).mkdir(parents=True)
            (Path(directory) / "partial.exe").write_bytes(b"partial")
            trainer_download.cancel(job["id"], "42")
            callback(7, 100)
            self.fail("A cancelled worker must stop at its next progress callback.")

        async def run():
            nonlocal job
            job = await trainer_download.start({"id": "cancel-active", "trainer_name": "Test", "url": "test"}, app_id="42")
            await trainer_download.manager.wait_idle()

        job = None
        with patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test"), patch("trainer_download.http_download.download", side_effect=download):
            asyncio.run(run())
        job = next(item for item in trainer_download.jobs() if item["id"] == job["id"])
        self.assertEqual(job["state"], "cancelled")
        self.assertIsNone(job["path"])
        self.assertEqual(list(self.library.iterdir()), [])

    def test_download_extracts_and_records_game_after_restart(self):
        job = self._install()
        self.assertEqual(job["state"], "done", job["error"])
        self.assertTrue((Path(job["path"]) / "v1" / "Trainer.exe").is_file())
        self.assertFalse(list(Path(job["path"]).glob("*.zip")))
        trainer_download.manager = trainer_download.DownloadManager()  # Simulate a plugin reload.
        local = trainer_library.scan("1245620", "Changed Name")["trainers"]
        self.assertEqual(len(local), 1)
        self.assertEqual(local[0]["trainer_id"], "example")
        self.assertEqual(trainer_library.scan("999", "Elden Ring")["trainers"], [])

    def test_direct_ct_download_is_added_without_extraction(self):
        job = self._install("game.CT", b"<CheatTable/>")
        self.assertEqual(job["state"], "done", job["error"])
        self.assertTrue((Path(job["path"]) / "game.CT").is_file())

    def test_polling_and_cancellation_remain_available_during_install_hashing(self):
        self._cancel_while_hashing(False)

    def test_shutdown_cancels_queued_jobs_and_never_exceeds_two_workers(self):
        entered, release = threading.Event(), threading.Event()
        lock = threading.Lock()
        active = maximum = calls = 0

        def download(url, directory, callback):
            nonlocal active, maximum, calls
            with lock:
                calls += 1
                active += 1
                maximum = max(maximum, active)
                if active == 2:
                    entered.set()
            try:
                if not release.wait(3):
                    raise RuntimeError("test timeout")
                Path(directory).mkdir(parents=True)
                target = Path(directory) / "Trainer.exe"
                target.write_bytes(b"trainer")
                return str(target)
            finally:
                with lock:
                    active -= 1

        async def run():
            try:
                for i in range(3):
                    await trainer_download.start({"id": str(i), "trainer_name": "Trainer", "url": "test"}, app_id="42")
                self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                stopping = asyncio.create_task(trainer_download.shutdown())
                # shutdown must refuse new work before waiting for existing workers.
                for _ in range(100):
                    try:
                        await trainer_download.start({"id": "0", "trainer_name": "Trainer", "url": "test"}, app_id="42")
                    except ValueError as error:
                        self.assertEqual(str(error), "plugin_stopping")
                        break
                    await asyncio.sleep(.01)
                else:
                    self.fail("Shutdown did not stop accepting downloads.")
            finally:
                release.set()
                await trainer_download.shutdown()
            await stopping

        with patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test"), patch("trainer_download.http_download.download", side_effect=download):
            asyncio.run(run())
        self.assertEqual(maximum, 2)
        self.assertEqual(calls, 2)
        self.assertTrue(all(job["state"] == "cancelled" for job in trainer_download.jobs()))
        self.assertEqual(list(self.library.iterdir()), [])

    def test_switching_folder_during_download_publishes_to_latest_path(self):
        job = self._install(switch=True)
        self.assertEqual(job["state"], "done", job["error"])
        self.assertEqual(Path(job["path"]).parent, (self.root / "latest-library").resolve())
        self.assertEqual(len(trainer_library.scan()["trainers"]), 1)
        self.assertEqual(list(self.library.iterdir()), [])
        self.assertEqual(list((self.root / "new-library").iterdir()), [])

    def test_failed_extraction_cleans_staging_without_touching_existing_files(self):
        existing = self.library / "existing.CT"
        existing.write_bytes(b"keep")
        job = self._install(payload=zip_bytes({"../escape.exe": b"bad"}))
        self.assertEqual(job["state"], "error")
        self.assertIsNone(job["path"])
        self.assertEqual(existing.read_bytes(), b"keep")
        self.assertEqual([p.name for p in self.library.iterdir()], ["existing.CT"])
        self.assertFalse((self.root / "escape.exe").exists())

    def test_cleanup_failure_after_commit_keeps_install_successful(self):
        real_temporary = tempfile.TemporaryDirectory
        class FailingCleanup(real_temporary):
            def __exit__(self, *args):
                super().__exit__(*args)
                raise OSError("cleanup failed")
        with patch("trainer_download.tempfile.TemporaryDirectory", FailingCleanup):
            job = self._install()
        self.assertEqual(job["state"], "done")
        self.assertEqual(len(trainer_library.scan()["trainers"]), 1)

    def test_shutdown_waits_for_worker_and_prevents_publication(self):
        started, release = threading.Event(), threading.Event()
        def download(url, directory, progress):
            started.set()
            if not release.wait(3):
                raise RuntimeError("test timeout")
            Path(directory).mkdir(parents=True)
            target = Path(directory) / "trainer.CT"
            target.write_bytes(b"table")
            return str(target)
        async def run():
            job = await trainer_download.start({"id": "stop", "trainer_name": "Stop", "url": "test"})
            self.assertTrue(await asyncio.to_thread(started.wait, 2))
            stopping = asyncio.create_task(trainer_download.shutdown())
            await asyncio.sleep(0)
            self.assertFalse(stopping.done())
            release.set()
            await stopping
            return next(item for item in trainer_download.jobs() if item["id"] == job["id"])
        try:
            with patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test"), patch("trainer_download.http_download.download", side_effect=download):
                job = asyncio.run(run())
            self.assertEqual(job["state"], "cancelled")
            self.assertEqual(list(self.library.iterdir()), [])
        finally:
            release.set()
            trainer_download.resume()

    def test_search_in_second_panel_keeps_first_panel_downloadable(self):
        plugin = main.Plugin()
        async def run():
            first = await plugin.search_trainers("elden", "en")
            await plugin.search_trainers("wukong", "en")
            with patch("main.trainer_download.start", return_value={"id": "job"}):
                return await plugin.download_trainer(first["results"][0]["id"], "1245620")
        self.assertTrue(asyncio.run(run())["success"])

    def test_concurrent_versions_install_separately_and_same_version_joins(self):
        trainer = {"id": "versions", "trainer_name": "Trainer", "url": "same/url", "version": "1"}
        release = threading.Event()

        def download(url, directory, callback):
            if not release.wait(3):
                raise RuntimeError("test timeout")
            Path(directory).mkdir(parents=True)
            target = Path(directory) / "Trainer.exe"
            target.write_bytes(b"trainer")
            return str(target)

        async def run():
            try:
                old = await trainer_download.start(trainer, app_id="42")
                joined = await trainer_download.start(trainer, app_id="43")
                new = await trainer_download.start({**trainer, "version": "2"}, app_id="42")
                self.assertEqual(joined["id"], old["id"])
                self.assertNotEqual(old["id"], new["id"])
                joined["app_ids"].clear()
                joined["state"] = "error"
                snapshots = trainer_download.jobs()
                snapshots[0]["app_ids"].append("untrusted")
                self.assertNotIn("untrusted", trainer_download.jobs()[0]["app_ids"])
            finally:
                release.set()
                await trainer_download.manager.wait_idle()
            done = {job["id"]: job for job in trainer_download.jobs()}
            return done[old["id"]], done[new["id"]]

        with patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test"), patch("trainer_download.http_download.download", side_effect=download):
            old, new = asyncio.run(run())
        self.assertEqual([old["state"], new["state"]], ["done", "done"])
        self.assertNotEqual(old["path"], new["path"])
        installed = trainer_library.scan("42")["trainers"]
        self.assertEqual({item["version"] for item in installed}, {"1", "2"})
        self.assertEqual(len(trainer_library.scan("43")["trainers"]), 1)
