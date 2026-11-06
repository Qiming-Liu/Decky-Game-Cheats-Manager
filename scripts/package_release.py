"""Build a source-free CPython 3.14 release without modifying the dev tree.

The reversible bytecode packing raises inspection cost; it is not encryption.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

if __package__:
    from .release_python import protect_python
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from release_python import protect_python

ROOT = Path(__file__).resolve().parents[1]


def stage(root: Path, destination: Path):
    destination.mkdir()
    for name in ("plugin.json", "package.json", "main.py", "LICENSE", "README.md"):
        shutil.copy2(root / name, destination / name)
    shutil.copytree(root / "py_modules", destination / "py_modules", ignore=shutil.ignore_patterns(
        "__pycache__", "*.pyc", "secret_config.py", "*.pyd",
    ))
    shutil.copytree(root / "db", destination / "db")
    if (root / "resources").is_dir():
        shutil.copytree(root / "resources", destination / "resources", ignore=shutil.ignore_patterns("ce-languages"))
    # The Cheat Engine language pack ships from the upstream submodule.
    languages = root / "gcm/src/dependency/CE Translations/zh_CN"
    if languages.is_dir():
        shutil.copytree(languages, destination / "resources/ce-languages/zh_CN")
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
