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
game exits, and Wine closes them with the game. Other programs, or a missing
starter, use `start` and stay open until closed by hand.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import decky
import plugin_settings
import trainer_library

NAME = ".gcm.bat"
STARTER_NAME = ".gcm-start.exe"
# Files the launcher owns in a folder; library migration leaves them behind.
FILES = (NAME, STARTER_NAME)
LEGACY_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "launch.bat")
LEGACY_STARTER_NAME = "gcm-start.exe"
STARTER = os.path.join(decky.DECKY_PLUGIN_DIR, "bin", "gcm-start.exe")
_lock = threading.Lock()


def _render(settings: dict) -> str:
    lines = ["@echo off", "rem Written by DeckyGCM. Starts the programs named after it, in order.",
             "rem A program without a drive letter is relative to this folder.",
             f'set "GCM_START=%~dp0{STARTER_NAME}"']
    delay = settings["launch_delay"]
    if delay:
        # `timeout` returns at once without a console; ping waits about one second per echo.
        lines.append(f"ping -n {delay + 1} 127.0.0.1 >nul")
    lines += [":next", 'if "%~1"=="" goto :eof',
              'set "GCM_PROGRAM=%~1"',
              'if not "%GCM_PROGRAM:~1,1%"==":" set "GCM_PROGRAM=%~dp0%~1"',
              'for %%i in ("%GCM_PROGRAM%") do set "GCM_FOLDER=%%~dpi"',
              'for %%i in ("%GCM_PROGRAM%") do set "GCM_TYPE=%%~xi"',
              'if /i not "%GCM_TYPE%"==".exe" goto plain',
              'if not exist "%GCM_START%" goto plain',
              '"%GCM_START%" "%GCM_PROGRAM%" && goto started',
              ":plain", 'start "" /d "%GCM_FOLDER%" "%GCM_PROGRAM%"', ":started"]
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


def _sync_starter(directory: Path):
    """Keeps a copy of the plugin's starter beside the script, or none without one."""
    copy = directory / STARTER_NAME
    try:
        data = Path(STARTER).read_bytes()
    except OSError:
        copy.unlink(missing_ok=True)
        return
    try:
        if copy.read_bytes() == data:
            return
    except OSError:
        pass
    _replace(copy, data)


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
    text = _render(plugin_settings.load())
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
