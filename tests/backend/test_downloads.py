"""Downloads behavior and data integrity regressions."""
from __future__ import annotations

import asyncio
import os
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch

import download_jobs
import main
import trainer_db
import trainer_download
import library_settings
import library_storage
import trainer_library

from library import LibraryCase, zip_bytes


class DownloadsTest(LibraryCase):
    def test_stale_displayed_version_cannot_download_a_replaced_search_result(self):
        trainer = {"id": "stale-version", "version": "2"}
        with patch.dict(main.Plugin._last_results, {trainer["id"]: trainer}), patch("main.trainer_download.start") as start:
            result = asyncio.run(main.Plugin().download_trainer(trainer["id"], "42", str(self.library), "1"))
        self.assertFalse(result["success"])
        start.assert_not_called()

    def test_cheat_engine_is_installed_beside_the_game_folders_wherever_it_was_found(self):
        engine = {"id": "engine", "trainer_name": "Cheat Engine 7", "game_name": "none", "custom_name": "Cheat Engine", "url": "x"}
        with patch.dict(main.Plugin._last_results, {"engine": engine}), \
                patch("trainer_download.start", return_value={"id": "job"}) as start:
            result = asyncio.run(main.Plugin().download_trainer("engine", "42", str(self.library)))
            self.assertTrue(result["success"], result)
            self.assertEqual(start.call_args.kwargs["app_id"], "")
            # An app ID no folder record would accept is refused before anything is made.
            refused = asyncio.run(main.Plugin().download_trainer("engine", "9" * 25, str(self.library)))
            self.assertEqual(refused["error"], "invalid_app_id")

    def test_cancel_download_checks_game_and_signals_worker(self):
        token = threading.Event()
        trainer_download.manager._jobs["cancel"] = {"id": "cancel", "state": "downloading", "app_ids": ["42"]}
        trainer_download.manager._cancel["cancel"] = token
        try:
            with self.assertRaises(ValueError):
                trainer_download.cancel("cancel", "43")
            self.assertFalse(token.is_set())
            # A game's download is not cancelled without naming the game.
            with self.assertRaises(ValueError):
                trainer_download.cancel("cancel", "")
            self.assertEqual(trainer_download.cancel("cancel", "42")["state"], "downloading")
            self.assertTrue(token.is_set())
        finally:
            trainer_download.manager._cancel.pop("cancel", None)

    def test_a_download_for_no_game_is_cancelled_without_one(self):
        token = threading.Event()
        trainer_download.manager._jobs["engine"] = {"id": "engine", "state": "downloading", "app_ids": [], "trainer_name": "Cheat Engine"}
        trainer_download.manager._cancel["engine"] = token
        try:
            plugin = main.Plugin()
            refused = asyncio.run(plugin.manage_trainer("cancel", "42", "", "engine"))
            self.assertFalse(refused["success"])
            self.assertFalse(token.is_set())
            # Every other action still needs a game.
            self.assertEqual(asyncio.run(plugin.manage_trainer("delete", "", "", "engine"))["error"], "invalid_app_id")
            cancelled = asyncio.run(plugin.manage_trainer("cancel", "", "", "engine"))
            self.assertTrue(cancelled["success"], cancelled)
            self.assertTrue(token.is_set())
        finally:
            trainer_download.manager._cancel.pop("engine", None)

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

    def test_download_path_matches_the_scanned_entry_behind_a_symlink(self):
        linked = self.root / "home-link"
        try:
            linked.symlink_to(self.library, target_is_directory=True)
        except OSError:
            self.skipTest("symlinks unavailable")
        library_storage.write_json(library_settings.SETTINGS_PATH, {"directory": str(linked)})
        job = self._install()
        self.assertEqual(job["state"], "done", job["error"])
        self.assertEqual(job["path"], trainer_library.scan("1245620", "Elden Ring")["trainers"][0]["path"])

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
                # Workers are still blocked, so a short close reports them as running.
                self.assertFalse(trainer_download.close(0.05))
                with self.assertRaisesRegex(ValueError, "plugin_stopping"):
                    await trainer_download.start({"id": "new", "trainer_name": "Trainer", "url": "test"}, app_id="42")
            finally:
                release.set()
                self.assertTrue(trainer_download.close(3))
                await trainer_download.manager.wait_idle()

        try:
            with patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test"), patch("trainer_download.http_download.download", side_effect=download):
                asyncio.run(run())
        finally:
            trainer_download.resume()
        self.assertEqual(maximum, 2)
        self.assertEqual(calls, 2)
        self.assertTrue(all(job["state"] == "cancelled" for job in trainer_download.jobs()))
        self.assertEqual(list(self.library.iterdir()), [])

    def test_switching_folder_during_download_publishes_to_latest_path(self):
        job = self._install(switch=True)
        self.assertEqual(job["state"], "done", job["error"])
        self.assertEqual(Path(job["path"]).parent.parent, (self.root / "latest-library").resolve())
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

    def test_unload_waits_for_worker_without_the_event_loop_and_prevents_publication(self):
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
            threading.Timer(0.2, release.set).start()
            # Decky's event loop runs nothing else during _unload, so it must not suspend.
            unloading = main.Plugin()._unload()
            with self.assertRaises(StopIteration):
                unloading.send(None)
            await trainer_download.manager.wait_idle()
            return next(item for item in trainer_download.jobs() if item["id"] == job["id"])
        try:
            with patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test"), patch("trainer_download.http_download.download", side_effect=download):
                job = asyncio.run(run())
            self.assertEqual(job["state"], "cancelled")
            self.assertEqual(list(self.library.iterdir()), [])
        finally:
            release.set()
            trainer_download.resume()
            trainer_db._STOP.clear()

    def test_sigterm_stops_downloads_and_exits_without_the_event_loop(self):
        try:
            with patch("main.os._exit") as exit_process, patch("main.logging.shutdown"):
                main._terminate(None, None)
            exit_process.assert_called_once_with(0)
            with self.assertRaisesRegex(ValueError, "plugin_stopping"):
                asyncio.run(trainer_download.start({"id": "late", "trainer_name": "Late", "url": "test"}))
        finally:
            trainer_download.resume()
            trainer_db._STOP.clear()

    def test_staging_left_by_a_killed_plugin_is_removed_but_new_staging_is_kept(self):
        old, new, other = (self.library / ".gcm-download-old"), (self.library / ".gcm-download-new"), (self.library / "Kept")
        for folder in (old, new, other):
            folder.mkdir()
        os.utime(old, (1_000, 1_000))
        os.utime(other, (1_000, 1_000))
        trainer_download.cleanup_staging(before=2_000)
        self.assertEqual(sorted(p.name for p in self.library.iterdir()), [".gcm-download-new", "Kept"])

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

    def test_a_repeated_request_for_a_finished_download_does_not_download_again(self):
        trainer = {"id": "finished", "trainer_name": "Trainer", "url": "same/url", "version": "1"}
        downloads = []

        def download(url, directory, callback):
            downloads.append(directory)
            Path(directory).mkdir(parents=True)
            target = Path(directory) / "Trainer.exe"
            target.write_bytes(b"trainer")
            return str(target)

        async def run():
            first = await trainer_download.start(trainer, app_id="42")
            await trainer_download.manager.wait_idle()
            # The page asked again before it had read the library: the finished copy answers.
            again = await trainer_download.start(trainer, app_id="42")
            await trainer_download.manager.wait_idle()
            return first, again

        with patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test"), patch("trainer_download.http_download.download", side_effect=download):
            first, again = asyncio.run(run())
            self.assertEqual(again["id"], first["id"])
            self.assertEqual(len(downloads), 1)
            # A copy outside the library the request is for does not answer it.
            self.assertTrue(download_jobs.same_download(again, trainer, "42", str(self.library)))
            self.assertFalse(download_jobs.same_download(again, trainer, "42", str(self.library / "elsewhere")))
            # Once that copy is gone, the trainer downloads again.
            for item in trainer_library.scan("42")["trainers"]:
                removed = asyncio.run(main.Plugin().manage_trainer("delete", "42", str(self.library), item["id"]))
                self.assertTrue(removed["success"], removed)

            async def later():
                job = await trainer_download.start(trainer, app_id="42")
                await trainer_download.manager.wait_idle()
                return job
            # (Served from the deleted-file cache: no second network download.)
            self.assertNotEqual(asyncio.run(later())["id"], first["id"])
        self.assertEqual(len(trainer_library.scan("42")["trainers"]), 1)
