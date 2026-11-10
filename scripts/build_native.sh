#!/usr/bin/env bash
# Builds the Windows trainer starter (bin/gcm-start.exe) with MinGW-w64.
# CI runs this; local builds and tests work without it, and the launcher then
# starts every program the old way.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
"${CC:-x86_64-w64-mingw32-gcc}" -O2 -s -Wall -Wextra -Werror -static-libgcc \
  -o bin/gcm-start.exe native/gcm_start.c -lshell32 -luser32
echo "Built bin/gcm-start.exe"
