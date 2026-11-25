"""Bounded download jobs; one atomic commit publishes each installation."""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path

import cheat_engine
import data_source
import decky
import download_jobs
import http_download
import library_layout
import library_storage
import plugin_data
import trainer_archive
import trainer_cache
import trainer_library
from download_jobs import ACTIVE_STATES
from library_scan import CHEAT_ENGINE
from library_settings import TRAINER_EXTENSIONS

STAGING_PREFIX = ".gcm-download-"
_DATA = plugin_data.load("downloads")


class DownloadCancelled(Exception):
    pass


class DownloadManager:
    """Own download state and workers for one plugin lifecycle."""

    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._tasks: set[asyncio.Task] = set()
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.RLock()
        self._idle = threading.Condition(self._lock)
        self._workers = 0
        self._lifecycle = asyncio.Lock()
        self._closing = False
        self._slots = None

    _snapshot = staticmethod(download_jobs.snapshot)

    async def wait_idle(self):
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    def resume(self):
        with self._lock:
            self._closing = False

    def close(self, timeout: float) -> bool:
        """Refuse new jobs, cancel running ones and wait up to `timeout` seconds
        for their worker threads. Returns whether every worker stopped.

        It blocks instead of awaiting: while Decky stops the plugin, the event
        loop no longer runs other callbacks (see `Plugin._unload`). Workers clean
        their staging directories themselves and never publish after cancellation.
        """
        with self._lock:
            self._closing = True
            for token in self._cancel.values():
                token.set()
            return self._idle.wait_for(lambda: not self._workers, timeout)

    def _work(self, job, trainer, token):
        with self._lock:
            self._workers += 1
        try:
            self._install(job, trainer, token)
        finally:
            with self._lock:
                self._workers -= 1
                self._idle.notify_all()

    def jobs(self):
        with self._lock:
            return [self._snapshot(job) for job in self._jobs.values()]

    def cancel(self, job_id: str, app_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or not download_jobs.may_cancel(job, app_id):
                raise ValueError("Unknown download for this game.")
            if job["state"] in ACTIVE_STATES:
                self._cancel[job_id].set()
            return self._snapshot(job)

    async def start(self, trainer, download_dir=None, app_id="", expected_directory="", game_name=""):
        # A cancelled RPC must not leave a registered job without a worker.
        starting = asyncio.create_task(self._start(trainer, download_dir, app_id, expected_directory, game_name))
        try:
            return await asyncio.shield(starting)
        except asyncio.CancelledError:
            await asyncio.gather(starting, return_exceptions=True)
            raise

    async def _start(self, trainer, download_dir, app_id, expected_directory, game_name):
        root = os.path.realpath(download_dir or await asyncio.to_thread(trainer_library.directory))
        if expected_directory and root != os.path.realpath(expected_directory):
            raise ValueError("library_changed")
        async with self._lifecycle:
            job, token, created, snapshot = await asyncio.to_thread(self._register, trainer, root, app_id, game_name)
            if created:
                if not self._tasks:
                    self._slots = asyncio.Semaphore(_DATA["max_concurrent"])
                task = asyncio.create_task(self._run(job, dict(trainer), token))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
            return snapshot

    def _register(self, trainer, root, app_id, game_name):
        with self._lock:
            if self._closing:
                raise ValueError("plugin_stopping")
            for job in self._jobs.values():
                if download_jobs.same_download(job, trainer, app_id, root):
                    if app_id and app_id not in job["app_ids"]:
                        job["app_ids"].append(app_id)
                    return job, self._cancel.get(job["id"]), False, self._snapshot(job)
            for key in download_jobs.expired(self._jobs, _DATA["finished_jobs_kept"]):
                del self._jobs[key]
            # Without a name from Steam, the game folder is named after the game the trainer is for.
            job = download_jobs.new_job(uuid.uuid4().hex, trainer, root, app_id,
                                        game_name or trainer.get("game_name", ""), time.time())
            self._jobs[job["id"]] = job
            token = self._cancel[job["id"]] = threading.Event()
            return job, token, True, self._snapshot(job)

    def _install(self, job, trainer, token):
        def check():
            if token.is_set():
                raise DownloadCancelled()

        def progress(done, total):
            check()
            with self._lock:
                job.update(downloaded=done, total=total)

        def commit(content, target, metadata, library):
            # The library lock is already held. Only final metadata and rename need
            # the job lock, so cancellation and polling stay available during hashing/copying.
            with self._lock:
                check()
                metadata["app_ids"] = list(job["app_ids"])
                library_storage.write_json(content / library_storage.METADATA, metadata)
                content.rename(target)
                job.update(path=str(target), directory=str(library), state="done")

        check()
        game = {"app_id": job["app_id"], "game_name": job["game_name"]}
        restored = trainer_library.restore_trainer(trainer, [], commit=commit, check=check, **game)
        if restored is not None:
            return
        root = Path(job["directory"])
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=STAGING_PREFIX, dir=root) as temporary:
            staging = Path(temporary)
            with self._lock:
                job["state"] = "downloading"
            url = data_source.get_signed_download_url(trainer["url"])
            check()
            downloaded = Path(http_download.download(url, str(staging / "download"), progress))
            check()
            content = staging / "content"
            content.mkdir()
            if downloaded.suffix.lower() in trainer_archive.ARCHIVE_EXTENSIONS:
                with self._lock:
                    job["state"] = "extracting"
                trainer_archive.extract(str(downloaded), str(content))
            else:
                shutil.move(str(downloaded), content / downloaded.name)
            if not any(p.is_file() and p.suffix.lower() in TRAINER_EXTENSIONS for p in content.rglob("*")):
                raise ValueError("No .exe or .CT trainer files found in the download.")
            metadata = download_jobs.metadata(trainer, trainer_cache.content_hashes(content, check))
            check()
            trainer_library.publish_download(
                content, library_layout.trainer_folder_name(trainer["trainer_name"], job["id"]), root,
                commit=lambda prepared, target, library: commit(prepared, target, metadata, library), **game)

    async def _run(self, job, trainer, token):
        try:
            async with self._slots:
                worker = asyncio.create_task(asyncio.to_thread(self._work, job, trainer, token))
                try:
                    await asyncio.shield(worker)
                except asyncio.CancelledError:
                    token.set()
                    await worker
        except (DownloadCancelled, asyncio.CancelledError):
            with self._lock:
                if job["state"] != "done":
                    job["state"] = "cancelled"
        except Exception as error:
            with self._lock:
                if job["state"] != "done":
                    job.update(state="cancelled" if token.is_set() else "error", error=None if token.is_set() else str(error))
                else:
                    decky.logger.warning("Installed; temporary cleanup failed: %s", error)
        finally:
            with self._lock:
                self._cancel.pop(job["id"], None)
            if job["state"] == "done":
                decky.logger.info('Download of trainer "%s" finished: %s', job["trainer_name"], job["path"])
                # A fresh Cheat Engine replaces any earlier copy and gets the
                # plugin's autorun script right away.
                if (Path(job["path"]) / CHEAT_ENGINE).is_file():
                    try:
                        final = str(cheat_engine.replace(job["path"]))
                        with self._lock:
                            job["path"] = final
                        cheat_engine.install_bridge(final)
                    except (OSError, ValueError) as error:
                        decky.logger.warning("Could not finish installing Cheat Engine: %s", error)
            elif job["state"] == "error":
                decky.logger.warning('Download of trainer "%s" failed: %s', job["trainer_name"], job["error"])


manager = DownloadManager()


def resume():
    manager.resume()


def close(timeout):
    return manager.close(timeout)


def cleanup_staging(before: float):
    """Remove download staging left behind when a stopped plugin was killed.

    Only directories last changed before `before` (this process's start) are
    removed, so a download started meanwhile keeps its own staging.
    """
    library_storage.remove_stale_directories(trainer_library.directory(), STAGING_PREFIX, before)


async def start(trainer, download_dir=None, app_id="", expected_directory="", game_name=""):
    return await manager.start(trainer, download_dir, app_id, expected_directory, game_name)


def jobs():
    return manager.jobs()


def cancel(job_id, app_id):
    return manager.cancel(job_id, app_id)
