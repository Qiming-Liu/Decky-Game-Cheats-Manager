"""Whether the player agreed to run a table file.

Cheat Engine runs a table's scripts without asking, so the player confirms a
local table when importing it (src/views/confirmTable.tsx). Only the file's
name is recorded then, and a table whose name was confirmed counts as
confirmed wherever it lies and whatever it now holds. A table a download
holds needs no confirmation. A local table that can run code and whose name
was never confirmed is shown with a warning until the player confirms it.
Nothing here stops Cheat Engine: the warning is the whole check.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import decky
import trainer_table
from library_storage import METADATA, read_json, write_json

TRUST_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "table_trust.json")
# A download's own folder is at most this many levels above its table file.
MAX_DEPTH = 6
_lock = threading.Lock()


def _table(path: str) -> Path:
    file = Path(path).expanduser().resolve(strict=True)
    if file.suffix.lower() not in trainer_table.TABLE_EXTENSIONS or not file.is_file():
        raise ValueError("Choose a .ct file.")
    return file


def _names(stored: dict) -> set[str]:
    """The confirmed names. Earlier versions stored a hash per full path; their names count."""
    names = stored.get("names")
    if isinstance(names, list):
        return {name for name in names if isinstance(name, str)}
    return {os.path.basename(key) for key in stored}


def _downloaded(file: Path) -> bool:
    """Whether a download holds this file."""
    folder = file.parent
    for _ in range(MAX_DEPTH):
        hashes = read_json(folder / METADATA).get("content_hashes")
        if isinstance(hashes, dict):
            return file.relative_to(folder).as_posix() in hashes
        if folder.parent == folder:
            break
        folder = folder.parent
    return False


def _code(file: Path) -> list[str] | None:
    """What in the file can run code, or None when it cannot be read (an encrypted .cetrainer)."""
    try:
        return trainer_table.read(str(file))["code"]
    except (OSError, ValueError):
        return None


def status(path: str) -> dict:
    """`state`: "ok", or "unconfirmed" (a local table that can run code whose
    name was never confirmed); `code` as trainer_table.read reports it, None
    when unreadable."""
    file = _table(path)
    with _lock:
        confirmed = file.name in _names(read_json(TRUST_PATH))
    code = _code(file)
    state = "ok" if confirmed or code == [] or _downloaded(file) else "unconfirmed"
    return {"state": state, "code": code}


def confirm(path: str) -> None:
    """Records the file's name as one the player agreed to run."""
    file = _table(path)
    with _lock:
        names = _names(read_json(TRUST_PATH))
        names.add(file.name)
        write_json(TRUST_PATH, {"names": sorted(names)})
