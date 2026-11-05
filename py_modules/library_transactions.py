"""Staged library migrations and installations; callers hold the library transaction lock."""
from __future__ import annotations
import os
import shutil
import tempfile
import uuid
from pathlib import Path
import decky
from library_storage import METADATA, write_json, remove as _remove


def migrate(source: Path, target: Path, save):
    children = list(source.iterdir()) if source.exists() else []
    # Workers retain their staging directories until installation finishes.
    children = [p for p in children if not p.name.startswith((".gcm-download-", ".gcm-import-", ".gcm-migrate-"))]
    if any(os.path.lexists(target / p.name) for p in children):
        raise ValueError("library_conflict")
    published = []
    committed = False
    try:
        with tempfile.TemporaryDirectory(prefix=".gcm-migrate-", dir=target) as temporary:
            staging = Path(temporary)
            for child in children:
                copied = staging / child.name
                if child.is_symlink():
                    copied.symlink_to(os.readlink(child), target_is_directory=child.is_dir())
                elif child.is_dir():
                    shutil.copytree(child, copied, symlinks=True)
                else:
                    shutil.copy2(child, copied)
            for child in children:
                destination = target / child.name
                if os.path.lexists(destination):
                    raise ValueError("library_conflict")
                (staging / child.name).rename(destination)
                published.append(destination)
            save()
            committed = True
    except Exception:
        if not committed:
            for destination in reversed(published):
                _remove(destination)
            raise
        decky.logger.warning("Trainer path saved; temporary cleanup failed.")
    for child in children:
        try:
            _remove(child)
        except OSError:
            decky.logger.warning("Trainer migrated; original file cleanup failed.")


def publish(content: Path, name: str, root: Path, original_root: Path, commit=None) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    target = root / name
    if os.path.lexists(target):
        raise ValueError("library_conflict")
    if root.resolve() == original_root.resolve():
        if commit:
            commit(content, target)
        else:
            content.rename(target)
    else:
        committed = False
        try:
            with tempfile.TemporaryDirectory(prefix=".gcm-migrate-", dir=root) as temporary:
                copied = Path(temporary) / "content"
                shutil.copytree(content, copied, symlinks=True)
                if commit:
                    commit(copied, target)
                else:
                    copied.rename(target)
                committed = True
        except OSError:
            if not committed:
                raise
            decky.logger.warning("Trainer installed; temporary cleanup failed.")
    return target


def import_file(original: Path, root: Path, app_id: str, game_name: str) -> dict:
    # Publish files and their game association together without replacing existing files.
    committed = False
    try:
        with tempfile.TemporaryDirectory(prefix=".gcm-import-", dir=root) as temporary:
            content = Path(temporary) / "content"
            content.mkdir()
            shutil.copy2(original, content / original.name)
            write_json(content / METADATA, {"schema_version": 1, "trainer_name": original.stem,
                       "game_name": game_name, "app_ids": [app_id], "origin": "Local file"})
            target = root / f"Imported [{uuid.uuid4().hex[:12]}]"
            content.rename(target)
            committed = True
    except OSError:
        if not committed:
            raise
        decky.logger.warning("Imported trainer; temporary cleanup failed.")
    return {"path": str(target), "filename": original.name}
