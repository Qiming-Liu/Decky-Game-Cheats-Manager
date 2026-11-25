"""Names and records of the trainer library's folders. Pure: nothing here touches the disk.

    <library>/
        <Game name> (<app id>)/        one folder per game or non-Steam shortcut
            .gcm-game.json             says which game the folder belongs to
            <Trainer name> [<job>]/    one folder per downloaded trainer
        <Trainer name> [<job>]/        earlier versions put trainers here; still read
        Cheat Engine ... [<job>]/      shared by every game
"""
from __future__ import annotations

import re

import plugin_data

GAME_RECORD = ".gcm-game.json"
SCHEMA_VERSION = 1
MAX_NAME_BYTES = plugin_data.load("library")["max_folder_name_bytes"]


def is_app_id(value) -> bool:
    return isinstance(value, str) and value.isascii() and value.isdigit() and 0 < len(value) <= 20


def safe_name(name: str, fallback: str = "trainer") -> str:
    """A folder name every filesystem takes, and that the launcher's batch file
    can pass on: `%` would be expanded there."""
    name = name.replace(": ", " - ").replace(":", "-").replace("/", "_").replace("?", "")
    name = re.sub(r'[<>"\\|*%\x00-\x1f]', "", name).strip(" .")
    return name.encode("utf-8")[:MAX_NAME_BYTES].decode("utf-8", errors="ignore").strip(" .") or fallback


def game_folder_name(game_name: str, app_id: str) -> str:
    """`Game name (app id)`; the app ID alone for a game without a name."""
    name = safe_name(game_name, "")
    return f"{name} ({app_id})" if name else app_id


def trainer_folder_name(trainer_name: str, job_id: str) -> str:
    return f"{safe_name(trainer_name)} [{job_id[:8]}]"


def game_record(app_id: str, game_name: str) -> dict:
    return {"schema_version": SCHEMA_VERSION, "app_id": app_id, "game_name": game_name}


def record_app_id(record) -> str:
    """The game a folder's record names, or "" when it is not a valid record."""
    if not isinstance(record, dict) or record.get("schema_version") != SCHEMA_VERSION:
        return ""
    app_id = record.get("app_id")
    return app_id if is_app_id(app_id) else ""


def clean_metadata(metadata) -> dict:
    """Trainer metadata with malformed fields dropped, so one damaged entry cannot hide the library."""
    metadata = metadata if isinstance(metadata, dict) else {}
    cleaned = {key: value for key, value in metadata.items() if isinstance(value, str)}
    ids = metadata.get("app_ids")
    cleaned["app_ids"] = [item for item in ids if is_app_id(item)] if isinstance(ids, list) else []
    return cleaned
