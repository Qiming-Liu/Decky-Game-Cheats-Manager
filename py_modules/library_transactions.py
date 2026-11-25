"""Staged library migrations and installations; callers hold the library transaction lock."""
from __future__ import annotations
import os
import shutil
import tempfile
from pathlib import Path
import decky
import library_games
from library_layout import GAME_RECORD
from library_storage import remove as _remove


def _moves(children: list[Path], target: Path) -> tuple[list[tuple[Path, Path]], list[Path]]:
    """Where each thing goes, and the game folders that are merged rather than moved.

    A game has one folder: when the target already holds one for the same
    game, the trainers move into it instead of a second folder appearing."""
    moves, merged = [], []
    for child in children:
        app_id = library_games.app_id_of(child)
        existing = library_games.find(target, app_id) if app_id else None
        if existing is None:
            moves.append((child, target / child.name))
            continue
        merged.append(child)
        moves += [(inner, existing / inner.name) for inner in child.iterdir() if inner.name != GAME_RECORD]
    return moves, merged


def _copy(source: Path, copied: Path) -> None:
    if source.is_symlink():
        copied.symlink_to(os.readlink(source), target_is_directory=source.is_dir())
    elif source.is_dir():
        shutil.copytree(source, copied, symlinks=True)
    else:
        shutil.copy2(source, copied)


def migrate(source: Path, target: Path, save):
    children = list(source.iterdir()) if source.exists() else []
    # Workers retain their staging directories until installation finishes.
    children = [p for p in children if not p.name.startswith((".gcm-download-", ".gcm-import-", ".gcm-migrate-"))]
    # The launcher's files stay, so launch options naming them keep working;
    # the launcher writes its own copy into the new folder.
    children = [p for p in children if p.name not in (".gcm.bat", ".gcm-start.exe", ".gcm-pipewait.dll", ".gcm-launch.log")]
    moves, merged = _moves(children, target)
    if any(os.path.lexists(destination) for _, destination in moves):
        raise ValueError("library_conflict")
    published = []
    committed = False
    try:
        with tempfile.TemporaryDirectory(prefix=".gcm-migrate-", dir=target) as temporary:
            staging = Path(temporary)
            for index, (item, _) in enumerate(moves):
                _copy(item, staging / str(index))
            for index, (_, destination) in enumerate(moves):
                if os.path.lexists(destination):
                    raise ValueError("library_conflict")
                (staging / str(index)).rename(destination)
                published.append(destination)
            save()
            committed = True
    except Exception:
        if not committed:
            for destination in reversed(published):
                _remove(destination)
            raise
        decky.logger.warning("Trainer path saved; temporary cleanup failed.")
    for item, _ in moves:
        try:
            _remove(item)
        except OSError:
            decky.logger.warning("Trainer migrated; original file cleanup failed.")
    for folder in merged:
        library_games.prune(folder)


def publish(content: Path, name: str, root: Path, original_root: Path, commit=None, folder: Path | None = None) -> Path:
    """Installs `content` as `name` in `folder`, a folder of the library `root` (by default `root` itself)."""
    root.mkdir(parents=True, exist_ok=True)
    target = (folder or root) / name
    if os.path.lexists(target):
        raise ValueError("library_conflict")
    if root.resolve() == original_root.resolve():
        if commit:
            commit(content, target, root)
        else:
            content.rename(target)
    else:
        committed = False
        try:
            with tempfile.TemporaryDirectory(prefix=".gcm-migrate-", dir=root) as temporary:
                copied = Path(temporary) / "content"
                shutil.copytree(content, copied, symlinks=True)
                if commit:
                    commit(copied, target, root)
                else:
                    copied.rename(target)
                committed = True
        except OSError:
            if not committed:
                raise
            decky.logger.warning("Trainer installed; temporary cleanup failed.")
    return target
