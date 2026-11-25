"""Reads the trainer library from disk: both layouts, and the linked local files."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

import library_games
import library_match
import library_settings
import trainer_cache
from library_layout import clean_metadata
from library_storage import METADATA, read_json

LINKED_ORIGIN = "Linked file"
CHEAT_ENGINE = "Cheat Engine.exe"


def _visible(path: Path) -> bool:
    return not path.name.startswith(".") and not path.is_symlink()


def _files(folder: Path) -> list[Path]:
    found = []
    for current, dirs, files in os.walk(folder, followlinks=False):
        dirs[:] = sorted(d for d in dirs if _visible(Path(current) / d))
        for name in sorted(files):
            path = Path(current) / name
            if not path.is_symlink() and path.suffix.lower() in library_settings.TRAINER_EXTENSIONS:
                found.append(path)
    return found


def _children(folder: Path) -> list[Path]:
    return [child for child in sorted(folder.iterdir(), key=lambda p: p.name.casefold()) if _visible(child)]


def _entry(child: Path, game_id: str) -> dict | None:
    """One trainer: a folder, or a single file. `game_id` is the game whose folder holds it."""
    if child.is_dir():
        files = _files(child)
    else:
        files = [child] if child.suffix.lower() in library_settings.TRAINER_EXTENSIONS else []
    if not files:
        return None
    metadata = clean_metadata(read_json(child / METADATA) if child.is_dir() else {})
    return {
        "id": hashlib.sha256(str(child).encode()).hexdigest()[:20],
        "name": metadata.get("trainer_name") or (child.stem if child.is_file() else child.name),
        # Match executable() even when the library is reached through a /home alias.
        "path": str(child.resolve()),
        "files": [str(p.relative_to(child if child.is_dir() else child.parent)) for p in files],
        "trainer_id": metadata.get("trainer_id", ""),
        "game_name": metadata.get("game_name", ""),
        # A trainer in a game folder belongs to that game unless its own record says more.
        "app_ids": metadata["app_ids"] or ([game_id] if game_id else []),
        "version": metadata.get("version", ""),
        "origin": metadata.get("origin", ""),
        "author": metadata.get("author", ""),
    }


def _library_entries(root: Path) -> list[dict]:
    entries = []
    for child in _children(root):
        game_id = library_games.app_id_of(child)
        for item in (_children(child) if game_id else [child]):
            entry = _entry(item, game_id)
            if entry is None:
                continue
            if not game_id and any(Path(name).name.lower() == CHEAT_ENGINE.lower() for name in entry["files"]):
                # Cheat Engine is shared by every game and never listed as a trainer.
                entry["cheat_engine"] = True
            entries.append(entry)
    return entries


def _linked_entry(link: dict) -> dict:
    path = Path(link["path"])
    return {
        "id": library_settings.link_id(link), "name": path.stem, "path": str(path), "files": [path.name],
        "trainer_id": "", "game_name": link["game_name"], "app_ids": [link["app_id"]],
        "version": "", "origin": LINKED_ORIGIN, "author": "", "missing": not path.is_file(),
    }


def scan(app_id: str = "", names: list[str] | None = None) -> dict:
    """Every trainer, or one game's. The caller holds the library lock."""
    root = Path(library_settings.directory())
    if str(root) == library_settings.DEFAULT_DIRECTORY:
        root.mkdir(parents=True, exist_ok=True)
    trainer_cache.migrate_legacy(root)
    entries = [entry for entry in _library_entries(root) if not app_id
               or (not entry.get("cheat_engine") and library_match.matches(entry, app_id, names or []))]
    shown = [Path(item["path"]) for item in entries]
    for link in library_settings.links():
        path = Path(link["path"])
        if app_id and link["app_id"] != app_id:
            continue
        # A file inside a listed library entry is already reachable through it.
        if any(path == folder or path.is_relative_to(folder) for folder in shown):
            continue
        entries.append(_linked_entry(link))
    # Trainer paths are resolved, so callers comparing them need the resolved root too.
    return {"directory": str(root), "real_directory": str(root.resolve()), "trainers": entries}
