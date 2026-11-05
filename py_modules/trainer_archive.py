"""Extract into private staging; never write archive paths directly to the library."""
from __future__ import annotations

import re
import stat
import zipfile
from pathlib import Path

MAX_FILES = 20000
MAX_BYTES = 8 * 1024**3
ARCHIVE_EXTENSIONS = {".zip", ".7z", ".rar"}


def _target(root: Path, name: str) -> Path:
    name = name.replace("\\", "/")
    parts = name.split("/")
    if name.startswith("/") or any(p == ".." or ":" in p or "\x00" in p for p in parts):
        raise ValueError("Unsafe path in trainer archive.")
    if re.match(r"^[a-zA-Z]:", name):
        raise ValueError("Unsafe path in trainer archive.")
    target = root.joinpath(*parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("Unsafe path in trainer archive.")
    return target


def extract(path: str, destination: str) -> None:
    root = Path(destination)
    root.mkdir(parents=True, exist_ok=True)
    total = count = 0

    def write(name, blocks, is_dir=False):
        nonlocal total, count
        count += 1
        if count > MAX_FILES:
            raise ValueError("Trainer archive contains too many files.")
        target = _target(root, name)
        if is_dir:
            target.mkdir(parents=True, exist_ok=True)
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as out:
            for block in blocks:
                total += len(block)
                if total > MAX_BYTES:
                    raise ValueError("Trainer archive is too large.")
                out.write(block)

    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            if sum(e.file_size for e in archive.infolist()) > MAX_BYTES:
                raise ValueError("Trainer archive is too large.")
            for entry in archive.infolist():
                mode = entry.external_attr >> 16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise ValueError("Links and special files are not allowed in trainer archives.")
                with archive.open(entry) as source:
                    write(entry.filename, iter(lambda: source.read(256 * 1024), b""), entry.is_dir())
    else:
        try:
            import libarchive
        except (ImportError, OSError, TypeError) as e:
            raise RuntimeError("7z/RAR extraction requires libarchive on this device.") from e
        with libarchive.file_reader(path) as archive:
            for entry in archive:
                if entry.issym or entry.islnk or not (entry.isdir or entry.isfile):
                    raise ValueError("Links and special files are not allowed in trainer archives.")
                write(entry.pathname, entry.get_blocks(), entry.isdir)
    if not total:
        raise ValueError("Trainer archive has no file content.")
