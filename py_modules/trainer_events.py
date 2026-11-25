"""What a game's started programs did while it runs, for the Quick Access panel.

The starter follows every program it starts until the program exits and
appends what it saw to the events file beside the launcher script, one line
per event: Unix time, pid, kind, program file name and text, separated by
tabs, with backslash, tab and line break in the text written as \\\\, \\t and
\\n. The kinds are

- "started" and "failed" (with the Windows error code): the start itself;
- "window" (seconds and title) or "nowindow" (after 30 seconds without one);
- "dialog": a message box the program showed, its title and text;
- "exit": the exit code and the seconds it ran;
- "unwatched": the starter could not follow the program;
- "handoff": it ended at once and the starter follows the program it started;
- "hold": the game was held back until a trainer that must start first was ready.

Nothing here judges what a trainer meant: a message box is shown as the
trainer wrote it. When the frontend reports a game start (check_trainer_launch),
a session begins; its events are the lines written from shortly before that
moment on. New message boxes, failed starts and exits also go to the plugin
log once, for bug reports.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path

import decky
import launch_check
import launcher
import library_settings

KINDS = {"started", "failed", "unwatched", "window", "nowindow", "dialog", "exit", "handoff", "hold"}
# Steam reports the start a moment after Proton runs the launcher.
SESSION_MARGIN = 10
MAX_EVENTS = 40
MAX_BYTES = 512 * 1024
_LOGGED = {"failed", "unwatched", "dialog", "exit", "nowindow"}

_lock = threading.Lock()
_sessions: dict[str, dict] = {}


def events_files() -> list[Path]:
    """The events files beside the library's script and the legacy one."""
    files = [Path(launcher.LEGACY_PATH).parent / launcher.EVENTS_NAME]
    try:
        files.insert(0, Path(library_settings.directory()).resolve() / launcher.EVENTS_NAME)
    except OSError:
        pass
    return list(dict.fromkeys(files))


def _unescape(text: str) -> str:
    out, chars = [], iter(text)
    for char in chars:
        if char != "\\":
            out.append(char)
            continue
        following = next(chars, "")
        out.append({"t": "\t", "n": "\n", "\\": "\\"}.get(following, "\\" + following))
    return "".join(out)


def parse(line: str) -> dict | None:
    """One event line, or None for a line that is not one."""
    parts = line.rstrip("\r\n").split("\t", 4)
    if len(parts) != 5 or parts[2] not in KINDS:
        return None
    try:
        when, pid = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    return {"time": when, "pid": pid, "kind": parts[2], "program": parts[3], "text": _unescape(parts[4])}


def read(files: list[Path], since: float) -> list[dict]:
    """The newest events written at or after `since`, oldest first."""
    events = []
    for file in files:
        try:
            with open(file, "rb") as handle:
                size = handle.seek(0, 2)
                handle.seek(max(0, size - MAX_BYTES))
                data = handle.read()
        except OSError:
            continue
        for line in data.decode("utf-8", "replace").splitlines():
            event = parse(line)
            if event and event["time"] >= since:
                events.append(event)
    events.sort(key=lambda event: event["time"])
    return events[-MAX_EVENTS:]


def begin(app_id: str, programs: list[str], now: float | None = None):
    """A game with these trainer programs has started."""
    with _lock:
        _sessions[app_id] = {"since": (now if now is not None else time.time()) - SESSION_MARGIN,
                             "programs": list(programs), "logged": set()}


def _log_new(app_id: str, session: dict, events: list[dict]):
    for event in events:
        key = (event["time"], event["pid"], event["kind"], event["text"])
        if event["kind"] not in _LOGGED or key in session["logged"]:
            continue
        session["logged"].add(key)
        text = event["text"].replace("\n", " | ")
        decky.logger.info("Trainer for app %s: %s (pid %s) %s%s", app_id, event["program"], event["pid"],
                          event["kind"], f": {text}" if text else "")


def steam_launches(proc: Path = launch_check.PROC) -> list[str]:
    """The app IDs of the games Steam's reapers run now."""
    found = set()
    try:
        pids = [entry.name for entry in proc.iterdir() if entry.name.isdigit()]
    except OSError:
        return []
    for pid in pids:
        app = launch_check.reaper_app(pid, proc) if launch_check._read(pid, "comm", proc).strip() == b"reaper" else None
        if app:
            found.add(app)
    return sorted(found)


def status(app_id: str, files: list[Path] | None = None, proc: Path = launch_check.PROC) -> dict:
    """The events of the game's session and which of its programs still run.

    With an empty app ID, the latest session whose programs still run: Steam
    does not report a game whose own Steam ID differs from its shortcut's."""
    with _lock:
        sessions = dict(_sessions)
    if not app_id:
        for candidate, session in sorted(sessions.items(), key=lambda item: -item[1]["since"]):
            if launch_check.find_processes(session["programs"], proc):
                app_id = candidate
                break
    session = sessions.get(app_id)
    if not session:
        # The app IDs Steam's reapers were started for: a game that reports another
        # Steam ID than its shortcut's runs under its shortcut's reaper.
        return {"app_id": app_id, "known": False, "events": [], "running": [], "reapers": steam_launches(proc)}
    events = read(files if files is not None else events_files(), session["since"])
    with _lock:
        _log_new(app_id, session, events)
    # Linux process IDs are not Wine's: programs are told apart by file name. A
    # program can start another (Cheat Engine's 32-bit build), so every name
    # the events mention is looked for too.
    names = session["programs"] + sorted({event["program"] for event in events})
    running = sorted({process["name"] for process in launch_check.find_processes(names, proc)})
    return {"app_id": app_id, "known": True, "events": events, "running": running, "programs": session["programs"]}
