"""The file bridge to Cheat Engine while a game runs with a table.

The plugin appends numbered commands to `.gcm-runtime/commands.jsonl` next to
the table; the autorun script inside Cheat Engine (resources/decky_gcm.lua)
applies them and writes `.gcm-runtime/state.json`. The folder sits beside the
table, which the launch options already share with the game's container.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path

import trainer_table

RUNTIME = ".gcm-runtime"
COMMANDS = "commands.jsonl"
STATE = "state.json"
_lock = threading.Lock()


def _table(path: str) -> Path:
    file = Path(path)
    if file.suffix.lower() not in trainer_table.TABLE_EXTENSIONS or not file.is_file():
        raise ValueError("Choose a .ct file.")
    return file


def runtime_dir(table: str) -> Path:
    return _table(table).parent / RUNTIME


def start(table: str) -> None:
    """Begins a session: old commands and state are dropped."""
    with _lock:
        folder = runtime_dir(table)
        folder.mkdir(exist_ok=True)
        (folder / COMMANDS).write_text("", encoding="utf-8")
        try:
            (folder / STATE).unlink()
        except FileNotFoundError:
            pass


def stop(table: str) -> None:
    with _lock:
        folder = runtime_dir(table)
        if folder.is_dir() and not folder.is_symlink():
            shutil.rmtree(folder, ignore_errors=True)


def _last_number(path: Path) -> int:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return 0
    for line in reversed(lines):
        try:
            value = json.loads(line).get("n")
        except (ValueError, AttributeError):
            continue
        if isinstance(value, int):
            return value
    return 0


def send(table: str, command: dict) -> int:
    """Appends one command and returns its number."""
    allowed = {"id", "active", "value", "all", "attach"}
    if not isinstance(command, dict) or not command or set(command) - allowed:
        raise ValueError("Unknown table command.")
    if "id" in command and not isinstance(command["id"], int):
        raise ValueError("Unknown table command.")
    if "value" in command:
        command["value"] = str(command["value"])
    with _lock:
        folder = runtime_dir(table)
        folder.mkdir(exist_ok=True)
        number = _last_number(folder / COMMANDS) + 1
        with (folder / COMMANDS).open("a", encoding="utf-8") as out:
            out.write(json.dumps({"n": number, **command}, ensure_ascii=False) + "\n")
        return number


def state(table: str) -> dict | None:
    """What Cheat Engine last reported, with its age in seconds, or None before it answers."""
    path = runtime_dir(table) / STATE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        age = max(0.0, time.time() - path.stat().st_mtime)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        return None
    return {**data, "age": round(age, 1)}


def game_process(app_id: str) -> str:
    """The Windows program Steam started for the game, by name, or "" when unknown."""
    proc = Path("/proc")
    if not app_id or not proc.is_dir():
        return ""
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            environ = (entry / "environ").read_bytes()
            if f"SteamGameId={app_id}".encode() not in environ.split(b"\0"):
                continue
            words = (entry / "cmdline").read_bytes().split(b"\0")
        except OSError:
            continue
        for word in words:
            name = os.path.basename(word.decode("utf-8", "replace").replace("\\", "/"))
            lowered = name.lower()
            if lowered.endswith(".exe") and "cheatengine" not in lowered.replace(" ", "") and lowered not in {
                "steam.exe", "start.exe", "cmd.exe", "conhost.exe", "explorer.exe", "wineboot.exe", "services.exe",
                "winedevice.exe", "plugplay.exe", "svchost.exe", "rpcss.exe", "tabtip.exe",
            }:
                return name
    return ""
