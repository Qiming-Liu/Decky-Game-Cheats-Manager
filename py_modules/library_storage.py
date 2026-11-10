"""Atomic metadata writes and filesystem cleanup shared by library transactions."""
from __future__ import annotations
import json
import os
import shutil
import tempfile
from pathlib import Path

METADATA = ".gcm-trainer.json"

def write_json(path: str | Path, data: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as out:
            temporary = out.name
            json.dump(data, out, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def remove_stale_directories(parent: str | Path, prefix: str, before: float) -> None:
    """Remove `prefix*` directories in `parent` last changed before `before`."""
    try:
        entries = list(os.scandir(parent))
    except OSError:
        return
    for entry in entries:
        try:
            if (entry.name.startswith(prefix) and entry.is_dir(follow_symlinks=False)
                    and entry.stat(follow_symlinks=False).st_mtime < before):
                shutil.rmtree(entry.path, ignore_errors=True)
        except OSError:
            continue


def read_json(path: str | Path) -> dict:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink()
