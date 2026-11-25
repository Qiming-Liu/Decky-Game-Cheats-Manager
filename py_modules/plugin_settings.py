"""Settings shared by every game: how trainers start alongside a game."""
from __future__ import annotations

import os
import threading

import decky
import plugin_data
from library_storage import read_json, write_json

PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
# Seconds a game runs before its trainers start.
DELAYS = tuple(plugin_data.load("settings")["launch_delays"])
# skip_launcher_check: also edit games a Flatpak or AppImage launcher starts.
# auto_attach: point Cheat Engine at the game by itself once a game with a table starts.
DEFAULTS = dict(plugin_data.load("settings")["defaults"])
# proton_log: write PROTON_LOG=1 next to a trainer command. On by default in a
# test build ("x.y.z-testN"), off in a release. Only a value the user chose is
# saved, so the default follows the installed build.
DEFAULTS["proton_log"] = "-" in str(decky.DECKY_PLUGIN_VERSION)
_FOLLOWS_BUILD = ("proton_log",)
_lock = threading.Lock()


def _clean(data: dict) -> dict:
    settings = dict(DEFAULTS)
    for key in DEFAULTS:
        if key != "launch_delay" and isinstance(data.get(key), bool):
            settings[key] = data[key]
    delay = data.get("launch_delay")
    if isinstance(delay, int) and not isinstance(delay, bool) and delay in DELAYS:
        settings["launch_delay"] = delay
    return settings


def load() -> dict:
    with _lock:
        return _clean(read_json(PATH))


def _saved(settings: dict, chosen: set) -> dict:
    return {key: value for key, value in settings.items() if key not in _FOLLOWS_BUILD or key in chosen}


def reset() -> dict:
    with _lock:
        write_json(PATH, _saved(DEFAULTS, set()))
        return dict(DEFAULTS)


def update(changes: dict) -> dict:
    """Applies known keys with valid values; anything else is rejected."""
    if not isinstance(changes, dict) or not changes:
        raise ValueError("Invalid settings.")
    with _lock:
        stored = read_json(PATH)
        settings = _clean(stored)
        chosen = {key for key in _FOLLOWS_BUILD if isinstance(stored.get(key), bool)} | set(changes)
        for key, value in changes.items():
            if key not in DEFAULTS:
                raise ValueError("Invalid settings.")
            if key == "launch_delay":
                if isinstance(value, bool) or value not in DELAYS:
                    raise ValueError("Invalid settings.")
            elif not isinstance(value, bool):
                raise ValueError("Invalid settings.")
            settings[key] = value
        write_json(PATH, _saved(settings, chosen))
        return settings
