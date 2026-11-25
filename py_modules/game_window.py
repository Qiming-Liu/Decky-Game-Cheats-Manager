"""Which of a running game's windows is the game, and which one gamescope shows.

gamescope lists every window it may show on the root of Steam's X display:
GAMESCOPE_FOCUSABLE_WINDOWS holds (window, app ID, process ID) triples and
GAMESCOPE_FOCUSED_WINDOW the one on screen. A trainer or Cheat Engine that
opens after the game can take the screen; the frontend uses this to put the
game back in front through Steam.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

PROC = Path("/proc")
# Wine's own programs and the launcher's helpers are never the game.
NOT_THE_GAME = {
    "steam.exe", "start.exe", "cmd.exe", "conhost.exe", "explorer.exe", "wineboot.exe", "services.exe",
    "winedevice.exe", "plugplay.exe", "svchost.exe", "rpcss.exe", "tabtip.exe", "xalia.exe",
    "lsass.exe", "rundll32.exe", "regsvr32.exe", "winemenubuilder.exe", "wineconsole.exe", "mscorsvw.exe",
    "gcm-start.exe", ".gcm-start.exe",
}
DISPLAYS = (":0", ":1")
_NUMBERS = re.compile(r"\d+")


def _root_properties(display: str) -> dict[str, list[int]]:
    xprop = shutil.which("xprop")
    if not xprop:
        return {}
    try:
        result = subprocess.run([xprop, "-root", "GAMESCOPE_FOCUSED_WINDOW", "GAMESCOPE_FOCUSABLE_WINDOWS"],
                                env=_x_env(display), capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return {}
    values = {}
    for line in result.stdout.splitlines():
        name, separator, rest = line.partition("=")
        if separator:
            values[name.split("(")[0].strip()] = [int(number) for number in _NUMBERS.findall(rest)]
    return values


def _x_env(display: str) -> dict[str, str]:
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "DISPLAY": display}
    if os.environ.get("XAUTHORITY"):
        env["XAUTHORITY"] = os.environ["XAUTHORITY"]
    return env


def window_properties(display: str, window: int) -> dict:
    """A window's title, its process ID (0 if unknown) and whether Wine made it a dialog.

    Wine types a window with a dialog frame (a question, a message box, a
    splash screen) _NET_WM_WINDOW_TYPE_DIALOG; Cheat Engine's main window and
    its tool windows are NORMAL."""
    xprop = shutil.which("xprop")
    if not xprop or not window:
        return {"name": "", "dialog": False, "pid": 0}
    try:
        result = subprocess.run([xprop, "-id", str(window), "_NET_WM_WINDOW_TYPE", "_NET_WM_PID", "_NET_WM_NAME", "WM_NAME"],
                                env=_x_env(display), capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return {"name": "", "dialog": False, "pid": 0}
    name, dialog, pid = "", False, 0
    for line in result.stdout.splitlines():
        key, separator, rest = line.partition("=")
        if not separator:
            continue
        key = key.split("(")[0].strip()
        if key == "_NET_WM_WINDOW_TYPE":
            dialog = "_NET_WM_WINDOW_TYPE_DIALOG" in rest
        elif key == "_NET_WM_PID":
            pid = int(rest.strip()) if rest.strip().isdigit() else 0
        elif key in ("_NET_WM_NAME", "WM_NAME") and not name:
            name = rest.strip().strip('"')
    return {"name": name, "dialog": dialog, "pid": pid}


def _properties(describe, display: str, window: int, pid: int) -> dict:
    """The window's properties from the X display it lives on.

    gamescope keeps its lists on the root of Steam's display, but a game's
    windows often live on another one (Steam on :0, games on :1 on a ROG Ally).
    Window IDs repeat across displays, so the display is the one whose window
    belongs to the listed process; without a match, the list's own display."""
    for candidate in DISPLAYS:
        info = describe(candidate, window)
        if info.get("pid") == pid:
            return info
    return describe(display, window)


def _command(pid: int, proc: Path) -> list[str]:
    try:
        return [word.decode(errors="replace") for word in (proc / str(pid) / "cmdline").read_bytes().split(b"\0") if word]
    except OSError:
        return []


def _resident(pid: int, proc: Path) -> int:
    try:
        return int((proc / str(pid) / "statm").read_bytes().split()[1])
    except (OSError, ValueError, IndexError):
        return 0


def _base(word: str) -> str:
    return re.split(r"[\\/]", word)[-1].lower()


def _ours(pid: int, names: set[str], proc: Path) -> bool:
    """A process started from one of the game's trainers, or Cheat Engine opening a table."""
    words = [_base(word) for word in _command(pid, proc)[:4]]
    return any(word in names or "cheatengine" in word.replace(" ", "") for word in words)


def _focusable(app_id: str, read) -> tuple[int, list[tuple[int, int]], str]:
    """The window on screen, the app's (window, process) pairs and the display,
    from the first display gamescope runs on."""
    for display in DISPLAYS:
        values = read(display)
        triples = values.get("GAMESCOPE_FOCUSABLE_WINDOWS", [])
        if triples:
            focused = (values.get("GAMESCOPE_FOCUSED_WINDOW") or [0])[0]
            return focused, [(triples[i], triples[i + 2]) for i in range(0, len(triples) - 2, 3)
                             if str(triples[i + 1]) == app_id], display
    return 0, [], ""


def _app_markers(app_id: str) -> set[bytes]:
    """Environment entries Steam gives every process of the app.

    SteamAppId is the app ID itself. SteamGameId is too for a Steam game, but
    for a non-Steam shortcut it is the 64-bit game ID: the app ID shifted up
    32 bits with the shortcut flag 0x02000000 below."""
    shortcut = (int(app_id) << 32) | 0x02000000
    return {f"SteamAppId={app_id}".encode(), f"SteamGameId={app_id}".encode(), f"SteamGameId={shortcut}".encode()}


def _belongs(pid: str, markers: set[bytes], proc: Path) -> bool:
    try:
        return not markers.isdisjoint((proc / pid / "environ").read_bytes().split(b"\0"))
    except OSError:
        return False


def candidates(app_id: str, programs: list[str] = (), proc: Path = PROC, read=_root_properties) -> list[dict]:
    """The game's Windows processes Cheat Engine could attach to, most likely first.

    A process with a window on gamescope's list comes first: that is what the
    player sees. Then the program Steam itself started, which for many games
    is a launcher or a small stub. Then the rest by memory. Trainers, Cheat
    Engine and Wine's own programs are left out. Wine names a process after
    its Windows program, which is what Cheat Engine attaches by."""
    if not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    names = {_base(program) for program in programs if isinstance(program, str) and program}
    _, own, _ = _focusable(app_id, read)
    with_window = {pid for _, pid in own}
    markers = _app_markers(app_id)
    found: dict[str, dict] = {}
    pages: dict[str, int] = {}
    launched = ""
    try:
        pids = [entry.name for entry in proc.iterdir() if entry.name.isdigit()]
    except OSError:
        pids = []
    for pid in pids:
        if not _belongs(pid, markers, proc):
            continue
        words = _command(int(pid), proc)
        head = next((word for word in words[:4] if word.lower().endswith(".exe")), "")
        name = re.split(r"[\\/]", head)[-1]
        if _base(head) == "steam.exe" and not launched:
            # Proton's steam.exe runs the program Steam was told to start.
            launched = next((_base(word) for word in words[1:] if word.lower().endswith(".exe")), "")
        lowered = name.lower()
        if not lowered.endswith(".exe") or lowered in NOT_THE_GAME or lowered in names \
                or "cheatengine" in lowered.replace(" ", ""):
            continue
        row = found.setdefault(lowered, {"name": name, "window": False, "launched": False, "memory": 0})
        row["window"] = row["window"] or int(pid) in with_window
        pages[lowered] = max(pages.get(lowered, 0), _resident(int(pid), proc))
    if launched in found:
        found[launched]["launched"] = True
    for key, row in found.items():
        row["memory"] = pages[key] * 4096 // (1024 * 1024)
    return [found[key] for key in sorted(found, key=lambda key: (
        not found[key]["window"], not found[key]["launched"], -pages[key]))]


def rank(processes: list, app_id: str, programs: list[str] = (), proc: Path = PROC, read=_root_properties) -> list[dict]:
    """Cheat Engine's own process list, cut to what could be the game, most likely first.

    `processes` are what Cheat Engine reports from inside Proton: Windows
    process IDs, names, and whether a process has a titled window. The order
    is as for candidates(): a window gamescope lists (or Cheat Engine sees),
    then the program Steam started, then memory, which come from the Linux
    side of the same processes, matched by name."""
    if not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    names = {_base(program) for program in programs if isinstance(program, str) and program}
    linux = {row["name"].lower(): row for row in candidates(app_id, programs, proc, read)}
    rows = []
    for item in processes if isinstance(processes, list) else []:
        if not isinstance(item, dict):
            continue
        pid, name = item.get("pid"), str(item.get("name") or "")
        lowered = name.lower()
        if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0 or not lowered.endswith(".exe") \
                or lowered in NOT_THE_GAME or lowered in names or "cheatengine" in lowered.replace(" ", ""):
            continue
        info = linux.get(lowered, {})
        rows.append({"pid": pid, "name": name, "window": bool(info.get("window") or item.get("window")),
                     "launched": bool(info.get("launched")), "memory": int(info.get("memory", 0))})
    return sorted(rows, key=lambda row: (not row["window"], not row["launched"], -row["memory"], row["pid"]))


def windows(app_id: str, programs: list[str], proc: Path = PROC, read=_root_properties,
            describe=window_properties) -> dict:
    """The game's window, the window on screen, and whether that one is a trainer's.

    Several windows that are not a trainer's (a launcher beside the game)
    resolve to the one whose process uses the most memory. 0 means none.
    A trainer's dialog in front (Cheat Engine asking something, often from the
    table's own script) is not reported as a trainer in front: putting the
    game over it would hide the question, and the program waits for it.
    With a trainer's main window in front, hidden_dialog names a dialog of a
    trainer that gamescope does not show; trainer_windows lists every window
    of the trainers."""
    if not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    names = {_base(program) for program in programs if isinstance(program, str) and program}
    focused, own, display = _focusable(app_id, read)
    trainers = {window for window, pid in own if _ours(pid, names, proc)}
    games = [(window, pid) for window, pid in own if window not in trainers]
    game = max(games, key=lambda item: _resident(item[1], proc))[0] if games else 0
    in_front = focused in trainers
    owner = next((pid for window, pid in own if window == focused), 0)
    dialog = in_front and bool(_properties(describe, display, focused, owner).get("dialog"))
    hidden = 0
    if in_front and not dialog:
        # Steam keeps gamescope on the window it was told to show, so a message
        # box the trainer opens later stays behind its main window, which the
        # dialog disables: the trainer then ignores every tap. The focused
        # trainer's own dialog comes first.
        behind = sorted((pid != owner, window, pid) for window, pid in own if window in trainers and window != focused)
        hidden = next((window for _, window, pid in behind
                       if _properties(describe, display, window, pid).get("dialog")), 0)
    return {"game": game, "focused": focused, "trainer_in_front": in_front and not dialog, "dialog_in_front": dialog,
            "hidden_dialog": hidden, "trainer_windows": sorted(trainers)}
