"""The About page's data: the newest release on GitHub and the system the plugin runs on.

The release check runs at most once a day. It never raises: when
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

# The newest releases, test builds (pre-releases) included: GitHub's "latest" leaves those out.
RELEASE_API = "https://api.github.com/repos/Qiming-Liu/Decky-Game-Cheats-Manager/releases?per_page=30"
PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "update_check.json")
# The test build whose notice the player has seen.
NOTICE_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "test_notice.json")
INTERVAL = 24 * 3600
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


def newest(versions) -> tuple[str, str]:
    """The newest of `versions` overall and the newest release among them ("" when none)."""
    found = sorted((version for version in map(_version, versions) if version), key=_order)
    releases = [version for version in found if "-" not in version]
    return (found[-1] if found else "", releases[-1] if releases else "")


def _fetch() -> tuple[str, str]:
    """The newest published version and the newest release; ("", "") when GitHub
    gives no usable answer."""
    import certifi
    import requests

    response = requests.get(RELEASE_API, timeout=10, verify=certifi.where(), headers={
        "Accept": "application/vnd.github+json", "User-Agent": "DeckyGCM",
    })
    if response.status_code != 200:
        return "", ""
    data = response.json()
    if not isinstance(data, list):
        return "", ""
    return newest(item.get("tag_name") for item in data if isinstance(item, dict) and not item.get("draft"))


def update(now: float | None = None) -> dict:
    """The installed version and the newest one worth offering; checks GitHub when the
    last check is a day old. A test build is offered the newest version of all, a
    release only the newest release."""
    now = time.time() if now is None else now
    current = _version(decky.DECKY_PLUGIN_VERSION) or str(decky.DECKY_PLUGIN_VERSION)
    with _lock:
        state = read_json(PATH)
        latest, release = _version(state.get("latest")), _version(state.get("release"))
        due = state.get("next_check")
        if not isinstance(due, (int, float)) or isinstance(due, bool) or now >= due or due > now + INTERVAL:
            try:
                fetched = _fetch()
            except Exception:  # noqa: BLE001 - any failure only delays the next check
                fetched = ("", "")
            if fetched[0]:
                latest, release = fetched
            try:
                write_json(PATH, {"latest": latest, "release": release,
                                  "next_check": now + (INTERVAL if fetched[0] else RETRY_AFTER_FAILURE)})
            except OSError:
                pass
    offered = latest if "-" in _version(current) else release
    return {"current": current, "latest": offered if is_newer(offered, current) else ""}


def _test_build() -> str:
    """The installed version when it is a test build ("x.y.z-test"), otherwise ""."""
    current = _version(decky.DECKY_PLUGIN_VERSION)
    return current if "-" in current else ""


def test_notice() -> str:
    """The test build whose notice is still to be shown, once per installed
    test version; "" for a release, which never shows it."""
    current = _test_build()
    if not current:
        return ""
    with _lock:
        return "" if read_json(NOTICE_PATH).get("seen") == current else current


def acknowledge_test_notice() -> None:
    """Records that the installed test build's notice was seen."""
    current = _test_build()
    if current:
        with _lock:
            write_json(NOTICE_PATH, {"seen": current})


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
