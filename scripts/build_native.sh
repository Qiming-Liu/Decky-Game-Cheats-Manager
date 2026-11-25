#!/usr/bin/env bash
# Builds the Windows starter and its trainer and Cheat Engine compatibility
# libraries with MinGW-w64.
# CI runs this; local builds and tests work without it, and the launcher then
# starts every program the old way.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
"${CC:-x86_64-w64-mingw32-gcc}" -O2 -s -Wall -Wextra -Werror -static-libgcc \
  -o bin/gcm-start.exe native/gcm_start.c -lshell32 -luser32
"${CC:-x86_64-w64-mingw32-gcc}" -O2 -s -Wall -Wextra -Werror -static-libgcc -shared   -o bin/gcm-pipewait.dll native/gcm_pipewait.c
"${CC:-x86_64-w64-mingw32-gcc}" -O2 -s -Wall -Wextra -Werror -static-libgcc -shared \
  -o bin/gcm-ce-context.dll native/gcm_ce_context.c
echo "Built bin/gcm-start.exe, bin/gcm-pipewait.dll and bin/gcm-ce-context.dll"
