"""The About page's data: the newest release on GitHub and the system the plugin runs on.

The release check runs at most once every seven days. It never raises: when
GitHub cannot be reached the page simply shows the installed version, and
the next attempt waits a day so an offline Deck does not retry on every open.
"""
from __future__ import annotations

import os
import re
import threading
import time

import decky
from library_storage import read_json, write_json

REPOSITORY = "Qiming-Liu/Decky-Game-Cheats-Manager"
RELEASE_API = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "update_check.json")
INTERVAL = 7 * 24 * 3600
RETRY_AFTER_FAILURE = 24 * 3600
OS_RELEASE = "/etc/os-release"
_VERSION = re.compile(r"^v?(\d+(?:\.\d+){0,3})$")
_lock = threading.Lock()


def _version(value) -> str:
    match = _VERSION.match(value.strip()) if isinstance(value, str) else None
    return match.group(1) if match else ""


def _parts(version: str) -> tuple[int, ...]:
    parts = [int(part) for part in version.split(".")]
    while parts and parts[-1] == 0:
        parts.pop()
    return tuple(parts)


def is_newer(latest: str, current: str) -> bool:
    latest, current = _version(latest), _version(current)
    return bool(latest and current) and _parts(latest) > _parts(current)


def _fetch() -> str:
    """The newest release's version, or "" when GitHub gives no usable answer."""
    import certifi
    import requests

    response = requests.get(RELEASE_API, timeout=10, verify=certifi.where(), headers={
        "Accept": "application/vnd.github+json", "User-Agent": "DeckyGCM",
    })
    if response.status_code != 200:
        return ""
    data = response.json()
    return _version(data.get("tag_name")) if isinstance(data, dict) else ""


def update(now: float | None = None) -> dict:
    """The installed and newest versions; checks GitHub when the last check is a week old."""
    now = time.time() if now is None else now
    current = _version(decky.DECKY_PLUGIN_VERSION) or str(decky.DECKY_PLUGIN_VERSION)
    with _lock:
        state = read_json(PATH)
        latest = _version(state.get("latest"))
        due = state.get("next_check")
        if not isinstance(due, (int, float)) or isinstance(due, bool) or now >= due or due > now + INTERVAL:
            try:
                fetched = _fetch()
            except Exception:  # noqa: BLE001 - any failure only delays the next check
                fetched = ""
            if fetched:
                latest = fetched
            try:
                write_json(PATH, {"latest": latest, "next_check": now + (INTERVAL if fetched else RETRY_AFTER_FAILURE)})
            except OSError:
                pass
    return {"current": current, "latest": latest if is_newer(latest, current) else ""}


def system_name() -> str:
    """The operating system's display name, e.g. "SteamOS 3.7.13"; "" when unknown."""
    try:
        with open(OS_RELEASE, encoding="utf-8") as source:
            fields = dict(line.rstrip("\n").split("=", 1) for line in source if "=" in line)
    except OSError:
        return ""
    clean = {key: value.strip().strip('"') for key, value in fields.items()}
    name = clean.get("NAME", "")
    version = clean.get("VERSION_ID", "") or clean.get("BUILD_ID", "")
    return (f"{name} {version}".strip() or clean.get("PRETTY_NAME", ""))[:80]
