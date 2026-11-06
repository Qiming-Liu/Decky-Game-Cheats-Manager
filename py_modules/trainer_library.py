"""A shared on-disk trainer library, including existing GCM folders."""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
import threading
import unicodedata
from pathlib import Path

import shutil

import decky
import trainer_cache
import library_transactions
from library_storage import METADATA, read_json, write_json
from trainer_cache import TRASH_RECORD, TRASH_MAX_AGE, content_hashes

DEFAULT_DIRECTORY = os.path.join(decky.DECKY_USER_HOME, "DeckyGCM")
SETTINGS_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "library.json")
PROGRAM_EXTENSIONS = {".exe", ".bat"}
# Tables open through Cheat Engine; the launcher passes them to it.
TABLE_EXTENSIONS = {".ct", ".cetrainer"}
TRAINER_EXTENSIONS = PROGRAM_EXTENSIONS | TABLE_EXTENSIONS
LINKED_ORIGIN = "Linked file"
CHEAT_ENGINE = "Cheat Engine.exe"
# The files the plugin adds to a Cheat Engine installation, from its resources.
RESOURCES = Path(decky.DECKY_PLUGIN_DIR) / "resources"
BRIDGE_SCRIPT = "decky_gcm.lua"
LANGUAGE_PACK = "zh_CN"
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
        library_transactions.migrate(
            source, target, lambda: write_json(SETTINGS_PATH, {**read_json(SETTINGS_PATH), "directory": str(target)}))
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
            "author": metadata.get("author", ""),
        }
        if any(Path(f).name.lower() == CHEAT_ENGINE.lower() for f in entry["files"]):
            # Cheat Engine is shared by every game and never listed as a trainer.
            entry["cheat_engine"] = True
            if app_id:
                continue
        if not app_id or _matches(entry, app_id, names):
            entries.append(entry)
    shown = [Path(item["path"]) for item in entries]
    for link in _links():
        path = Path(link["path"])
        if app_id and link["app_id"] != app_id:
            continue
        # A file inside a listed library entry is already reachable through it.
        if any(path == folder or path.is_relative_to(folder) for folder in shown):
            continue
        entries.append({
            "id": _link_id(link), "name": path.stem, "path": str(path), "files": [path.name],
            "trainer_id": "", "game_name": link["game_name"], "app_ids": [link["app_id"]],
            "version": "", "origin": LINKED_ORIGIN, "author": "", "missing": not path.is_file(),
        })
    return {"directory": str(root), "trainers": entries}


def _cheat_engine_folder() -> Path | None:
    """The Cheat Engine folder in use: a linked one first, else the newest in the library."""
    linked = read_json(SETTINGS_PATH).get("cheat_engine")
    if isinstance(linked, str) and linked and (Path(linked) / CHEAT_ENGINE).is_file():
        return Path(linked)
    found = [Path(item["path"]) for item in _scan()["trainers"] if item.get("cheat_engine")]
    found = [folder for folder in found if folder.is_dir() and (folder / CHEAT_ENGINE).is_file()]
    return max(found, key=lambda folder: folder.stat().st_mtime) if found else None


def cheat_engine() -> dict:
    """Where Cheat Engine is and what the plugin added to it."""
    with _lock:
        folder = _cheat_engine_folder()
        if folder is None:
            return {"installed": False, "path": "", "folder": "", "version": "", "linked": False, "zh_cn": False, "bridge": False}
        metadata = read_json(folder / METADATA)
        version = metadata.get("version") if isinstance(metadata.get("version"), str) else ""
        bridge = folder / "autorun" / BRIDGE_SCRIPT
        script = RESOURCES / BRIDGE_SCRIPT
        return {
            "installed": True, "path": str(folder / CHEAT_ENGINE), "folder": str(folder), "version": version,
            "linked": str(folder) == read_json(SETTINGS_PATH).get("cheat_engine"),
            "zh_cn": (folder / "languages" / LANGUAGE_PACK).is_dir(),
            "bridge": bridge.is_file() and script.is_file() and bridge.read_bytes() == script.read_bytes(),
        }


def _resource(name: str) -> Path:
    path = RESOURCES / name
    if not path.exists():
        raise OSError(f"Plugin resource missing: {name}")
    return path


def install_bridge(folder: str | Path | None = None) -> bool:
    """Copies the Cheat Engine autorun script the plugin talks to; True when it is in place."""
    with _lock:
        target = Path(folder) if folder else _cheat_engine_folder()
        if target is None or not (target / CHEAT_ENGINE).is_file():
            return False
        script = _resource(BRIDGE_SCRIPT)
        destination = target / "autorun" / BRIDGE_SCRIPT
        if destination.is_file() and destination.read_bytes() == script.read_bytes():
            return True
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".tmp")
        shutil.copyfile(script, temporary)
        os.replace(temporary, destination)
        return True


def link_cheat_engine(folder: str) -> None:
    """Uses an existing Cheat Engine folder where it is."""
    with _lock:
        path = Path(os.path.expanduser(folder)).resolve(strict=True)
        if not (path / CHEAT_ENGINE).is_file():
            raise ValueError("cheat_engine_missing")
        write_json(SETTINGS_PATH, {**read_json(SETTINGS_PATH), "cheat_engine": str(path)})
        install_bridge(path)


def remove_cheat_engine() -> None:
    """Forgets a linked Cheat Engine, or moves the library's copy to the trash."""
    with _lock:
        settings = read_json(SETTINGS_PATH)
        if settings.get("cheat_engine"):
            write_json(SETTINGS_PATH, {k: v for k, v in settings.items() if k != "cheat_engine"})
            return
        for item in _scan()["trainers"]:
            if item.get("cheat_engine"):
                delete(item["id"], directory(), "")


def set_cheat_engine_language(enabled: bool) -> None:
    """Adds or removes the Simplified Chinese language pack of Cheat Engine."""
    with _lock:
        folder = _cheat_engine_folder()
        if folder is None:
            raise ValueError("cheat_engine_missing")
        target = folder / "languages" / LANGUAGE_PACK
        if not enabled:
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            return
        source = _resource(os.path.join("ce-languages", LANGUAGE_PACK))
        staging = target.with_name(f".{LANGUAGE_PACK}.tmp")
        if staging.exists():
            shutil.rmtree(staging)
        shutil.copytree(source, staging)
        if target.exists():
            shutil.rmtree(target)
        os.replace(staging, target)


def _links() -> list[dict]:
    value = read_json(SETTINGS_PATH).get("linked")
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict) and isinstance(item.get("path"), str)
            and isinstance(item.get("app_id"), str) and item["app_id"].isascii() and item["app_id"].isdigit()
            and isinstance(item.get("game_name", ""), str)]


def _link_id(link: dict) -> str:
    return "link-" + hashlib.sha256(f"{link['app_id']}/{link['path']}".encode()).hexdigest()[:20]


def _save_links(links: list[dict]) -> None:
    write_json(SETTINGS_PATH, {**read_json(SETTINGS_PATH), "linked": links})


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
        if item["origin"] == LINKED_ORIGIN:
            target = Path(item["path"]).resolve(strict=True)
            if not target.is_file() or target.suffix.lower() not in TRAINER_EXTENSIONS:
                raise ValueError("Choose an .exe, .bat or .ct file.")
            return str(target)
        base = Path(item["path"])
        target = (base / filename if base.is_dir() else base).resolve(strict=True)
        root = Path(directory()).resolve(strict=True)
        if not target.is_relative_to(root) or not target.is_file() or target.suffix.lower() not in TRAINER_EXTENSIONS:
            raise ValueError("Choose an .exe, .bat or .ct file.")
        return str(target)


def link_file(source: str, app_id: str, game_name: str, expected_directory: str) -> dict:
    """Use a local program where it is; nothing is copied."""
    with _lock:
        if os.path.realpath(expected_directory) != os.path.realpath(directory()):
            raise ValueError("library_changed")
        path = Path(source).expanduser().resolve(strict=True)
        if not path.is_file() or path.suffix.lower() not in TRAINER_EXTENSIONS:
            raise ValueError("Choose an .exe, .bat or .ct file.")
        links = [item for item in _links() if not (item["app_id"] == app_id and item["path"] == str(path))]
        links.append({"path": str(path), "app_id": app_id, "game_name": game_name})
        _save_links(links)
        return {"path": str(path), "filename": path.name}


def delete(entry_id: str, expected_directory: str, app_id: str) -> None:
    with _lock:
        item = entry(entry_id, expected_directory)
        if item["origin"] == LINKED_ORIGIN:
            # Only forget the link; the user's own file stays untouched.
            _save_links([link for link in _links() if _link_id(link) != entry_id])
            return
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
