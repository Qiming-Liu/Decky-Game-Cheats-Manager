"""The one Cheat Engine every game shares, and what the plugin adds to it."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import decky
import library_scan
import trainer_library
from library_scan import CHEAT_ENGINE
from library_settings import LOCK, directory
from library_storage import METADATA, read_json

# The files the plugin adds to a Cheat Engine installation, from its resources.
RESOURCES = Path(decky.DECKY_PLUGIN_DIR) / "resources"
BRIDGE_SCRIPT = "decky_gcm.lua"
LANGUAGE_PACK = "zh_CN"
MANAGED_MARKER = ".deckygcm-managed-ce"


def _downloaded(folder: Path) -> bool:
    executable = folder / CHEAT_ENGINE
    if folder.parent != Path(directory()).resolve() or not executable.is_file() or executable.is_symlink():
        return False
    trainer_id = read_json(folder / METADATA).get("trainer_id")
    return isinstance(trainer_id, str) and bool(trainer_id)


def _copies() -> list[dict]:
    """The library entries that are downloaded copies of Cheat Engine."""
    return [item for item in library_scan.scan()["trainers"]
            if item.get("cheat_engine") and _downloaded(Path(item["path"]))]


def _folder() -> Path | None:
    """The newest downloaded Cheat Engine in the library."""
    found = [Path(item["path"]) for item in _copies()]
    return max(found, key=lambda folder: folder.stat().st_mtime) if found else None


def missing() -> dict:
    """The status without a Cheat Engine."""
    return {"installed": False, "path": "", "folder": "", "version": "", "bridge": False}


def status() -> dict:
    """Where Cheat Engine is and what the plugin added to it."""
    with LOCK:
        folder = _folder()
        if folder is None:
            return missing()
        metadata = read_json(folder / METADATA)
        version = metadata.get("version") if isinstance(metadata.get("version"), str) else ""
        bridge = folder / "autorun" / BRIDGE_SCRIPT
        script = RESOURCES / BRIDGE_SCRIPT
        return {
            "installed": True, "path": str(folder / CHEAT_ENGINE), "folder": str(folder), "version": version,
            "bridge": (
                (folder / MANAGED_MARKER).is_file()
                and bridge.is_file() and script.is_file() and bridge.read_bytes() == script.read_bytes()
            ),
        }


def _resource(name: str) -> Path:
    path = RESOURCES / name
    if not path.exists():
        raise OSError(f"Plugin resource missing: {name}")
    return path


def install_bridge(folder: str | Path | None = None) -> bool:
    """Copies the Cheat Engine autorun script the plugin talks to; True when it is in place."""
    with LOCK:
        target = Path(folder).resolve() if folder else _folder()
        if target is None or not _downloaded(target):
            return False
        script = _resource(BRIDGE_SCRIPT)
        destination = target / "autorun" / BRIDGE_SCRIPT
        if not (destination.is_file() and destination.read_bytes() == script.read_bytes()):
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_suffix(".tmp")
            shutil.copyfile(script, temporary)
            os.replace(temporary, destination)
        _install_language(target)
        marker = target / MANAGED_MARKER
        if not marker.is_file():
            marker.touch()
        return True


def _install_language(folder: Path) -> None:
    """Adds the Simplified Chinese language pack when Cheat Engine has none; one already there stays."""
    target = folder / "languages" / LANGUAGE_PACK
    source = RESOURCES / "ce-languages" / LANGUAGE_PACK
    if target.exists() or not source.is_dir():
        return
    staging = target.with_name(f".{LANGUAGE_PACK}.tmp")
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(source, staging)
    os.replace(staging, target)


def replace(new: str | Path) -> Path:
    """Makes a freshly downloaded Cheat Engine the only copy and returns where it is.

    Earlier downloaded copies go to the library trash. The new copy then takes
    the folder name of the one that was in use, so launch options that name
    Cheat Engine by that folder keep working after a reinstall."""
    with LOCK:
        fresh = Path(new).resolve()
        if not _downloaded(fresh):
            return fresh
        earlier = [item for item in _copies() if Path(item["path"]).resolve() != fresh]
        if not earlier:
            return fresh
        used = max((Path(item["path"]) for item in earlier), key=lambda folder: folder.stat().st_mtime)
        for item in earlier:
            trainer_library.delete(item["id"], directory(), "")
        if used.exists():
            return fresh
        fresh.rename(used)
        return used


def remove() -> None:
    """Moves the downloaded copies of Cheat Engine to the library trash."""
    with LOCK:
        for item in _copies():
            trainer_library.delete(item["id"], directory(), "")
