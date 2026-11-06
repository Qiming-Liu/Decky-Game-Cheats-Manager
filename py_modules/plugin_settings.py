"""Settings shared by every game: how trainers start alongside a game."""
from __future__ import annotations

import os
import threading

import decky
from library_storage import read_json, write_json

PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
# Seconds a game runs before its trainers start.
DELAYS = (0, 5, 10, 15, 30, 60)
DEFAULTS = {"allow_multiple": False, "auto_select": True, "launch_delay": 0}
_lock = threading.Lock()


def _clean(data: dict) -> dict:
    settings = dict(DEFAULTS)
    for key in ("allow_multiple", "auto_select"):
        if isinstance(data.get(key), bool):
            settings[key] = data[key]
    delay = data.get("launch_delay")
    if isinstance(delay, int) and not isinstance(delay, bool) and delay in DELAYS:
        settings["launch_delay"] = delay
    return settings


def load() -> dict:
    with _lock:
        return _clean(read_json(PATH))


def update(changes: dict) -> dict:
    """Applies known keys with valid values; anything else is rejected."""
    if not isinstance(changes, dict) or not changes:
        raise ValueError("Invalid settings.")
    with _lock:
        settings = _clean(read_json(PATH))
        for key, value in changes.items():
            if key not in DEFAULTS:
                raise ValueError("Invalid settings.")
            if key == "launch_delay":
                if isinstance(value, bool) or value not in DELAYS:
                    raise ValueError("Invalid settings.")
            elif not isinstance(value, bool):
                raise ValueError("Invalid settings.")
            settings[key] = value
        write_json(PATH, settings)
        return settings
