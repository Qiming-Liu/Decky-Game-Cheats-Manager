"""Build a source-free CPython 3.14 release without modifying the dev tree.

The reversible bytecode packing raises inspection cost; it is not encryption.
"""
from __future__ import annotations

import argparse
import importlib.util
import marshal
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]


def packed_loader(source: bytes, filename: str) -> str:
    # Do not put literal credentials or original source into the loader/pyc.
    code = compile(source, filename, "exec", dont_inherit=True, optimize=0)
    key = os.urandom(32)
    payload = zlib.compress(marshal.dumps(code), level=9)
    payload = bytes(value ^ key[index % len(key)] for index, value in enumerate(payload))
    # A separate namespace prevents loader temporaries from changing module globals.
    return (
        "def _gcm_unpack():\n"
        " import marshal,zlib\n"
        f" k={key!r}\n"
        f" p={payload!r}\n"
        " return marshal.loads(zlib.decompress(bytes(v^k[i%len(k)] for i,v in enumerate(p))))\n"
        "exec(_gcm_unpack(),globals())\n"
        "del _gcm_unpack\n"
    )


def protect_python(path: Path, root: Path):
    filename = path.relative_to(root).as_posix()
    loader = packed_loader(path.read_bytes(), filename)
    if filename == "main.py":
        # Decky checks for and loads this exact source entry point.
        path.write_text(loader, encoding="utf-8")
        return
    code = compile(loader, filename, "exec", dont_inherit=True)
    # Adjacent .pyc files support sourceless imports, including __init__.pyc.
    header = importlib.util.MAGIC_NUMBER + struct.pack("<III", 0, 0, 0)
    path.with_suffix(".pyc").write_bytes(header + marshal.dumps(code))
    path.unlink()


def stage(root: Path, destination: Path):
    destination.mkdir()
    for name in ("plugin.json", "package.json", "main.py", "LICENSE", "README.md"):
        shutil.copy2(root / name, destination / name)
    shutil.copytree(root / "py_modules", destination / "py_modules", ignore=shutil.ignore_patterns(
        "__pycache__", "*.pyc", "*.pyo", "secret_config.py", "*.pyd", "*.map",
    ))
    shutil.copytree(root / "db", destination / "db")
    (destination / "dist").mkdir()
    # Rollup's sole runtime entry point. Never ship maps or development bundles.
    subprocess.run(["node", str(ROOT / "scripts/obfuscate_release.mjs"),
                    str(root / "dist/index.js"), str(destination / "dist/index.js")], check=True)
    (destination / "gcm").mkdir()
    shutil.copy2(root / "gcm/LICENSE.txt", destination / "gcm/LICENSE.txt")
    for source in sorted(destination.rglob("*.py")):
        protect_python(source, destination)


def package(output: Path):
    if sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 14):
        raise RuntimeError("Release packaging requires Decky's CPython 3.14 bytecode format")
    if not (ROOT / "py_modules/_gcm_core/auth.py").is_file():
        raise RuntimeError("Generate the authenticated GCM core before packaging")
    if not (ROOT / "py_modules/_vendor/requests/__init__.py").is_file():
        raise RuntimeError("Vendor Linux Python dependencies before packaging")
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="gcm-release-") as temporary:
        destination = Path(temporary) / "DeckyGCM"
        stage(ROOT, destination)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(destination.rglob("*")):
                if path.is_file():
                    archive.write(path, "DeckyGCM/" + path.relative_to(destination).as_posix())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    package(parser.parse_args().output)
