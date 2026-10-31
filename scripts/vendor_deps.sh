#!/usr/bin/env bash
# Vendors requirements.txt into py_modules/_vendor/ for Decky Loader's own
# bundled Python (which has no pip and can't see system site-packages).
# DECKY_PYTHON_VERSION must match the Python inside ~/homebrew/services/PluginLoader
# (`strings PluginLoader | grep -o 'libpython3\.[0-9]*'`), since rapidfuzz ships
# compiled extensions per CPython version.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${REPO_DIR}/py_modules/_vendor"
DECKY_PYTHON_VERSION="${DECKY_PYTHON_VERSION:-3.14}"

rm -rf "$TARGET"
if command -v uv >/dev/null 2>&1; then
    uv pip install \
        --quiet \
        --target "$TARGET" \
        --python-version "$DECKY_PYTHON_VERSION" \
        --python-platform x86_64-manylinux_2_28 \
        --only-binary :all: \
        -r "${REPO_DIR}/requirements.txt"
else
    python3 -m pip install \
        --quiet \
        --target "$TARGET" \
        --python-version "$DECKY_PYTHON_VERSION" \
        --platform manylinux2014_x86_64 \
        --platform manylinux_2_17_x86_64 \
        --only-binary=:all: \
        --no-compile \
        -r "${REPO_DIR}/requirements.txt"
fi
rm -rf "$TARGET/bin"
echo "vendored into $TARGET"
