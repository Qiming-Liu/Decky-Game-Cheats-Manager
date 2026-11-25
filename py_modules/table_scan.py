"""Checks a table's byte patterns against the game's files, without the game.

Most table entries find the code they change with an AOB scan, a byte pattern
with wildcards in an Auto Assembler script:

    aobscanmodule(INJECT, GameAssembly.dll, 48 8B 05 ?? ?? ?? ?? 8B 40 1C)

The code in a module file on disk is the code the game runs, so a pattern
that is not in the named module's file will not be found in the game either:
the table was most likely made for another version. Each entry is reported as

- "missing": a pattern names a module of the game and is not in its file;
- "found": every pattern was found;
- "unchecked": nothing could be decided (no pattern, a pattern for the whole
  process or an unknown module, a packed module whose file differs from what
  runs, a pattern without fixed bytes).

Only "missing" is a claim. A pattern for the game's own executable ($process)
is looked for in the executables of the game folder and counts only when found.

For an IL2CPP game (GameAssembly.dll in its folder), entries are also listed
under "injection" when their scripts use Cheat Engine's Mono/IL2CPP features
(LaunchMonoDataCollector, mono_* calls, or a Class:Method / Class.Method
symbol), which inject Cheat Engine's data collector into the game. Under FEX
on ARM devices that injection failed for an IL2CPP game while it worked for
Mono games, so the panel warns on ARM ("arm" in the result); a hint, not a claim.
For any game, "collector" lists every entry that uses those features: on a
.NET Framework game that runs on Wine Mono, the panel says they may need
Microsoft's .NET (game_environment).
"""
from __future__ import annotations

import mmap
import os
import platform
import re
import threading
from pathlib import Path
from xml.parsers import expat

import steam_library
import trainer_table

# Comments are removed before patterns are read; {$lua} blocks are not Auto Assembler.
_COMMENTS = re.compile(r"//[^\r\n]*|/\*[\s\S]*?\*/|\{\$lua\}[\s\S]*?\{\$asm\}|\{(?!\$)[^{}]*\}", re.IGNORECASE)
_MODULE_SCAN = re.compile(r"\baobscanmodule\s*\(\s*[^,()]+,\s*([^,()]+?)\s*,\s*([0-9A-Fa-f?*\s]+?)\s*\)", re.IGNORECASE)
_REGION_SCAN = re.compile(r"\baobscanregion\s*\(\s*[^,()]+,\s*([^,()]+?)\s*,\s*[^,()]+,\s*([0-9A-Fa-f?*\s]+?)\s*\)",
                          re.IGNORECASE)
_PROCESS_SCAN = re.compile(r"\baobscan\s*\(\s*[^,()]+,\s*([0-9A-Fa-f?*\s]+?)\s*\)", re.IGNORECASE)
# Cheat Engine Lua calls that inject its Mono/IL2CPP data collector into the game.
_INJECTION_CALL = re.compile(r"\b(?:LaunchMonoDataCollector|mono_\w+|monoAA_\w+|il2cpp_\w+)\s*\(", re.IGNORECASE)
# A symbol only the data collector resolves: Namespace.Class:Method, or Class.Method in define()
# and as the bounds of aobscanregion(). Module exports (kernel32.Sleep) and module+offset are not.
_SYMBOL_ARGUMENTS = re.compile(r"\bdefine\s*\(\s*[^,()]+,\s*([^,()]+?)\s*\)"
                               r"|\baobscanregion\s*\(\s*[^,()]+,\s*([^,()]+?)\s*,\s*([^,()]+?)\s*,", re.IGNORECASE)
_CLASS_SYMBOL = re.compile(r"^[A-Za-z_][\w.`]*(?:::|[.:])[A-Za-z_<>][\w<>]*$")
_SYSTEM_MODULES = {"kernel32", "kernelbase", "ntdll", "user32", "gdi32", "advapi32", "ws2_32", "msvcrt", "ucrtbase",
                   "d3d9", "d3d11", "d3d12", "dxgi", "opengl32", "winmm", "xinput1_3", "xinput1_4", "steam_api",
                   "steam_api64", "unityplayer", "gameassembly", "mono", "mono-2.0-bdwgc"}
# Section names of packers and DRM wrappers: their files are decrypted only when they run.
PACKED_SECTIONS = {b".bind", b".vmp0", b".vmp1", b".vmp2", b".themida", b".winlice", b".enigma1", b".enigma2", b".arch"}
# Executables in a game folder that are not the game.
HELPERS = re.compile(r"crash|unins|setup|redist|launcher|report|helper|vc_?redist|dxsetup|ue4prereq", re.IGNORECASE)
MIN_ANCHOR = 3
MAX_CANDIDATES = 100000
MAX_FILES = 20000
MAX_DEPTH = 6
_lock = threading.Lock()
_cache: dict[tuple, dict] = {}


def _scripts(path: str) -> dict[int, list[str]]:
    """The Auto Assembler scripts of each entry, by entry ID."""
    scripts: dict[int, list[str]] = {}
    stack: list[dict] = []
    state = {"field": None, "text": [], "depth": 0}
    depths: list[int] = []

    def start(tag, _attributes):
        state["depth"] += 1
        if tag == "CheatEntry":
            stack.append({"id": 0, "scripts": []})
            depths.append(state["depth"])
        elif tag in ("ID", "AssemblerScript") and stack and state["depth"] == depths[-1] + 1:
            state["field"], state["text"] = tag, []

    def data(text):
        if state["field"]:
            state["text"].append(text)

    def end(tag):
        depth = state["depth"]
        state["depth"] -= 1
        if tag == "CheatEntry" and stack:
            entry = stack.pop()
            depths.pop()
            if entry["scripts"]:
                scripts.setdefault(entry["id"], []).extend(entry["scripts"])
        elif tag == state["field"] and stack and depth == depths[-1] + 1:
            text = "".join(state["text"])
            if tag == "ID":
                try:
                    stack[-1]["id"] = int(text.strip() or 0)
                except ValueError:
                    pass
            else:
                stack[-1]["scripts"].append(text)
            state["field"] = None

    parser = expat.ParserCreate()
    parser.StartElementHandler, parser.EndElementHandler, parser.CharacterDataHandler = start, end, data
    with open(path, "rb") as source:
        parser.ParseFile(source)
    return scripts


def patterns(script: str) -> list[tuple[str, str]]:
    """(module, pattern) for each AOB scan of a script; module "" scans the whole process."""
    text = _COMMENTS.sub(" ", script)
    found = [(module.strip(), pattern) for module, pattern in _MODULE_SCAN.findall(text)]
    for start, pattern in _REGION_SCAN.findall(text):
        # A region given as "module+offset" lies in that module; anything else is unknown.
        module = start.split("+", 1)[0].strip().strip('"') if "+" in start else ""
        found.append((module, pattern))
    found += [("", pattern) for pattern in _PROCESS_SCAN.findall(text)]
    return found


def _class_symbol(text: str) -> bool:
    name = text.strip().strip('"')
    # Class::Method+offset is a method's code; Module+offset is not a class symbol.
    if "::" in name:
        name = name.split("+", 1)[0].strip()
    if "+" in name or not _CLASS_SYMBOL.match(name):
        return False
    module = re.split(r"[.:]", name, maxsplit=1)[0].lower()
    return not name.lower().endswith((".dll", ".exe")) and module not in _SYSTEM_MODULES


def needs_injection(script: str) -> bool:
    """Whether a script uses Cheat Engine's Mono/IL2CPP features, which inject a DLL into the game."""
    text = re.sub(r"//[^\r\n]*|--[^\r\n]*", " ", script)
    if _INJECTION_CALL.search(text):
        return True
    return any(_class_symbol(argument) for match in _SYMBOL_ARGUMENTS.findall(text) for argument in match if argument)


def arm_device() -> bool:
    """Whether Decky runs on an ARM CPU (games run there through FEX)."""
    return platform.machine().lower() in ("aarch64", "arm64", "armv8l")


def parse_pattern(pattern: str) -> list[tuple[int, int]] | None:
    """(value, mask) per byte; a mask bit 0 is a wildcard. None for a malformed pattern."""
    words = pattern.split()
    if len(words) == 1:
        word = words[0]
        if len(word) % 2:
            return None
        words = [word[i:i + 2] for i in range(0, len(word), 2)]
    result = []
    for word in words:
        if len(word) == 1:
            word = "?" + word if word not in "?*" else "??"
        if len(word) != 2:
            return None
        value = mask = 0
        for shift, char in ((4, word[0]), (0, word[1])):
            if char in "?*":
                continue
            try:
                value |= int(char, 16) << shift
            except ValueError:
                return None
            mask |= 0xF << shift
        result.append((value, mask))
    return result or None


def find(data, pattern: list[tuple[int, int]]) -> bool | None:
    """Whether the pattern occurs in data; None when it has no fixed bytes to look for."""
    # The longest run of fixed bytes is searched for, the rest compared around it.
    best, run_start = (0, 0), None
    for index, (_value, mask) in enumerate(pattern + [(0, 0)]):
        if mask == 0xFF:
            run_start = index if run_start is None else run_start
        elif run_start is not None:
            if index - run_start > best[1] - best[0]:
                best = (run_start, index)
            run_start = None
    # Too few fixed bytes match almost anywhere: nothing would be proved.
    if best[1] - best[0] < MIN_ANCHOR:
        return None
    anchor = bytes(value for value, _mask in pattern[best[0]:best[1]])
    length = len(pattern)
    position = data.find(anchor)
    for _ in range(MAX_CANDIDATES):
        if position < 0:
            return False
        start = position - best[0]
        if start >= 0 and start + length <= len(data) and all(
                data[start + i] & mask == value for i, (value, mask) in enumerate(pattern) if mask):
            return True
        position = data.find(anchor, position + 1)
    return None


def packed(path: Path) -> bool:
    """Whether a PE file has a packer's or DRM wrapper's section."""
    try:
        with path.open("rb") as source:
            head = source.read(4096)
    except OSError:
        return False
    if head[:2] != b"MZ" or len(head) < 64:
        return False
    pe = int.from_bytes(head[60:64], "little")
    if head[pe:pe + 4] != b"PE\0\0":
        return False
    count = int.from_bytes(head[pe + 6:pe + 8], "little")
    table = pe + 24 + int.from_bytes(head[pe + 20:pe + 22], "little")
    names = {head[table + 40 * i:table + 40 * i + 8].rstrip(b"\0").lower() for i in range(min(count, 96))}
    return bool(names & PACKED_SECTIONS)


def _game_files(folder: str) -> dict[str, list[Path]]:
    """The game folder's .exe and .dll files by lower-case name."""
    files: dict[str, list[Path]] = {}
    seen = 0
    root_depth = folder.rstrip(os.sep).count(os.sep)
    for directory, subdirectories, names in os.walk(folder):
        if directory.count(os.sep) - root_depth >= MAX_DEPTH:
            subdirectories[:] = []
        for name in names:
            seen += 1
            if name.lower().endswith((".exe", ".dll")):
                files.setdefault(name.lower(), []).append(Path(directory) / name)
        if seen > MAX_FILES:
            break
    return files


def _search(path: Path, pattern: list[tuple[int, int]]) -> bool | None:
    try:
        with path.open("rb") as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
            return find(data, pattern)
    except (OSError, ValueError):
        return None


def _check(module: str, pattern_text: str, files: dict[str, list[Path]]) -> str:
    pattern = parse_pattern(pattern_text)
    if pattern is None:
        return "unchecked"
    name = module.strip().strip('"').lower()
    if name in ("", "$process"):
        # The game's own executable: counted only when found in one of them.
        candidates = [path for key, paths in files.items() if key.endswith(".exe") and not HELPERS.search(key)
                      for path in paths]
        return "found" if any(_search(path, pattern) for path in candidates) else "unchecked"
    paths = files.get(name, [])
    if not paths or any(packed(path) for path in paths):
        return "unchecked"
    results = [_search(path, pattern) for path in paths]
    if any(results):
        return "found"
    return "missing" if all(result is False for result in results) else "unchecked"


def scan(table: str, app_id: str) -> dict:
    """Each entry's result by ID (only entries with an AOB scan), the game folder checked, the IDs of
    entries that need Cheat Engine's injected data collector in an IL2CPP game, and whether this is an ARM device."""
    file = Path(table)
    if file.suffix.lower() not in trainer_table.TABLE_EXTENSIONS or not file.is_file():
        raise ValueError("Choose a .ct file.")
    if not app_id.isdigit():
        raise ValueError("Invalid app ID.")
    game = steam_library.find_game(app_id)
    if not game:
        return {"entries": {}, "folder": "", "injection": [], "collector": [], "arm": arm_device()}
    folder = game["game_directory"]
    info = file.stat()
    key = (str(file), info.st_mtime_ns, info.st_size, folder, game["build_id"])
    with _lock:
        if key in _cache:
            return _cache[key]
    try:
        scripts = _scripts(str(file))
    except (OSError, expat.ExpatError):
        return {"entries": {}, "folder": folder, "injection": [], "collector": [], "arm": arm_device()}
    files = _game_files(folder)
    collector = sorted(str(entry_id) for entry_id, texts in scripts.items() if any(needs_injection(text) for text in texts))
    injection = collector if "gameassembly.dll" in files else []
    checked: dict[tuple[str, str], str] = {}
    entries: dict[str, str] = {}
    for entry_id, texts in scripts.items():
        found = [pattern for text in texts for pattern in patterns(text)]
        if not found:
            continue
        results = []
        for module, pattern_text in found:
            if (module, pattern_text) not in checked:
                checked[(module, pattern_text)] = _check(module, pattern_text, files)
            results.append(checked[(module, pattern_text)])
        entries[str(entry_id)] = ("missing" if "missing" in results
                                  else "found" if all(result == "found" for result in results) else "unchecked")
    result = {"entries": entries, "folder": folder, "injection": injection, "collector": collector, "arm": arm_device()}
    with _lock:
        _cache[key] = result
    return result
