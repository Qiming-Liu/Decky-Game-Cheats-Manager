"""What a game runs on, read from its files and its processes, for hints.

Each check measures a fact; what the fact usually means for trainers is only
a hint, which the panel words as such ("may"). No game or trainer is named:

- managed: a program file is a .NET Framework program (its PE header has a
  CLR runtime header). A .NET 5+ game ships a native host, which has none.
- ms_dotnet: the Proton prefix would run .NET Framework programs on
  Microsoft's runtime: its clr.dll is installed and the prefix's mscoree.dll
  is Microsoft's. Otherwise they run on Wine Mono, which compiles their code
  differently; Proton puts its own mscoree back when it updates a prefix.
- wine_mono / ms_clr: the running game has Wine Mono's mscorlib, or
  Microsoft's clr.dll, mapped.
- elf32: the running game is a 32-bit Linux process: Proton runs a 32-bit
  game in old WoW64 (on x86; ARM Proton always uses the new one), where some
  trainers cannot search its memory (PROTON_USE_WOW64=1 changes that).
- tool_mono: the Wine Mono version of the Proton the game runs with. 11.2.0
  broke named pipes, which .NET trainers use to talk to their own window.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import game_window
import launch_check
import steam_library
import table_scan

PROC = Path("/proc")
MAPS_LIMIT = 16 * 1024 * 1024
MAX_FILES = 400
_MONO = re.compile(rb"/wine-mono-([0-9][0-9.]*)/[^\n]*mscorlib\.dll", re.IGNORECASE)
_CLR = re.compile(rb"[\\/]clr\.dll\b", re.IGNORECASE)


def managed(path: str | Path) -> bool:
    """Whether a PE file is a .NET Framework program (it has a CLR runtime header)."""
    try:
        with open(path, "rb") as source:
            head = source.read(4096)
    except OSError:
        return False
    if head[:2] != b"MZ" or len(head) < 64:
        return False
    pe = int.from_bytes(head[60:64], "little")
    if head[pe:pe + 4] != b"PE\0\0":
        return False
    optional = pe + 24
    magic = int.from_bytes(head[optional:optional + 2], "little")
    directories = optional + (96 if magic == 0x10B else 112 if magic == 0x20B else -1)
    if directories < optional:
        return False
    entry = directories + 14 * 8  # IMAGE_DIRECTORY_ENTRY_COM_DESCRIPTOR
    return len(head) >= entry + 8 and int.from_bytes(head[entry:entry + 4], "little") != 0


def _game_programs(folder: str, exe: str) -> list[Path]:
    if exe:
        return [Path(exe)]
    found: list[Path] = []
    root = folder.rstrip(os.sep).count(os.sep)
    for directory, subdirectories, names in os.walk(folder):
        if directory.count(os.sep) - root >= 2:
            subdirectories[:] = []
        found += [Path(directory) / name for name in names
                  if name.lower().endswith(".exe") and not table_scan.HELPERS.search(name)]
        if len(found) > MAX_FILES:
            break
    return found


def _prefixes(app_id: str) -> list[Path]:
    roots = list(steam_library._library_folders())
    steam = steam_library._steam_root()
    if steam:
        roots.append(os.path.join(steam, "steamapps"))
    return [Path(root) / "compatdata" / app_id / "pfx" for root in dict.fromkeys(roots)]


def _wine_builtin(path: Path) -> bool:
    """Whether a DLL in the prefix is Wine's own: Proton links them from its files, and Wine marks them."""
    try:
        if path.is_symlink():
            return True
        with open(path, "rb") as source:
            return b"Wine builtin DLL" in source.read(1024)
    except OSError:
        return True


def ms_dotnet(prefix: Path) -> bool:
    """Whether .NET Framework programs would run on Microsoft's runtime: its clr.dll is installed and the
    prefix's mscoree.dll, which picks the runtime, is Microsoft's. With Wine's own mscoree (Proton puts
    it back when it updates the prefix), Wine Mono runs them even when Microsoft's runtime is installed."""
    windows = prefix / "drive_c" / "windows"
    framework = windows / "Microsoft.NET"
    if not any((framework / name / "v4.0.30319" / "clr.dll").is_file() for name in ("Framework", "Framework64")):
        return False
    return any((windows / folder / "mscoree.dll").is_file() and not _wine_builtin(windows / folder / "mscoree.dll")
               for folder in ("system32", "syswow64"))


def prelaunch(app_id: str, exe: str = "") -> dict:
    """Before the game runs: whether it is a .NET Framework game and whether its prefix has Microsoft's runtime.
    `exe` is a non-Steam shortcut's program; a Steam game's folder is looked up."""
    if not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    game = steam_library.find_game(app_id)
    folder = game["game_directory"] if game else os.path.dirname(exe)
    dotnet = any(managed(path) for path in _game_programs(folder, exe)) if folder else False
    prefix = next((prefix for prefix in _prefixes(app_id) if prefix.is_dir()), None)
    return {"managed": dotnet, "prefix": prefix is not None, "ms_dotnet": bool(prefix and ms_dotnet(prefix))}


def _game_pid(app_id: str, programs: list[str], proc: Path) -> int:
    """The game's own process with the most memory; trainers and Wine's programs are left out."""
    names = {game_window._base(program) for program in programs if isinstance(program, str) and program}
    markers = game_window._app_markers(app_id)
    best, pages = 0, -1
    try:
        pids = [entry.name for entry in proc.iterdir() if entry.name.isdigit()]
    except OSError:
        return 0
    for pid in pids:
        # Steam marks the game's processes with its app ID; a game that reports
        # another Steam ID still runs under the reaper of the app that was launched.
        if not game_window._belongs(pid, markers, proc) and launch_check.reaper_app(pid, proc) != app_id:
            continue
        head = next((word for word in game_window._command(int(pid), proc)[:4] if word.lower().endswith(".exe")), "")
        name = game_window._base(head)
        if not name or name in names or name in game_window.NOT_THE_GAME or "cheatengine" in name.replace(" ", ""):
            continue
        resident = game_window._resident(int(pid), proc)
        if resident > pages:
            best, pages = int(pid), resident
    return best


def _tool_mono(pid: int, proc: Path) -> str:
    try:
        environment = (proc / str(pid) / "environ").read_bytes().split(b"\0")
    except OSError:
        return ""
    for entry in environment:
        if entry.startswith(b"WINEDLLPATH="):
            # Colon-separated; a lone letter before a colon is a drive (tests run on Windows too).
            items: list[str] = []
            for piece in entry[len(b"WINEDLLPATH="):].decode(errors="replace").split(":"):
                if items and len(items[-1]) == 1 and items[-1].isalpha():
                    items[-1] += ":" + piece
                else:
                    items.append(piece)
            for item in items:
                files = item.split("/lib/")[0] if "/lib/" in item else ""
                mono = Path(files) / "share" / "wine" / "mono" if files else None
                if mono and mono.is_dir():
                    versions = sorted(name[len("wine-mono-"):] for name in os.listdir(mono) if name.startswith("wine-mono-"))
                    if versions:
                        return versions[-1]
    return ""


def runtime(app_id: str, programs: list[str], proc: Path = PROC) -> dict | None:
    """While the game runs: what its process has loaded and the Proton it runs with; None without a game process."""
    if not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    pid = _game_pid(app_id, programs, proc)
    if not pid:
        return None
    try:
        with open(proc / str(pid) / "maps", "rb") as source:
            maps = source.read(MAPS_LIMIT)
    except OSError:
        maps = b""
    try:
        with open(proc / str(pid) / "exe", "rb") as source:
            elf = source.read(5)
    except OSError:
        elf = b""
    mono = _MONO.search(maps)
    trainers = [program for program in programs if isinstance(program, str) and program.lower().endswith(".exe")]
    return {
        "wine_mono": mono.group(1).decode() if mono else "",
        "ms_clr": bool(_CLR.search(maps)),
        "elf32": elf[:4] == b"\x7fELF" and elf[4:5] == b"\x01",
        "tool_mono": _tool_mono(pid, proc),
        "managed_trainers": [os.path.basename(program) for program in trainers if managed(program)],
    }
