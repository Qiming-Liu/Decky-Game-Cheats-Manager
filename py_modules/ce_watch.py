"""Watches Cheat Engine while a game with a table runs, for bug reports.

Cheat Engine runs inside Proton, out of the plugin's sight, and the problems
players report there (a table that does nothing, a window that does not
answer) leave no trace of their own. While the game runs this writes into the
plugin log:

- the new lines of the bridge's own log (resources/decky_gcm.lua), which says
  what Cheat Engine ran and which of its windows were open;
- each change of the window gamescope shows: which process it belongs to, its
  title, and whether it is a dialog;
- when Cheat Engine stops answering (the bridge's state file is no longer
  rewritten), how long, with the game's windows and the state of Cheat
  Engine's threads; and when it answers again.

Nothing here changes what the player sees.
"""
from __future__ import annotations

import os
import re
import threading
import time
from pathlib import Path

import ct_bridge
import decky
import game_window

POLL = 2.0
# The bridge rewrites its state at least once a second while it runs.
FROZEN_AFTER = 10.0
# Gone this many polls in a row: the game has ended.
GONE_POLLS = 3
MAX_SECONDS = 6 * 3600
MAX_LINES_PER_POLL = 200
PROC = Path("/proc")
_CHEAT_ENGINE = re.compile(r"([A-Za-z]):(\\.*?\\)cheatengine[^\\]*\.exe", re.IGNORECASE)

_stop = threading.Event()
_lock = threading.Lock()
_watching: set[str] = set()


def _read(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        return b""


def _app_pids(app_id: str, proc: Path) -> list[str]:
    markers = game_window._app_markers(app_id)
    try:
        pids = [entry.name for entry in proc.iterdir() if entry.name.isdigit()]
    except OSError:
        return []
    return [pid for pid in pids if not markers.isdisjoint(_read(proc / pid / "environ").split(b"\0"))]


def cheat_engine(pids: list[str], proc: Path = PROC) -> tuple[str, Path | None]:
    """The Linux process ID of the game's Cheat Engine and its folder, or ("", None)."""
    for pid in pids:
        text = _read(proc / pid / "cmdline").replace(b"\0", b" ").decode(errors="replace")
        match = _CHEAT_ENGINE.search(text)
        if match and match.group(1).upper() == "Z":
            return pid, Path(match.group(2).replace("\\", "/"))
    return "", None


def threads(pid: str, proc: Path = PROC) -> str:
    """How many of a process's threads run (R), sleep (S) or wait on the disk (D),
    what its main thread waits in, and the CPU time it has used."""
    states: dict[str, int] = {}
    try:
        tasks = list((proc / pid / "task").iterdir())
    except OSError:
        return "gone"
    for task in tasks:
        stat = _read(task / "stat").decode(errors="replace")
        state = stat[stat.rfind(")") + 2:][:1] if ")" in stat else "?"
        states[state] = states.get(state, 0) + 1
    stat = _read(proc / pid / "stat").decode(errors="replace")
    fields = stat[stat.rfind(")") + 2:].split() if ")" in stat else []
    ticks = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
    cpu = (int(fields[11]) + int(fields[12])) / ticks if len(fields) > 12 else 0.0
    wchan = _read(proc / pid / "wchan").decode(errors="replace").strip() or "?"
    counts = ", ".join(f"{count} {state}" for state, count in sorted(states.items()))
    return f"threads {counts}; main thread waits in {wchan}; CPU {cpu:.1f} s"


def describe_window(window: int, display: str, owners: dict[int, int], proc: Path = PROC) -> str:
    if not window:
        return "none"
    pid = owners.get(window)
    words = game_window._command(pid, proc) if pid else []
    head = next((word for word in words[:4] if word.lower().endswith(".exe")), words[0] if words else "")
    name = game_window._base(head) if head else ("not the game's" if pid is None else "?")
    info = game_window.window_properties(display, window)
    kind = "dialog" if info["dialog"] else "window"
    return f'{kind} {window} of {name}: "{info["name"]}"'


START_MARK = b"---- loaded"


def _decode(line: bytes) -> str:
    # The bridge writes Wine's ANSI code page: GBK when Cheat Engine runs in Chinese.
    try:
        return line.decode("utf-8")
    except UnicodeDecodeError:
        return line.decode("gbk", errors="replace")


class _Tail:
    """New lines of a file that another program appends to and may rotate.

    The first read starts at the last start of Cheat Engine written after
    `since` (what it did while the game started), else at the end."""

    def __init__(self, path: Path, since: float):
        self.path = path
        self.since = since
        self.position = None

    def lines(self) -> list[str]:
        try:
            info = self.path.stat()
        except OSError:
            return []
        size = info.st_size
        if self.position is None:
            self.position = size
            if info.st_mtime >= self.since:
                try:
                    with open(self.path, "rb") as source:
                        data = source.read()
                except OSError:
                    data = b""
                start = data.rfind(START_MARK)
                if start >= 0:
                    self.position = data.rfind(b"\n", 0, start) + 1  # with the line's date and time
        if size < self.position:
            self.position = 0
        if size == self.position:
            return []
        try:
            with open(self.path, "rb") as source:
                source.seek(self.position)
                data = source.read()
        except OSError:
            return []
        end = data.rfind(b"\n") + 1
        self.position += end
        lines = [_decode(line) for line in data[:end].splitlines() if line.strip()]
        return lines[-MAX_LINES_PER_POLL:]


def _watch(app_id: str, table: str, proc: Path, read) -> None:
    logger = decky.logger
    header = f"Cheat Engine for app {app_id}"
    tail = None
    focused_before = None
    frozen_since = None
    gone = 0
    started = time.time()
    deadline = time.monotonic() + MAX_SECONDS
    while time.monotonic() < deadline and not _stop.wait(POLL):
        pids = _app_pids(app_id, proc)
        gone = gone + 1 if not pids else 0
        if gone >= GONE_POLLS:
            break
        ce_pid, folder = cheat_engine(pids, proc)
        if folder is not None and (tail is None or tail.path.parent.parent != folder):
            tail = _Tail(folder / "autorun" / "decky_gcm.log", started)
        for line in tail.lines() if tail else []:
            logger.info("%s: bridge: %s", header, line)

        focused, own, display = game_window._focusable(app_id, read)
        owners = dict(own)
        if focused != focused_before:
            focused_before = focused
            logger.info("%s: on screen: %s", header, describe_window(focused, display, owners, proc))

        if not ce_pid:
            frozen_since = None
            continue
        # The bridge writes its state only into an existing folder.
        try:
            folder_path = ct_bridge.runtime_dir(table)
            folder_path.mkdir(exist_ok=True)
            age = time.time() - (folder_path / ct_bridge.STATE).stat().st_mtime
        except (OSError, ValueError):
            continue
        if age >= FROZEN_AFTER and frozen_since is None:
            frozen_since = time.monotonic() - age
            logger.warning("%s: Cheat Engine has not answered for %.0f s (%s)", header, age, threads(ce_pid, proc))
            for window, _pid in own:
                logger.warning("%s: open: %s", header, describe_window(window, display, owners, proc))
        elif age < FROZEN_AFTER and frozen_since is not None:
            logger.warning("%s: Cheat Engine answers again after %.0f s", header, time.monotonic() - frozen_since)
            frozen_since = None
    if tail:
        for line in tail.lines():
            logger.info("%s: bridge: %s", header, line)
    logger.info("%s: watch ended", header)


def watch(app_id: str, table: str, proc: Path = PROC, read=game_window._root_properties) -> bool:
    """Starts watching the game's Cheat Engine; False when it is already watched."""
    ct_bridge.runtime_dir(table)
    if not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    with _lock:
        if app_id in _watching or _stop.is_set():
            return False
        _watching.add(app_id)

    def run():
        try:
            _watch(app_id, table, proc, read)
        except Exception:  # A diagnostic must never take the plugin down.
            decky.logger.exception("Watching Cheat Engine for app %s failed", app_id)
        finally:
            with _lock:
                _watching.discard(app_id)

    threading.Thread(target=run, name=f"ce-watch-{app_id}", daemon=True).start()
    return True


def stop() -> None:
    _stop.set()
