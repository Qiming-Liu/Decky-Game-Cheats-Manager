"""The About page's data: the newest release on GitLab and the system the plugin runs on.

The release check runs at most once every seven days. It never raises: when
GitLab cannot be reached the page simply shows the installed version, and
the next attempt waits a day so an offline Deck does not retry on every open.
"""
from __future__ import annotations

import os
import re
import threading
import time

import decky
from library_storage import read_json, write_json

# Redirects to the newest release on GitLab.
RELEASE_API = "https://gitlab.com/api/v4/projects/alan-liu%2FDecky-Game-Cheats-Manager/releases/permalink/latest"
PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "update_check.json")
INTERVAL = 7 * 24 * 3600
RETRY_AFTER_FAILURE = 24 * 3600
OS_RELEASE = "/etc/os-release"
# An optional pre-release label marks a test build, e.g. "1.0.2-test".
_VERSION = re.compile(r"[vV]?\s*(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?")
_lock = threading.Lock()


def _version(value) -> str:
    """A version as "x.y.z" or, for a test build, "x.y.z-label"; "" when it is not one.

    Release tags should be "vx.y.z", but a mistyped tag still counts: the "v" may
    be missing and "1.2" or "1.20" (a dropped dot) both mean 1.2.0.
    """
    match = _VERSION.fullmatch(value.strip()) if isinstance(value, str) else None
    if not match:
        return ""
    words = match.group(1).split(".")
    if len(words) == 2 and len(words[1]) > 1:
        words = [words[0], words[1][:-1], words[1][-1]]
    parts = [int(word) for word in words] + [0] * (3 - len(words))
    label = match.group(2)
    return ".".join(str(part) for part in parts) + (f"-{label}" if label else "")


def _order(version: str) -> tuple:
    """Sort key: the numbers, then a test build before the release of the same
    number, then test labels with their numbers compared as numbers ("test" <
    "test2" < "test10")."""
    number, _, label = version.partition("-")
    parts = [int(part) for part in number.split(".")]
    while parts and parts[-1] == 0:
        parts.pop()
    words = tuple((0, int(word)) if word.isdigit() else (1, word.lower())
                  for word in re.findall(r"\d+|[^\d]+", label))
    return tuple(parts), not label, words


def is_newer(latest: str, current: str) -> bool:
    """Whether `latest` is worth offering to someone on `current`.

    A test build is offered only to those already testing: an installed
    release never points at a test build, whatever its number.
    """
    latest, current = _version(latest), _version(current)
    if not latest or not current or ("-" in latest and "-" not in current):
        return False
    return _order(latest) > _order(current)


def _fetch() -> str:
    """The newest release's version, or "" when GitLab gives no usable answer."""
    import certifi
    import requests

    response = requests.get(RELEASE_API, timeout=10, verify=certifi.where(), headers={
        "Accept": "application/json", "User-Agent": "DeckyGCM",
    })
    if response.status_code != 200:
        return ""
    data = response.json()
    return _version(data.get("tag_name")) if isinstance(data, dict) else ""


def update(now: float | None = None) -> dict:
    """The installed and newest versions; checks GitLab when the last check is a week old."""
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
