"""The per-game folders of the trainer library. Callers hold the library lock."""
from __future__ import annotations

import os
from pathlib import Path

import library_layout
from library_storage import METADATA, read_json, write_json


def app_id_of(folder: Path) -> str:
    """The game a folder belongs to, or "" for anything that is not a game folder."""
    record = folder / library_layout.GAME_RECORD
    if folder.is_symlink() or not folder.is_dir() or record.is_symlink():
        return ""
    # A trainer folder is never a game folder, whatever files its download brought along.
    if os.path.lexists(folder / METADATA):
        return ""
    return library_layout.record_app_id(read_json(record))


def find(root: Path, app_id: str) -> Path | None:
    """The game's folder, whatever name the game had when it was made."""
    try:
        children = sorted(root.iterdir(), key=lambda path: path.name.casefold())
    except OSError:
        return None
    return next((child for child in children if app_id_of(child) == app_id), None)


def ensure(root: Path, app_id: str, game_name: str) -> Path:
    """The game's one folder, made when it has none yet."""
    existing = find(root, app_id)
    if existing is not None:
        return existing
    name = library_layout.game_folder_name(game_name, app_id)
    folder = root / name
    # A file, a link or a trainer of that name stays as it is.
    for attempt in range(2, 100):
        if not os.path.lexists(folder):
            break
        folder = root / f"{name} ({attempt})"
    else:
        raise ValueError("library_conflict")
    folder.mkdir(parents=True)
    try:
        write_json(folder / library_layout.GAME_RECORD, library_layout.game_record(app_id, game_name))
    except BaseException:
        # Without its record the folder would never be found again, and the next download would make another.
        try:
            folder.rmdir()
        except OSError:
            pass
        raise
    return folder


def prune(folder: Path) -> None:
    """Removes a game folder that holds nothing but its record."""
    try:
        if not app_id_of(folder) or any(child.name != library_layout.GAME_RECORD for child in folder.iterdir()):
            return
        (folder / library_layout.GAME_RECORD).unlink()
        folder.rmdir()
    except OSError:
        pass  # An empty folder left behind does no harm.
