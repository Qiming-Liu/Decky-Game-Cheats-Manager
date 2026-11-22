"""The shared launcher script that starts a game's trainers.

PROTON_REMOTE_DEBUG_CMD runs one command next to the game. The plugin points
it at this batch file followed by the programs to start, in order. The script
lives in the trainer library's root as a hidden file, so programs inside the
library are passed relative to it and the launch options stay short; other
programs are passed as full Windows paths. Wine's cmd reads a batch file in
the console code page, so the file itself stays ASCII; program names arrive
as arguments and keep any language. The file carries the shared settings, so
changing them applies to every game at once: the delay before the programs
start, and whether only the first program starts.

Earlier versions kept the script in the plugin's settings folder. It is still
written there, so games whose launch options name it keep working until their
trainer selection is next changed.

`.exe` programs start through the starter, kept next to the script, which
marks them Wine system processes: Proton then stops waiting for them when the
game exits, and Wine closes them with the game. Next to it is the library the
starter loads into FLiNG trainers so they wait longer for their own window.
Other programs, or a missing starter, use `start` and stay open until closed
by hand.

A `--ce <path>` pair before the programs names Cheat Engine, written like a
program; tables (.ct, .cetrainer) are opened through it instead of started
directly, by the starter as well, so Cheat Engine closes with the game too.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import decky
import plugin_settings
import steam_library
import trainer_library

NAME = ".gcm.bat"
STARTER_NAME = ".gcm-start.exe"
# Loaded by the starter into FLiNG trainers so they wait longer for their own window.
PIPE_WAIT_NAME = ".gcm-pipewait.dll"
# What the script and the starter did, read and emptied by launch_check.
LOG_NAME = ".gcm-launch.log"
# Files the launcher owns in a folder; library migration leaves them behind.
FILES = (NAME, STARTER_NAME, PIPE_WAIT_NAME, LOG_NAME)
LEGACY_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "launch.bat")
LEGACY_STARTER_NAME = "gcm-start.exe"
STARTER = os.path.join(decky.DECKY_PLUGIN_DIR, "bin", "gcm-start.exe")
PIPE_WAIT = os.path.join(decky.DECKY_PLUGIN_DIR, "bin", "gcm-pipewait.dll")
_lock = threading.Lock()


# Cheat Engine follows Steam: Chinese for either Chinese, English for every other language.
CHINESE = {"schinese", "tchinese"}


def _render(settings: dict, language: str = "") -> str:
    # Each step is appended to the launch log, which the plugin copies into its own.
    def log(text: str) -> str:
        return f'echo %date% %time% launcher: {text}>>"%~dp0{LOG_NAME}"'
    lines = ["@echo off", "rem Written by DeckyGCM. Starts the programs named after it, in order.",
             "rem A program without a drive letter is relative to this folder.",
             f'set "GCM_START=%~dp0{STARTER_NAME}"', log("started")]
    delay = settings["launch_delay"]
    if delay:
        # `timeout` returns at once without a console; ping waits about one second per echo.
        lines.append(f"ping -n {delay + 1} 127.0.0.1 >nul")
    lines += [":next", 'if "%~1"=="" goto :eof',
              'if not "%~1"=="--ce" goto program',
              'set "GCM_CE=%~2"',
              'if not "%GCM_CE:~1,1%"==":" set "GCM_CE=%~dp0%~2"',
              'for %%i in ("%GCM_CE%") do set "GCM_CE_DIR=%%~dpi"',
              "shift", "shift", "goto next",
              ":program", 'set "GCM_PROGRAM=%~1"',
              'if not "%GCM_PROGRAM:~1,1%"==":" set "GCM_PROGRAM=%~dp0%~1"',
              'for %%i in ("%GCM_PROGRAM%") do set "GCM_FOLDER=%%~dpi"',
              'for %%i in ("%GCM_PROGRAM%") do set "GCM_TYPE=%%~xi"',
              'if not exist "%GCM_PROGRAM%" ' + log('missing "%GCM_PROGRAM%"'),
              'if /i "%GCM_TYPE%"==".ct" goto table', 'if /i "%GCM_TYPE%"==".cetrainer" goto table',
              'if /i not "%GCM_TYPE%"==".exe" goto plain',
              'if not exist "%GCM_START%" ' + log("no starter"),
              'if not exist "%GCM_START%" goto plain',
              '"%GCM_START%" "%GCM_PROGRAM%" && goto started',
              ":plain", log('start "%GCM_PROGRAM%"'),
              'start "" /d "%GCM_FOLDER%" "%GCM_PROGRAM%"', "goto started",
              # Cheat Engine learns the table from the environment: the plugin's autorun
              # script keeps its bridge files next to it. Its first-run question (CEShare)
              # and the "restore after crash" question are answered beforehand: a game
              # hides them.
              ":table", 'if not defined GCM_CE ' + log('no Cheat Engine for "%GCM_PROGRAM%"'),
              'if not defined GCM_CE goto started',
              # Existing launch options can still contain a previously linked path.
              f'if not exist "%GCM_CE_DIR%{trainer_library.MANAGED_CE_MARKER}" ' + log('Cheat Engine download required'),
              f'if not exist "%GCM_CE_DIR%{trainer_library.MANAGED_CE_MARKER}" goto started',
              log('table "%GCM_PROGRAM%"'),
              # Cheat Engine's Lua reads the environment and opens files in the
              # ANSI code page, where a Chinese folder name turns into "?". The
              # 8.3 short paths name the same places in plain ASCII.
              'for %%i in ("%GCM_PROGRAM%") do set "GCM_TABLE=%%~si"',
              'for %%i in ("%GCM_CE%") do set "GCM_LOG=%%~dpsiautorun\\decky_gcm.log"',
              # Cheat Engine takes its language from LANG, before its own settings.
              f'set "LANG={"zh_CN" if language in CHINESE else "en_US"}"',
              'reg add "HKCU\\Software\\Cheat Engine\\ceshare" /v enabled /d 0 /f >nul 2>&1',
              'reg add "HKCU\\Software\\Cheat Engine\\Auto Save" /v ProcessID /d "" /f >nul 2>&1',
              # Its welcome questions are answered once per game, and table Lua
              # runs without asking; a choice the user makes later stays.
              *(f'reg query "HKCU\\Software\\Cheat Engine" /v "{name}" >nul 2>&1 || '
                f'reg add "HKCU\\Software\\Cheat Engine" /v "{name}" /t REG_DWORD /d 0 /f >nul 2>&1'
                for name in ("First Time User", "LuaScriptAction")),
              # An older starter takes one program only and fails here.
              'if not exist "%GCM_START%" goto direct',
              '"%GCM_START%" "%GCM_CE%" "%GCM_PROGRAM%" && goto started',
              ":direct", 'start "" /d "%GCM_CE_DIR%" "%GCM_CE%" "%GCM_PROGRAM%"',
              ":started"]
    if not settings["allow_multiple"]:
        lines.append("goto :eof")
    lines += ["shift", "goto next"]
    return "\r\n".join(lines) + "\r\n"


def _replace(file: Path, data: bytes):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + ".tmp")
    temporary.write_bytes(data)
    os.chmod(temporary, 0o644)
    os.replace(temporary, file)


def _sync_copy(source: str, copy: Path):
    """Keeps `copy` equal to the plugin's `source`, or removes it without one."""
    try:
        data = Path(source).read_bytes()
    except OSError:
        copy.unlink(missing_ok=True)
        return
    try:
        if copy.read_bytes() == data:
            return
    except OSError:
        pass
    _replace(copy, data)


def _sync_starter(directory: Path):
    """Keeps copies of the plugin's starter and its pipe-wait library beside the script."""
    _sync_copy(STARTER, directory / STARTER_NAME)
    _sync_copy(PIPE_WAIT, directory / PIPE_WAIT_NAME)


def _write(file: Path, text: str):
    _sync_starter(file.parent)
    try:
        if file.read_text(encoding="ascii") == text:
            return
    except (OSError, UnicodeError):
        pass
    _replace(file, text.encode("ascii"))


def script() -> dict:
    """Writes the scripts for the current settings where they differ.

    Returns the script new launch options use (the library's, or the legacy
    one when the library cannot be written) and the earlier paths still
    recognized."""
    text = _render(plugin_settings.load(), steam_library.language())
    legacy = Path(LEGACY_PATH)
    with _lock:
        _write(legacy, text)
        (legacy.parent / LEGACY_STARTER_NAME).unlink(missing_ok=True)
        try:
            library = Path(trainer_library.directory()).resolve()
            library.mkdir(parents=True, exist_ok=True)
            current = library / NAME
            _write(current, text)
        except OSError as error:
            decky.logger.warning("Could not write the launcher into the library: %s", error)
            return {"path": str(legacy), "legacy": []}
    return {"path": str(current), "legacy": [str(legacy)]}
