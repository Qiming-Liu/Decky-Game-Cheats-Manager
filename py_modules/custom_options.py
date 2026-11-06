"""Saved custom launch options: ones the user created and detected words.

Only the list is stored here. Whether an option is on for a game is read from
that game's launch options, never stored.
"""
from __future__ import annotations

import os
import re
import threading

import decky
from library_storage import read_json, write_json

PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "custom_options.json")
MAX_OPTIONS = 200
MAX_DEFINITIONS = 50
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_lock = threading.Lock()

# Launchers installed by other tools. Names are shown by the frontend.
PRESETS = [
    {"id": "preset-lsfg", "preset": "lsfg", "name": "", "definitions": ["~/lsfg"]},
    {"id": "preset-optiscaler", "preset": "optiscaler", "name": "", "definitions": ["~/fgmod/fgmod"]},
    {"id": "preset-optiscaler-remove", "preset": "optiscalerRemove", "name": "",
     "definitions": ["~/fgmod/fgmod-uninstaller.sh"]},
    {"id": "preset-mako", "preset": "mako", "name": "", "definitions": ["~/.local/bin/mako-run"]},
]
_PRESET_KEYS = {item["preset"] for item in PRESETS}


def _clean(options) -> list[dict]:
    if not isinstance(options, list) or len(options) > MAX_OPTIONS:
        raise ValueError("Invalid custom launch options.")
    cleaned, seen = [], set()
    for item in options:
        if not isinstance(item, dict):
            raise ValueError("Invalid custom launch options.")
        option_id, name, definitions = item.get("id"), item.get("name", ""), item.get("definitions")
        if not isinstance(option_id, str) or not _ID.match(option_id) or option_id in seen:
            raise ValueError("Invalid custom launch options.")
        if not isinstance(name, str) or len(name) > 80 or any(ord(c) < 32 for c in name):
            raise ValueError("Invalid custom launch options.")
        if (not isinstance(definitions, list) or not 0 < len(definitions) <= MAX_DEFINITIONS
                or any(not isinstance(d, str) or not d.strip() or len(d) > 1024 or "\n" in d for d in definitions)):
            raise ValueError("Invalid custom launch options.")
        seen.add(option_id)
        option = {"id": option_id, "name": name.strip(), "definitions": definitions}
        if item.get("preset") in _PRESET_KEYS:
            option["preset"] = item["preset"]
        if item.get("detected") is True:
            option["detected"] = True
        # An option with an app ID belongs to that game only; others are global.
        app_id = item.get("app_id")
        if app_id is not None:
            if not isinstance(app_id, str) or not app_id.isascii() or not app_id.isdigit() or len(app_id) > 20:
                raise ValueError("Invalid custom launch options.")
            option["app_id"] = app_id
        cleaned.append(option)
    return cleaned


def load() -> list[dict]:
    with _lock:
        data = read_json(PATH)
        if "options" not in data:
            return [dict(item) for item in PRESETS]
        try:
            return _clean(data["options"])
        except ValueError:
            decky.logger.warning("Custom launch options file is invalid; showing presets.")
            return [dict(item) for item in PRESETS]


def save(options) -> list[dict]:
    cleaned = _clean(options)
    with _lock:
        write_json(PATH, {"version": 1, "options": cleaned})
    return cleaned
