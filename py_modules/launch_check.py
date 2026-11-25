"""Records how a game's trainers started, for bug reports.

Proton runs the launcher script beside the game, out of the plugin's sight.
The script and the starter append what they did to the launch log beside the
script, and the starter follows each program for 30 seconds: whether it
opened a window or exited. When the frontend reports that a game with
trainers started, `watch` waits for that, copies the lines into the plugin
log, empties the file, and records each trainer process found in /proc: the
Steam app ID in its environment and the app ID of the Steam `reaper` it runs
under, which gamescope uses to tell which game a window belongs to. Then
gamescope's list of focusable windows, when xprop can read it: Steam offers
to switch windows only between focusable windows of the running game.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

import decky
import launcher
import plugin_settings
import library_settings

# The starter follows a program for 30 seconds; a little more for its last line.
WATCH_SECONDS = 35
MAX_LINES = 200
PROC = Path("/proc")
# Only these are read from a trainer's environment; XAUTHORITY is passed to xprop, never logged.
ENVIRONMENT = ("SteamAppId", "SteamGameId", "STEAM_COMPAT_APP_ID", "DISPLAY")
GAMESCOPE = ("GAMESCOPE_FOCUSED_APP", "GAMESCOPE_FOCUSABLE_APPS", "GAMESCOPE_FOCUSABLE_WINDOWS")
_REAPER_APP = re.compile(r"\bAppId=(\d+)")

_stop = threading.Event()
_lock = threading.Lock()
_watching: set[str] = set()


def log_files() -> list[Path]:
    """The launch logs beside the library's script and the legacy one."""
    files = [Path(launcher.LEGACY_PATH).parent / launcher.LOG_NAME]
    try:
        files.insert(0, Path(library_settings.directory()).resolve() / launcher.LOG_NAME)
    except OSError:
        pass
    return files


def take_lines(files: list[Path]) -> list[str]:
    """Reads and empties each launch log."""
    lines: list[str] = []
    for file in dict.fromkeys(files):
        try:
            with open(file, "r+b") as handle:
                data = handle.read()
                handle.seek(0)
                handle.truncate()
        except OSError:
            continue
        # The starter writes UTF-8; cmd writes the console code page.
        lines += [line.strip() for line in data.decode("utf-8", "replace").splitlines() if line.strip()]
    return lines[-MAX_LINES:]


def _read(pid: str, name: str, proc: Path) -> bytes:
    try:
        return (proc / pid / name).read_bytes()
    except OSError:
        return b""


def _environment(pid: str, proc: Path) -> dict[str, str]:
    values = {}
    for entry in _read(pid, "environ", proc).split(b"\0"):
        name, _, value = entry.partition(b"=")
        key = name.decode(errors="replace")
        if key in ENVIRONMENT or key == "XAUTHORITY":
            values[key] = value.decode(errors="replace")
    return values


def _parent(pid: str, proc: Path) -> str:
    stat = _read(pid, "stat", proc).decode(errors="replace")
    try:
        return stat[stat.rindex(")") + 2:].split()[1]
    except (ValueError, IndexError):
        return ""


def reaper_app(pid: str, proc: Path = PROC) -> str | None:
    """The app ID of the Steam reaper above `pid`, "" for one without, None without a reaper."""
    for _ in range(64):
        if _read(pid, "comm", proc).strip() == b"reaper":
            match = _REAPER_APP.search(_read(pid, "cmdline", proc).replace(b"\0", b" ").decode(errors="replace"))
            return match.group(1) if match else ""
        pid = _parent(pid, proc)
        if not pid or pid in ("0", "1"):
            return None
    return None


def _base(word: str) -> str:
    return re.split(r"[\\/]", word)[-1].lower()


def find_processes(programs: list[str], proc: Path = PROC) -> list[dict]:
    """Processes started from `programs`, matched by file name. Wine names a
    process after its Windows path; the starter's own watch is left out."""
    names = {_base(program) for program in programs}
    found = []
    try:
        pids = sorted((entry.name for entry in proc.iterdir() if entry.name.isdigit()), key=int)
    except OSError:
        return found
    for pid in pids:
        words = [word.decode(errors="replace") for word in _read(pid, "cmdline", proc).split(b"\0") if word]
        if not words or "--watch" in words or not any(_base(word) in names for word in words[:4]):
            continue
        found.append({"pid": pid, "name": _base(next(word for word in words[:4] if _base(word) in names)),
                      "environment": _environment(pid, proc), "reaper": reaper_app(pid, proc)})
    return found


def gamescope_windows(environment: dict[str, str]) -> str:
    """gamescope's focus lists from the root of Steam's display, or why they could not be read."""
    xprop = shutil.which("xprop")
    if not xprop:
        return "xprop not found"
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "DISPLAY": ":0"}
    if environment.get("XAUTHORITY"):
        env["XAUTHORITY"] = environment["XAUTHORITY"]
    try:
        result = subprocess.run([xprop, "-root", *GAMESCOPE], env=env, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError) as error:
        return f"xprop failed: {error}"
    text = (result.stdout if result.returncode == 0 else result.stderr).strip()
    return " | ".join(line.strip() for line in text.splitlines()) or f"xprop exited with {result.returncode}"


def _describe(process: dict) -> str:
    environment = process["environment"]
    values = ", ".join(f"{key}={environment[key]}" for key in ENVIRONMENT if key in environment) or "no Steam IDs"
    reaper = process["reaper"]
    owner = "no reaper" if reaper is None else f"reaper AppId={reaper or '?'}"
    return f"{process['name']} pid {process['pid']}: {values}; {owner}"


def check(app_id: str, programs: list[str], tool: str):
    """Logs what the launch log and the system show of the game's trainers."""
    logger = decky.logger
    header = f"Trainer launch for app {app_id}" + (f" ({tool})" if tool else "")
    lines = take_lines(log_files())
    for line in lines:
        logger.info("%s: %s", header, line)
    if not lines:
        logger.warning("%s: the launcher left no record; Proton did not run it, or it could not write its log", header)
    processes = find_processes(programs)
    if not processes:
        logger.warning("%s: no trainer process runs (%s)", header, ", ".join(sorted({_base(p) for p in programs})))
        return
    for process in processes:
        logger.info("%s: %s", header, _describe(process))
    logger.info("%s: gamescope: %s", header, gamescope_windows(processes[0]["environment"]))


def _run(app_id: str, programs: list[str], tool: str):
    try:
        delay = plugin_settings.load().get("launch_delay", 0)
        if not _stop.wait(WATCH_SECONDS + (delay if isinstance(delay, int) else 0)):
            check(app_id, programs, tool)
    except Exception:  # A diagnostic must never take the plugin down.
        decky.logger.exception("Checking the trainer launch for app %s failed", app_id)
    finally:
        with _lock:
            _watching.discard(app_id)


def watch(app_id: str, programs: list, tool: str = ""):
    """Checks the game's trainers once the starter has followed them."""
    if not isinstance(app_id, str) or not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    programs = [program for program in programs if isinstance(program, str) and program]
    if not programs:
        return
    with _lock:
        if app_id in _watching or _stop.is_set():
            return
        _watching.add(app_id)
    threading.Thread(target=_run, args=(app_id, programs, str(tool or "")), name=f"launch-check-{app_id}",
                     daemon=True).start()


def stop():
    _stop.set()
