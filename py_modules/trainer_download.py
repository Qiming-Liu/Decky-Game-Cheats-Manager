"""Bounded download jobs; one atomic commit publishes each installation."""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path

import action_log
import data_source
import http_download
import trainer_archive
import trainer_library

ACTIVE_STATES = {"queued", "downloading", "extracting"}


class DownloadCancelled(Exception):
    pass


def _safe_folder_name(name):
    name = name.replace(": ", " - ").replace(":", "-").replace("/", "_").replace("?", "")
    name = re.sub(r'[<>"\\|*\x00-\x1f]', "", name).strip(" .")
    return name.encode("utf-8")[:150].decode("utf-8", errors="ignore") or "trainer"


class DownloadManager:
    """Own download state and workers for one plugin lifecycle."""

    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._tasks: set[asyncio.Task] = set()
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.RLock()
        self._lifecycle = asyncio.Lock()
        self._closing = False
        self._slots = None

    @staticmethod
    def _snapshot(job):
        return {**job, "app_ids": list(job["app_ids"])}

    async def wait_idle(self):
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    def resume(self):
        with self._lock:
            self._closing = False

    async def shutdown(self):
        async with self._lifecycle:
            await asyncio.to_thread(self._stop)
        # Cancelling to_thread alone does not stop its worker. Wait for cleanup.
        await self.wait_idle()

    def _stop(self):
        with self._lock:
            self._closing = True
            for token in self._cancel.values():
                token.set()

    def jobs(self):
        with self._lock:
            return [self._snapshot(job) for job in self._jobs.values()]

    def cancel(self, job_id: str, app_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or app_id not in job["app_ids"]:
                raise ValueError("Unknown download for this game.")
            if job["state"] in ACTIVE_STATES:
                self._cancel[job_id].set()
            return self._snapshot(job)

    async def start(self, trainer, download_dir=None, app_id="", expected_directory=""):
        # A cancelled RPC must not leave a registered job without a worker.
        starting = asyncio.create_task(self._start(trainer, download_dir, app_id, expected_directory))
        try:
            return await asyncio.shield(starting)
        except asyncio.CancelledError:
            await asyncio.gather(starting, return_exceptions=True)
            raise

    async def _start(self, trainer, download_dir, app_id, expected_directory):
        root = os.path.realpath(download_dir or await asyncio.to_thread(trainer_library.directory))
        if expected_directory and root != os.path.realpath(expected_directory):
            raise ValueError("library_changed")
        async with self._lifecycle:
            job, token, created, snapshot = await asyncio.to_thread(self._register, trainer, root, app_id)
            if created:
                if not self._tasks:
                    self._slots = asyncio.Semaphore(2)
                task = asyncio.create_task(self._run(job, dict(trainer), token))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
            return snapshot

    def _register(self, trainer, root, app_id):
        with self._lock:
            if self._closing:
                raise ValueError("plugin_stopping")
            for job in self._jobs.values():
                if (job["trainer_id"] == trainer["id"] and job.get("version", "") == trainer.get("version", "")
                        and job["state"] in ACTIVE_STATES):
                    if app_id and app_id not in job["app_ids"]:
                        job["app_ids"].append(app_id)
                    return job, self._cancel[job["id"]], False, self._snapshot(job)
            for key in [key for key, job in self._jobs.items() if job["state"] not in ACTIVE_STATES][:-49]:
                del self._jobs[key]
            job = {
                "id": uuid.uuid4().hex, "trainer_id": trainer["id"], "trainer_name": trainer["trainer_name"],
                "version": trainer.get("version", ""),
                "state": "queued", "downloaded": 0, "total": 0, "path": None, "error": None,
                "directory": root, "app_ids": [app_id] if app_id else [], "started_at": time.time(),
            }
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

        def commit(content, target, metadata):
            # The library lock is already held. Only final metadata and rename need
            # the job lock, so cancellation and polling stay available during hashing/copying.
            with self._lock:
                check()
                metadata["app_ids"] = list(job["app_ids"])
                trainer_library.write_json(content / trainer_library.METADATA, metadata)
                content.rename(target)
                job.update(path=str(target), directory=str(target.parent), state="done")

        check()
        restored = trainer_library.restore_trainer(trainer, [], commit=commit, check=check)
        if restored is not None:
            return
        root = Path(job["directory"])
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".gcm-download-", dir=root) as temporary:
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
            if not any(p.is_file() and p.suffix.lower() in trainer_library.TRAINER_EXTENSIONS for p in content.rglob("*")):
                raise ValueError("No .exe or .CT trainer files found in the download.")
            metadata = {k: trainer.get(k, "") for k in ("trainer_name", "game_name", "version", "origin")}
            metadata.update(schema_version=1, trainer_id=trainer["id"], source_path=trainer["url"],
                            content_hashes=trainer_library.content_hashes(content, check))
            check()
            trainer_library.publish_download(
                content, f"{_safe_folder_name(trainer['trainer_name'])} [{job['id'][:8]}]", root,
                commit=lambda prepared, target: commit(prepared, target, metadata))

    async def _run(self, job, trainer, token):
        try:
            async with self._slots:
                worker = asyncio.create_task(asyncio.to_thread(self._install, job, trainer, token))
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
                    action_log.log_warning(f"installed; temporary cleanup failed: {error}")
        finally:
            with self._lock:
                self._cancel.pop(job["id"], None)
            if job["state"] == "done":
                action_log.log_event(f"installed {job['trainer_name']} -> {job['path']}")
            elif job["state"] == "error":
                action_log.log_warning(f"download failed: {job['error']}")


manager = DownloadManager()


def resume():
    manager.resume()


async def shutdown():
    await manager.shutdown()


async def start(trainer, download_dir=None, app_id="", expected_directory=""):
    return await manager.start(trainer, download_dir, app_id, expected_directory)


def jobs():
    return manager.jobs()


def cancel(job_id, app_id):
    return manager.cancel(job_id, app_id)
