"""A shared on-disk trainer library, including existing GCM folders."""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
import threading
import unicodedata
from pathlib import Path

import decky
import trainer_cache
import library_transactions
from library_storage import METADATA, read_json, write_json
from trainer_cache import TRASH_RECORD, TRASH_MAX_AGE, content_hashes

DEFAULT_DIRECTORY = os.path.join(decky.DECKY_USER_HOME, "DeckyGCM")
SETTINGS_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "library.json")
TRAINER_EXTENSIONS = {".exe", ".bat", ".ct"}
_lock = threading.RLock()


def directory() -> str:
    with _lock:
        value = read_json(SETTINGS_PATH).get("directory")
        return value if isinstance(value, str) and value.strip() else DEFAULT_DIRECTORY


def set_directory(path: str) -> str:
    if not path.strip():
        raise ValueError("Choose an existing folder.")
    target = Path(os.path.expanduser(path)).resolve(strict=True)
    if not target.is_dir():
        raise ValueError("Choose a folder, not a file.")
    # Confirm that downloads can actually be installed here before saving.
    with tempfile.TemporaryFile(dir=target):
        pass
    with _lock:
        source = Path(directory()).resolve()
        if source == target:
            return str(target)
        if source.is_relative_to(target) or target.is_relative_to(source):
            raise ValueError("library_nested")
        library_transactions.migrate(source, target, lambda: write_json(SETTINGS_PATH, {"directory": str(target)}))
    return str(target)


def cleanup_trash():
    with _lock:
        trainer_cache.cleanup_trash(Path(directory()))


def restore_trainer(trainer: dict, app_ids: list[str], commit=None, check=lambda: None):
    with _lock:
        return trainer_cache.restore_trainer(Path(directory()).resolve(), trainer, app_ids, commit, check)


def publish_download(content: Path, name: str, original_root: Path, commit=None) -> Path:
    """Publish complete content to the latest path, including across filesystems."""
    with _lock:
        return library_transactions.publish(content, name, Path(directory()), original_root, commit)


def _files(folder: Path) -> list[Path]:
    found = []
    for current, dirs, files in os.walk(folder, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (Path(current) / d).is_symlink())
        for name in sorted(files):
            path = Path(current) / name
            if not path.is_symlink() and path.suffix.lower() in TRAINER_EXTENSIONS:
                found.append(path)
    return found


def _normalized(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def _names(game_name: str) -> list[str]:
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


def _matches(entry: dict, app_id: str, names: list[str]) -> bool:
    ids = entry["app_ids"]
    if ids:
        return app_id in ids
    known_name = entry["game_name"]
    if known_name:
        return _normalized(known_name) in {_normalized(n) for n in names}
    # Imported files have no metadata. Keep word/number boundaries so e.g.
    # Portal does not accidentally include Portal 2.
    candidates = [entry["name"], *entry["files"]]
    for candidate in candidates:
        candidate = re.sub(r"^\[[^\]]+\]\s*", "", Path(candidate).stem)
        for name in names:
            pattern = re.escape(name).replace(r"\ ", r"[\s_.-]+")
            if re.search(r"(?<!\w)" + pattern + r"(?!\w|[\s_.-]+\d)", candidate, re.I):
                return True
            # Chinese GCM names commonly use 《title》 without whitespace.
            if any("\u4e00" <= c <= "\u9fff" for c in name) and f"《{name}》" in candidate:
                return True
    return False


def scan(app_id: str = "", game_name: str = "") -> dict:
    with _lock:
        return _scan(app_id, game_name)


def _scan(app_id: str = "", game_name: str = "") -> dict:
    root = Path(directory())
    if str(root) == DEFAULT_DIRECTORY:
        root.mkdir(parents=True, exist_ok=True)
    trainer_cache.migrate_legacy(root)
    entries = []
    names = _names(game_name) if app_id and game_name else []
    for child in sorted(root.iterdir(), key=lambda p: p.name.casefold()):
        if child.name.startswith(".") or child.is_symlink():
            continue
        files = _files(child) if child.is_dir() else ([child] if child.suffix.lower() in TRAINER_EXTENSIONS else [])
        if not files:
            continue
        metadata = read_json(child / METADATA) if child.is_dir() else {}
        # Treat malformed fields as unknown; one damaged entry must not hide the library.
        metadata = {k: v for k, v in metadata.items() if isinstance(v, str) or k == "app_ids"}
        ids = metadata.get("app_ids")
        metadata["app_ids"] = [i for i in ids if isinstance(i, str) and i.isascii() and i.isdigit()] if isinstance(ids, list) else []
        entry = {
            "id": hashlib.sha256(str(child).encode()).hexdigest()[:20],
            "name": metadata.get("trainer_name") or (child.stem if child.is_file() else child.name),
            # Match executable() even when the library uses SteamOS's /home alias.
            "path": str(child.resolve()),
            "files": [str(p.relative_to(child if child.is_dir() else root)) for p in files],
            "trainer_id": metadata.get("trainer_id", ""),
            "game_name": metadata.get("game_name", ""),
            "app_ids": metadata.get("app_ids", []),
            "version": metadata.get("version", ""),
            "origin": metadata.get("origin", ""),
        }
        if not app_id or _matches(entry, app_id, names):
            entries.append(entry)
    return {"directory": str(root), "trainers": entries}


def entry(entry_id: str, expected_directory: str) -> dict:
    if os.path.realpath(expected_directory) != os.path.realpath(directory()):
        raise ValueError("library_changed")
    for item in scan()["trainers"]:
        if item["id"] == entry_id:
            return item
    raise ValueError("Trainer no longer exists. Refresh the library.")


def executable(entry_id: str, filename: str, expected_directory: str) -> str:
    with _lock:
        item = entry(entry_id, expected_directory)
        if filename not in item["files"]:
            raise ValueError("Unknown trainer file.")
        base = Path(item["path"])
        target = (base / filename if base.is_dir() else base).resolve(strict=True)
        root = Path(directory()).resolve(strict=True)
        if not target.is_relative_to(root) or not target.is_file() or target.suffix.lower() not in {".exe", ".bat"}:
            raise ValueError("Choose an .exe or .bat program. Cheat Tables require Cheat Engine.")
        return str(target)


def import_file(source: str, app_id: str, game_name: str, expected_directory: str) -> dict:
    with _lock:
        if os.path.realpath(expected_directory) != os.path.realpath(directory()):
            raise ValueError("library_changed")
        original = Path(source).expanduser().resolve(strict=True)
        if not original.is_file() or original.suffix.lower() != ".exe":
            raise ValueError("Choose an .exe file.")
        root = Path(directory()).resolve(strict=True)
        return library_transactions.import_file(original, root, app_id, game_name)


def delete(entry_id: str, expected_directory: str, app_id: str) -> None:
    with _lock:
        item = entry(entry_id, expected_directory)
        if item["app_ids"] and any(value != app_id for value in item["app_ids"]):
            raise ValueError("This trainer is shared with another game and cannot be deleted here.")
        root = Path(directory()).resolve(strict=True)
        target = Path(item["path"])
        resolved = target.resolve(strict=True)
        if target.is_symlink() or resolved.parent != root:
            raise ValueError("Trainer is outside the current library.")
        # Only plugin-managed folders can be recursively deleted. Existing folders may
        # contain unrelated files and must be removed by the user outside the plugin.
        if target.is_dir():
            if read_json(target / METADATA).get("schema_version") != 1:
                raise ValueError("Only trainers downloaded or imported by this plugin can be deleted.")
        trainer_cache.store(root, target)
