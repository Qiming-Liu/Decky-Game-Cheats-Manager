"""
The local copy of GCM's trainer search database: the same JSON files GCM
downloads into its own "db" folder, kept under this plugin's settings dir
(gcm_bridge.DATABASE_PATH) so search works offline once fetched.
"""
from __future__ import annotations

import json
import os
import threading
import time
import tempfile
from pathlib import Path

import data_source
import http_download
import library_storage
from gcm_bridge import DATABASE_PATH
import gcm_bridge

MAX_AGE = 7 * 24 * 60 * 60
# The data service asks clients not to check a file more than once an hour.
MIN_INTERVAL = 60 * 60
STATE_FILE = "checked_at.json"


def _checks(directory):
    try:
        data = json.loads((Path(directory) / STATE_FILE).read_text(encoding="utf-8"))
        return {name: value for name, value in data.items()
                if name in DATABASE_FILES and type(value) in (int, float) and 0 < value <= time.time()}
    except (OSError, ValueError, AttributeError):
        return {}


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as output:
        temporary = output.name
        json.dump(data, output)
    try:
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def initialize():
    """Seed the writable catalog from the release without replacing newer local data."""
    bundled = Path(gcm_bridge.PLUGIN_DIR) / "db"
    shipped_checks = _checks(bundled)
    local_checks = _checks(DATABASE_PATH)
    for name in DATABASE_FILES:
        destination = Path(DATABASE_PATH) / name
        if destination.is_file():
            # Adopt timestamps from installations made before freshness tracking.
            local_checks.setdefault(name, destination.stat().st_mtime)
            if shipped_checks.get(name, 0) <= local_checks[name]:
                continue
        try:
            data = json.loads((bundled / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, list):
            continue
        _write_json(destination, data)
        # Preserve the release fetch time; installation must not reset its age.
        local_checks[name] = shipped_checks.get(name, 0)
    if local_checks:
        _write_json(Path(DATABASE_PATH) / STATE_FILE, local_checks)

# file name -> upstream S3 path (see upstream's threads/other_threads.py Fetch*Data)
DATABASE_FILES = {
    "fling_archive.json": "GCM/Data/fling_archive.json",
    "fling_main.json": "GCM/Data/fling_main.json",
    "xiaoxing.json": "GCM/Data/xiaoxing.json",
    "cheat_table.json": "GCM/Data/cheat_table.json",
    "gcm_trainers.json": "GCM/Data/gcm_trainers.json",
    "translations.json": "GCM/Data/translations.json",
}


def load(file_name: str):
    path = os.path.join(DATABASE_PATH, file_name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# Files finished out of those the running refresh downloads, for the settings page.
PROGRESS = {"done": 0, "total": 0}


def status() -> dict:
    files = {}
    checks = _checks(DATABASE_PATH)
    for name in DATABASE_FILES:
        path = os.path.join(DATABASE_PATH, name)
        files[name] = os.path.getmtime(path) if os.path.isfile(path) else None
    return {
        "configured": data_source.is_configured(),
        "data_source": data_source.status(),
        "files": files,
        "ready": all(files.values()),
        "checked_at": min(checks.get(name, 0) for name in DATABASE_FILES),
    }


# Set once the plugin stops; a refresh then ends at its next file or progress update.
_STOP = threading.Event()
_IDLE = threading.Condition()
_running = 0


class RefreshStopped(Exception):
    pass


def _check_stop(*_progress):
    if _STOP.is_set():
        raise RefreshStopped("plugin_stopping")


def stop():
    _STOP.set()


def wait_idle(timeout: float) -> bool:
    """Wait up to `timeout` seconds for running refreshes; True when none is left."""
    with _IDLE:
        return _IDLE.wait_for(lambda: not _running, timeout)


def cleanup_staging(before: float):
    """Remove refresh staging left behind when a stopped plugin was killed
    (only directories last changed before `before`)."""
    library_storage.remove_stale_directories(DATABASE_PATH, http_download.DATABASE_STAGING_PREFIX, before)


def refresh(force=True) -> dict:
    """Conditionally download files.

    Automatic checks skip files younger than seven days; manual ones skip files
    checked within the last hour.
    """
    global _running
    with _IDLE:
        _running += 1
    try:
        return _refresh(force)
    finally:
        with _IDLE:
            _running -= 1
            _IDLE.notify_all()


def _refresh(force):
    checks = _checks(DATABASE_PATH)
    now = time.time()
    age = MIN_INTERVAL if force else MAX_AGE
    names = [name for name in DATABASE_FILES
             if not Path(DATABASE_PATH, name).is_file() or now - checks.get(name, 0) >= age]
    if not names:
        return {"success": True, "errors": {}, "skipped": True}
    errors = {}
    for index, name in enumerate(names):
        if _STOP.is_set():
            errors[name] = "plugin_stopping"
            break
        s3_path = DATABASE_FILES[name]
        PROGRESS.update(done=index, total=len(names))
        try:
            url = data_source.get_signed_download_url(s3_path)
            _check_stop()
            http_download.download(url, DATABASE_PATH, _check_stop, filename=name)
            checks[name] = time.time()
            _write_json(Path(DATABASE_PATH) / STATE_FILE, checks)
        except Exception as e:  # noqa: BLE001 - reported per file, others still attempted
            errors[name] = str(e)
    PROGRESS.update(done=len(names), total=len(names))
    return {"success": not errors, "errors": errors, "finished_at": time.time()}
