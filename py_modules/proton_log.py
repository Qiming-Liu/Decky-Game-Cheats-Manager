"""Proton's own log of games that start trainers, for bug reports.

With PROTON_LOG=1 in a game's launch options Proton writes Wine's output to
~/steam-<appid>.log. Proton reads the variable before it starts anything, so
the launcher script cannot turn it on; the frontend writes it next to the
trainer command while the `proton_log` setting is on. This module remembers
which games got it from the plugin, so only those lose it again, and gives
the log export the end of the newest Proton logs.
"""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path

import decky
from library_storage import read_json, write_json

PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "proton_log.json")
TAIL_LINES = 1000
MAX_FILES = 3
_BLOCK = 64 * 1024
_NAME = re.compile(r"^steam-\d+\.log$")
_lock = threading.Lock()


def _apps() -> list[str]:
    apps = read_json(PATH).get("apps")
    return [app for app in apps if isinstance(app, str)] if isinstance(apps, list) else []


def owned(app_id: str) -> bool:
    """True when the plugin wrote the game's PROTON_LOG."""
    with _lock:
        return app_id in _apps()


def set_owned(app_id: str, value: bool) -> None:
    if not isinstance(app_id, str) or not app_id.isdigit() or not isinstance(value, bool):
        raise ValueError("Invalid app ID.")
    with _lock:
        apps = [app for app in _apps() if app != app_id] + ([app_id] if value else [])
        write_json(PATH, {"apps": apps})


def tail(path: Path, count: int = TAIL_LINES) -> str:
    """The last `count` lines of a file, read backwards so a huge log costs little."""
    with open(path, "rb") as source:
        source.seek(0, os.SEEK_END)
        position = source.tell()
        data = b""
        while position > 0 and data.count(b"\n") <= count:
            step = min(_BLOCK, position)
            position -= step
            source.seek(position)
            data = source.read(step) + data
    lines = data.decode("utf-8", errors="replace").splitlines()
    return "\n".join(lines[-count:])


def sections(home: Path | str) -> list[tuple[str, str]]:
    """(title, text) of the newest Proton logs in `home`, newest first."""
    try:
        files = [entry for entry in Path(home).iterdir() if _NAME.match(entry.name) and entry.is_file()]
        files.sort(key=lambda entry: entry.stat().st_mtime, reverse=True)
    except OSError:
        return []
    result = []
    for file in files[:MAX_FILES]:
        try:
            text = tail(file)
        except OSError as error:
            text = f"(unreadable: {error})"
        result.append((f"~/{file.name}, last {TAIL_LINES} lines", text))
    return result
