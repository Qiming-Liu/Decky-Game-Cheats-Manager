"""The shared launcher script that starts a game's trainers.

PROTON_REMOTE_DEBUG_CMD runs one command next to the game. The plugin points
it at this batch file followed by the programs to start, as Windows paths, in
order. Wine's cmd reads a batch file in the console code page, so the file
itself stays ASCII; program names arrive as arguments and keep any language.
The file carries the shared settings, so changing them applies to every game
at once: the delay before the programs start, and whether only the first
program starts. A `--ce <path>` pair before the programs names Cheat Engine;
tables (.ct, .cetrainer) are opened through it instead of started directly.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import decky
import plugin_settings

PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "launch.bat")
_lock = threading.Lock()


def _render(settings: dict) -> str:
    lines = ["@echo off", "rem Written by DeckyGCM. Starts the programs named after it, in order."]
    delay = settings["launch_delay"]
    if delay:
        # `timeout` returns at once without a console; ping waits about one second per echo.
        lines.append(f"ping -n {delay + 1} 127.0.0.1 >nul")
    lines += [
        ":next", 'if "%~1"=="" goto :eof',
        'if "%~1"=="--ce" (', '  set "GCM_CE=%~2"', '  for %%I in ("%~2") do set "GCM_CE_DIR=%%~dpI"',
        '  shift', '  shift', '  goto next', ')',
        'if /I "%~x1"==".ct" goto table', 'if /I "%~x1"==".cetrainer" goto table',
        'start "" /d "%~dp1" "%~1"', "goto started",
        # Cheat Engine learns the table from the environment: the plugin's autorun script
        # keeps its bridge files next to it.
        ":table", 'set "GCM_TABLE=%~1"', 'if defined GCM_CE start "" /d "%GCM_CE_DIR%" "%GCM_CE%" "%~1"',
        ":started",
    ]
    if not settings["allow_multiple"]:
        lines.append("goto :eof")
    lines += ["shift", "goto next"]
    return "\r\n".join(lines) + "\r\n"


def script() -> str:
    """Writes the script for the current settings when it differs and returns its path."""
    text = _render(plugin_settings.load())
    file = Path(PATH)
    with _lock:
        try:
            if file.read_text(encoding="ascii") == text:
                return str(file)
        except (OSError, UnicodeError):
            pass
        file.parent.mkdir(parents=True, exist_ok=True)
        temporary = file.with_suffix(".tmp")
        temporary.write_text(text, encoding="ascii", newline="")
        os.chmod(temporary, 0o644)
        os.replace(temporary, file)
    return str(file)
