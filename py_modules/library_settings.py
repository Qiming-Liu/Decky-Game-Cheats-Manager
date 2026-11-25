"""Where the trainer library is, and the local files linked to games."""
from __future__ import annotations

import hashlib
import os
import threading

import decky
import plugin_data
from library_layout import is_app_id
from library_storage import read_json, write_json

_DATA = plugin_data.load("library")
DEFAULT_DIRECTORY = os.path.join(decky.DECKY_USER_HOME, _DATA["default_folder"])
SETTINGS_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "library.json")
PROGRAM_EXTENSIONS = set(_DATA["program_extensions"])
# Tables open through Cheat Engine; the launcher passes them to it.
TABLE_EXTENSIONS = set(_DATA["table_extensions"])
TRAINER_EXTENSIONS = PROGRAM_EXTENSIONS | TABLE_EXTENSIONS
# Serializes every library transaction. Take it before the download job lock.
LOCK = threading.RLock()


def directory() -> str:
    with LOCK:
        value = read_json(SETTINGS_PATH).get("directory")
        return value if isinstance(value, str) and value.strip() else DEFAULT_DIRECTORY


def save_directory(path: str) -> None:
    write_json(SETTINGS_PATH, {**read_json(SETTINGS_PATH), "directory": path})


def links() -> list[dict]:
    value = read_json(SETTINGS_PATH).get("linked")
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict) and isinstance(item.get("path"), str)
            and is_app_id(item.get("app_id")) and isinstance(item.get("game_name", ""), str)]


def link_id(link: dict) -> str:
    return "link-" + hashlib.sha256(f"{link['app_id']}/{link['path']}".encode()).hexdigest()[:20]


def save_links(items: list[dict]) -> None:
    write_json(SETTINGS_PATH, {**read_json(SETTINGS_PATH), "linked": items})
