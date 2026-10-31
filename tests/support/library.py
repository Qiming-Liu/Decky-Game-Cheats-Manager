"""Shared setup and installation helpers; no collected test cases."""
from __future__ import annotations

import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import main
import trainer_download
import trainer_library

import io
import zipfile
from catalog import write_fixture_db


def zip_bytes(files: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return out.getvalue()


class LibraryCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.library = self.root / "trainers"
        self.library.mkdir()
        settings = patch.object(trainer_library, "SETTINGS_PATH", str(self.root / "settings.json"))
        settings.start()
        self.addCleanup(settings.stop)
        default = patch.object(trainer_library, "DEFAULT_DIRECTORY", str(self.root / "DeckyGCM"))
        default.start()
        self.addCleanup(default.stop)
        trainer_library.set_directory(str(self.library))
        write_fixture_db()
        downloads = patch.object(trainer_download, "manager", trainer_download.DownloadManager())
        downloads.start()
        self.addCleanup(downloads.stop)

    def _install(self, filename="trainer.zip", payload=None, app_id="1245620", switch=False):
        payload = payload if payload is not None else zip_bytes({"v1/Trainer.exe": b"trainer", "instructions.txt": b"help"})
        trainer = {"id": "example", "trainer_name": "[FL] Elden Ring Trainer", "game_name": "Elden Ring",
                   "origin": "fling_main", "version": "1.0", "url": "catalog/trainer.zip"}

        def download(url, directory, callback):
            Path(directory).mkdir(parents=True)
            path = Path(directory) / filename
            path.write_bytes(payload)
            callback(len(payload), len(payload))
            if switch:
                for name in ("new-library", "latest-library"):
                    other = self.root / name
                    other.mkdir()
                    trainer_library.set_directory(str(other))
                self.assertTrue(path.is_file())
            return str(path)

        async def run():
            job = await trainer_download.start(trainer, app_id=app_id)
            await trainer_download.manager.wait_idle()
            return next(item for item in trainer_download.jobs() if item["id"] == job["id"])

        with patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test/trainer"), patch("trainer_download.http_download.download", side_effect=download):
            return asyncio.run(run())

    def _trash_download(self):
        job = self._install()
        self.assertEqual(job["state"], "done", job["error"])
        item = trainer_library.scan()["trainers"][0]
        trainer_library.delete(item["id"], trainer_library.directory(), "1245620")
        cached = next(item for item in (Path(trainer_library.directory()) / ".gcm-trash").iterdir() if item.is_dir())
        trainer = {"id": "example", "trainer_name": "[FL] Elden Ring Trainer", "game_name": "Elden Ring",
                   "origin": "fling_main", "version": "1.0", "url": "catalog/trainer.zip"}
        return job, cached, trainer

    def _cancel_while_hashing(self, restore):
        if restore:
            _, cached, trainer = self._trash_download()
        else:
            trainer = {"id": "hashing", "trainer_name": "Trainer", "url": "same/url", "version": "1"}
        started, release = threading.Event(), threading.Event()

        def hashing(folder, check):
            started.set()
            if not release.wait(3):
                raise RuntimeError("test timeout")
            check()
            return {}

        def download(url, directory, callback):
            Path(directory).mkdir(parents=True)
            target = Path(directory) / "Trainer.exe"
            target.write_bytes(b"trainer")
            return str(target)

        async def run():
            plugin = main.Plugin()
            main.Plugin._last_results[trainer["id"]] = trainer
            result = await plugin.download_trainer(trainer["id"], "42", str(self.library), trainer["version"])
            job = result["job"]
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                visible = await asyncio.wait_for(plugin.get_downloads(), .5)
                self.assertTrue(any(item["id"] == job["id"] for item in visible))
                cancelled = await asyncio.wait_for(plugin.manage_trainer("cancel", "42", "", job["id"]), .5)
                self.assertTrue(cancelled["success"])
            finally:
                release.set()
                await trainer_download.manager.wait_idle()
            done = next(item for item in trainer_download.jobs() if item["id"] == job["id"])
            self.assertEqual(done["state"], "cancelled")
            self.assertIsNone(done["path"])

        target = "trainer_cache.content_hashes" if restore else "trainer_library.content_hashes"
        with patch(target, side_effect=hashing), patch("trainer_download.data_source.get_signed_download_url", return_value="https://example.test"), patch("trainer_download.http_download.download", side_effect=download):
            asyncio.run(run())
        if restore:
            self.assertTrue((cached / "content").exists())
