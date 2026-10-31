"""Verified deleted trainer cache. Callers serialize library transactions."""
from __future__ import annotations
import hashlib
import os
import re
import time
import uuid
from pathlib import Path
import decky
from library_storage import METADATA, read_json, write_json, remove

TRASH_DIRECTORY = ".gcm-trash"
TRASH_RECORD = ".gcm-trash.json"
TRASH_MAX_AGE = 24 * 60 * 60
OWNER_RECORD = ".gcm-owner.json"
OWNER = {"owner": "decky-game-cheats-manager", "schema_version": 1}


def content_hashes(folder: Path, check=lambda: None) -> dict:
    """Hash every installed support file; links cannot be reused as cached content."""
    hashes = {}
    for path in sorted(folder.rglob("*")):
        check()
        if path.is_symlink():
            raise ValueError("Trainer cache cannot contain symbolic links.")
        if path.is_file() and path != folder / METADATA:
            with path.open("rb") as source:
                digest = hashlib.sha256()
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    check()
                    digest.update(block)
                hashes[path.relative_to(folder).as_posix()] = digest.hexdigest()
    return hashes


def _trash_root(root: Path, create=False):
    trash = root / TRASH_DIRECTORY
    if trash.is_symlink() or (trash.exists() and not trash.is_dir()):
        raise ValueError("The trainer trash path must be a regular folder.")
    if trash.exists():
        marker = trash / OWNER_RECORD
        if marker.is_symlink() or read_json(marker) != OWNER:
            raise ValueError("The trainer trash folder is not owned by this plugin.")
    elif create:
        trash.mkdir()
        try:
            write_json(trash / OWNER_RECORD, OWNER)
        except OSError:
            if not any(trash.iterdir()):
                trash.rmdir()
            raise
    return trash


def _trash_items(trash: Path):
    if not trash.exists():
        return
    for item in trash.iterdir():
        if item.is_symlink() or not item.is_dir() or not re.fullmatch(r"[0-9a-f]{32}", item.name):
            continue
        record_path = item / TRASH_RECORD
        if record_path.is_symlink():
            continue
        record = read_json(record_path)
        deleted_at = record.get("deleted_at")
        if record.get("schema_version") == 1 and type(deleted_at) in (int, float) and 0 < deleted_at <= time.time():
            yield item, record


def migrate_legacy(root: Path):
    """Move only recognized cache records; preserve the user's ordinary trash folder."""
    legacy = root / "trash"
    if legacy.is_symlink() or not legacy.is_dir():
        return
    for item, _ in _trash_items(legacy):
        content = item / "content"
        if content.is_symlink() or not content.exists():
            continue
        trash = _trash_root(root, create=True)
        target = trash / item.name
        if not os.path.lexists(target):
            item.rename(target)


def cleanup_trash(root: Path):
    """Clean on startup or page opening; leave unrecognized user files untouched."""
    try:
        migrate_legacy(root)
        trash = _trash_root(root)
        for item, record in _trash_items(trash):
            if time.time() - record["deleted_at"] >= TRASH_MAX_AGE:
                try:
                    remove(item)
                except OSError:
                    decky.logger.warning("Could not clean an expired trainer cache entry.")
    except (OSError, ValueError):
        decky.logger.warning("Could not inspect the trainer trash folder.")


def restore_trainer(root: Path, trainer: dict, app_ids: list[str], commit=None, check=lambda: None):
    """Restore an unchanged download without a network request or an age check."""
    try:
        migrate_legacy(root)
        trash = _trash_root(root)
        for item, record in _trash_items(trash):
            content = item / "content"
            if content.is_symlink() or not content.is_dir():
                continue
            metadata_path = content / METADATA
            if metadata_path.is_symlink():
                continue
            metadata = read_json(metadata_path)
            if metadata.get("schema_version") != 1:
                continue
            if not all(metadata.get(key) == value for key, value in {
                "trainer_id": trainer["id"], "origin": trainer.get("origin", ""),
                "source_path": trainer["url"], "version": trainer.get("version", ""),
            }.items()):
                continue
            name = record.get("original_name")
            if not isinstance(name, str) or not name or name.startswith(".") or name == "trash" or Path(name).name != name:
                continue
            target = root / name
            if os.path.lexists(target):
                continue
            hashes = metadata.get("content_hashes")
            if not isinstance(hashes, dict) or not hashes or content_hashes(content, check) != hashes:
                continue
            check()
            if commit is None:
                metadata["app_ids"] = list(app_ids)
                write_json(metadata_path, metadata)
                content.rename(target)
            else:
                commit(content, target, metadata)
            # Publication is committed; cleanup must not turn success into a failure.
            try:
                remove(item)
            except OSError:
                decky.logger.warning("Trainer restored; cache record cleanup failed.")
            return target
    except (OSError, ValueError):
        decky.logger.warning("Trainer cache could not be restored; downloading a new copy.")
    return None


def store(root: Path, target: Path):
    migrate_legacy(root)
    trash = _trash_root(root, create=True)
    cached = trash / uuid.uuid4().hex
    cached.mkdir()
    try:
        write_json(cached / TRASH_RECORD, {
            "schema_version": 1, "deleted_at": time.time(), "original_name": target.name,
        })
        target.rename(cached / "content")
    except Exception:
        # A failed move must preserve the original trainer.
        remove(cached)
        raise
