"""Changes to the shared on-disk trainer library, each one under the library lock."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import library_games
import library_scan
import library_settings
import library_transactions
import trainer_cache
from library_scan import LINKED_ORIGIN
from library_settings import LOCK, TRAINER_EXTENSIONS, directory
from library_storage import METADATA, read_json

WRONG_FILE = "Choose an .exe, .bat or .ct file."


def set_directory(path: str) -> str:
    if not path.strip():
        raise ValueError("Choose an existing folder.")
    target = Path(os.path.expanduser(path)).resolve(strict=True)
    if not target.is_dir():
        raise ValueError("Choose a folder, not a file.")
    # Confirm that downloads can actually be installed here before saving.
    with tempfile.TemporaryFile(dir=target):
        pass
    with LOCK:
        source = Path(directory()).resolve()
        if source == target:
            return str(target)
        if source.is_relative_to(target) or target.is_relative_to(source):
            raise ValueError("library_nested")
        library_transactions.migrate(source, target, lambda: library_settings.save_directory(str(target)))
    return str(target)


def cleanup_trash():
    with LOCK:
        trainer_cache.cleanup_trash(Path(directory()))


def _game_names(game_name: str) -> list[str]:
    """The game's name and its translations, which trainers without an app ID are matched by."""
    names = [game_name] if game_name else []
    try:
        import gcm_bridge
        index = gcm_bridge.load_search_index()
        index.translation_index.refresh()
        for lang in ("en", "zh"):
            translated = index.translation_index.translate(game_name, lang)
            if translated:
                names.append(translated)
    except (ImportError, OSError, ValueError, RuntimeError):
        pass  # Existing files remain usable without the online database/deps.
    return list(dict.fromkeys(names))


def scan(app_id: str = "", game_name: str = "") -> dict:
    names = _game_names(game_name) if app_id and game_name else []
    with LOCK:
        return library_scan.scan(app_id, names)


def _destination(root: Path, app_id: str, game_name: str) -> Path:
    """Where a game's trainers are installed: its own folder, or the library for no game."""
    return library_games.ensure(root, app_id, game_name) if app_id else root


def restore_trainer(trainer: dict, app_ids: list[str], commit=None, check=lambda: None,
                    app_id: str = "", game_name: str = ""):
    with LOCK:
        root = Path(directory()).resolve()
        made: list[Path] = []

        def destination() -> Path:
            made.append(_destination(root, app_id, game_name))
            return made[-1]

        restored = None
        try:
            restored = trainer_cache.restore_trainer(root, trainer, app_ids, commit, check, destination)
        finally:
            if restored is None:
                # Nothing was restored: a game folder made for it holds only its record.
                for folder in made:
                    library_games.prune(folder)
        return restored


def publish_download(content: Path, name: str, original_root: Path, commit=None,
                     app_id: str = "", game_name: str = "") -> Path:
    """Publish complete content to the latest path, including across filesystems.

    A download for a game goes into that game's folder. The path is resolved
    like the scanned library entries (the default folder can sit behind a
    symlink, such as /home -> /var/home), so callers can match them.
    """
    with LOCK:
        root = Path(directory()).resolve()
        root.mkdir(parents=True, exist_ok=True)
        folder = _destination(root, app_id, game_name)
        try:
            return library_transactions.publish(content, name, root, original_root, commit, folder)
        except BaseException:
            library_games.prune(folder)
            raise


def entry(entry_id: str, expected_directory: str) -> dict:
    if os.path.realpath(expected_directory) != os.path.realpath(directory()):
        raise ValueError("library_changed")
    for item in scan()["trainers"]:
        if item["id"] == entry_id:
            return item
    raise ValueError("Trainer no longer exists. Refresh the library.")


def executable(entry_id: str, filename: str, expected_directory: str) -> str:
    with LOCK:
        item = entry(entry_id, expected_directory)
        if filename not in item["files"]:
            raise ValueError("Unknown trainer file.")
        if item["origin"] == LINKED_ORIGIN:
            target = Path(item["path"]).resolve(strict=True)
            if not target.is_file() or target.suffix.lower() not in TRAINER_EXTENSIONS:
                raise ValueError(WRONG_FILE)
            return str(target)
        base = Path(item["path"])
        target = (base / filename if base.is_dir() else base).resolve(strict=True)
        root = Path(directory()).resolve(strict=True)
        if not target.is_relative_to(root) or not target.is_file() or target.suffix.lower() not in TRAINER_EXTENSIONS:
            raise ValueError(WRONG_FILE)
        return str(target)


def link_file(source: str, app_id: str, game_name: str, expected_directory: str) -> dict:
    """Use a local program where it is; nothing is copied."""
    with LOCK:
        if os.path.realpath(expected_directory) != os.path.realpath(directory()):
            raise ValueError("library_changed")
        path = Path(source).expanduser().resolve(strict=True)
        if not path.is_file() or path.suffix.lower() not in TRAINER_EXTENSIONS:
            raise ValueError(WRONG_FILE)
        links = [item for item in library_settings.links()
                 if not (item["app_id"] == app_id and item["path"] == str(path))]
        links.append({"path": str(path), "app_id": app_id, "game_name": game_name})
        library_settings.save_links(links)
        return {"path": str(path), "filename": path.name}


def delete(entry_id: str, expected_directory: str, app_id: str) -> None:
    with LOCK:
        item = entry(entry_id, expected_directory)
        if item["origin"] == LINKED_ORIGIN:
            # Only forget the link; the user's own file stays untouched.
            library_settings.save_links(
                [link for link in library_settings.links() if library_settings.link_id(link) != entry_id])
            return
        if item["app_ids"] and any(value != app_id for value in item["app_ids"]):
            raise ValueError("This trainer is shared with another game and cannot be deleted here.")
        root = Path(directory()).resolve(strict=True)
        target = Path(item["path"])
        resolved = target.resolve(strict=True)
        parent = resolved.parent
        # A trainer sits in the library itself or in one of its game folders.
        in_game_folder = parent.parent == root and bool(library_games.app_id_of(parent))
        if target.is_symlink() or not (parent == root or in_game_folder):
            raise ValueError("Trainer is outside the current library.")
        # Only plugin-managed folders can be recursively deleted. Existing folders may
        # contain unrelated files and must be removed by the user outside the plugin.
        if target.is_dir():
            if read_json(target / METADATA).get("schema_version") != 1:
                raise ValueError("Only trainers downloaded or imported by this plugin can be deleted.")
        trainer_cache.store(root, target)
        if in_game_folder:
            library_games.prune(parent)
