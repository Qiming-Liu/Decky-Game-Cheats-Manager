"""The file bridge to Cheat Engine while a game runs with a table.

The plugin appends numbered commands to `.gcm-runtime/commands.jsonl` next to
the table; the autorun script inside Cheat Engine (resources/decky_gcm.lua)
applies them and writes `.gcm-runtime/state.json`. The folder sits beside the
table, which the launch options already share with the game's container.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import game_window
import trainer_table

RUNTIME = ".gcm-runtime"
COMMANDS = "commands.jsonl"
STATE = "state.json"
# How long a game may take to start, and how often its processes are looked at.
ATTACH_SECONDS = 180
ATTACH_POLL = 2.0
# The same process seen this many times in a row is taken as the game.
ATTACH_STABLE = 2
_lock = threading.Lock()
_last_sent = 0
_stop = threading.Event()
_attaching: set[str] = set()


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
    """Ends a session: the bridge's own files go, and the folder when nothing else is in it."""
    with _lock:
        folder = runtime_dir(table)
        if not folder.is_dir() or folder.is_symlink():
            return
        for name in (COMMANDS, STATE, STATE + ".tmp"):
            (folder / name).unlink(missing_ok=True)
        try:
            folder.rmdir()
        except OSError:
            pass


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
    """Appends one command and returns its number.

    Cheat Engine applies only numbers above the last one it saw, and keeps
    that number for as long as it runs, while every session starts with an
    empty file. Keep the last number in memory so a new session can continue
    the sequence even when the clock has not advanced."""
    global _last_sent
    allowed = {"id", "active", "value", "all", "attach"}
    if not isinstance(command, dict) or not command or set(command) - allowed:
        raise ValueError("Unknown table command.")
    if "id" in command and not isinstance(command["id"], int):
        raise ValueError("Unknown table command.")
    if "attach" in command and not ((isinstance(command["attach"], int) and not isinstance(command["attach"], bool)
                                     and command["attach"] > 0) or isinstance(command["attach"], str)):
        raise ValueError("Unknown table command.")
    if "value" in command:
        command["value"] = str(command["value"])
    with _lock:
        folder = runtime_dir(table)
        folder.mkdir(exist_ok=True)
        number = max(_last_sent + 1, _last_number(folder / COMMANDS) + 1, time.time_ns() // 1_000_000)
        with (folder / COMMANDS).open("a", encoding="utf-8") as out:
            out.write(json.dumps({"n": number, **command}, ensure_ascii=False) + "\n")
        _last_sent = number
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


def _attach_when_ready(table: str, app_id: str, programs: list[str], proc: Path) -> None:
    """Points Cheat Engine at the game once the game's process has settled.

    The candidates are Cheat Engine's own process list from its state, ranked
    by game_window.rank; the first is usually the one with the game's window.
    It can change while the game starts (a launcher's window first), so a
    process ID is sent only after it led ATTACH_STABLE times in a row, and
    again if another one settles before Cheat Engine reports a process. Once
    attached, only the player changes it, from the panel."""
    # Cheat Engine writes its state only into an existing folder, and the
    # list to pick from is in that state.
    runtime_dir(table).mkdir(exist_ok=True)
    sent, last, count = 0, 0, 0
    deadline = time.monotonic() + ATTACH_SECONDS
    while time.monotonic() < deadline and not _stop.wait(ATTACH_POLL):
        current = state(table)
        if not current:
            continue
        if current.get("pid"):
            return
        ranked = game_window.rank(current.get("processes") or [], app_id, programs, proc)
        pid = ranked[0]["pid"] if ranked else 0
        count = count + 1 if pid and pid == last else (1 if pid else 0)
        last = pid
        if count >= ATTACH_STABLE and pid != sent:
            send(table, {"attach": pid})
            sent = pid


def watch_attach(table: str, app_id: str, programs: list[str] = (), proc: Path = Path("/proc")) -> bool:
    """Starts attaching Cheat Engine to the game in the background; False when it already runs."""
    _table(table)
    if not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    key = f"{app_id}:{table}"
    with _lock:
        if key in _attaching or _stop.is_set():
            return False
        _attaching.add(key)

    def run():
        try:
            _attach_when_ready(table, app_id, list(programs), proc)
        except Exception:  # never take the plugin down for a missed attach
            import decky
            decky.logger.exception("Attaching Cheat Engine for app %s failed", app_id)
        finally:
            with _lock:
                _attaching.discard(key)

    threading.Thread(target=run, name=f"ce-attach-{app_id}", daemon=True).start()
    return True


def stop_watching() -> None:
    _stop.set()
