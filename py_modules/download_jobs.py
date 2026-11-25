"""Download job records. Pure apart from one existence check: the manager owns the state these describe."""
from __future__ import annotations

import os

ACTIVE_STATES = {"queued", "downloading", "extracting"}
METADATA_FIELDS = ("trainer_name", "game_name", "version", "origin", "author")


def new_job(job_id: str, trainer: dict, root: str, app_id: str, game_name: str, started_at: float) -> dict:
    return {
        "id": job_id, "trainer_id": trainer["id"], "trainer_name": trainer["trainer_name"],
        "version": trainer.get("version", ""),
        "state": "queued", "downloaded": 0, "total": 0, "path": None, "error": None,
        "directory": root, "app_ids": [app_id] if app_id else [], "started_at": started_at,
        # The game whose folder the download is installed into.
        "app_id": app_id, "game_name": game_name,
    }


def snapshot(job: dict) -> dict:
    return {**job, "app_ids": list(job["app_ids"])}


def is_active(job: dict) -> bool:
    return job["state"] in ACTIVE_STATES


def same_download(job: dict, trainer: dict, app_id: str = "", root: str = "") -> bool:
    """The job a second request for the same trainer version joins: an active
    one, or a finished one for the same game whose copy is still there, in the
    library `root` the request is for. The page shows a finished download as
    downloaded only once it has read the library again, and a request in
    between would download a second copy."""
    if job["trainer_id"] != trainer["id"] or job.get("version", "") != trainer.get("version", ""):
        return False
    if is_active(job):
        return True
    if job["state"] != "done" or not app_id or app_id not in job["app_ids"] or not job.get("path"):
        return False
    # A copy left behind in an earlier library folder does not answer a request for the current one.
    path = os.path.realpath(job["path"])
    return os.path.exists(path) and path.startswith(os.path.join(os.path.realpath(root), ""))


def may_cancel(job: dict, app_id: str) -> bool:
    """A game cancels the downloads it asked for. A download that belongs to
    no game (Cheat Engine) is cancelled without one."""
    return app_id in job["app_ids"] if job["app_ids"] else app_id == ""


def expired(jobs: dict[str, dict], kept: int) -> list[str]:
    """The finished jobs to forget: all but the newest `kept`."""
    return [key for key, job in jobs.items() if not is_active(job)][:-kept]


def metadata(trainer: dict, hashes: dict) -> dict:
    """What is recorded next to an installed trainer."""
    return {
        **{key: trainer.get(key, "") for key in METADATA_FIELDS},
        "schema_version": 1, "trainer_id": trainer["id"], "source_path": trainer["url"], "content_hashes": hashes,
    }
