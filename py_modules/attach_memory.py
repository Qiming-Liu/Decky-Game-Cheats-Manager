"""Which process each game's Cheat Engine should attach to, as far as the plugin can tell before it starts.

Two clues, best first:

- the process the player last picked by hand from the panel for that game
  (a pick by hand means automatic attaching got it wrong, or never could);
- the executables the table itself names: `"Game.exe"+1A2B` addresses,
  `aobscanmodule(..., Game.exe, ...)`, `openProcess("Game.exe")`.

Names only: a process ID means nothing in the next session.
"""
from __future__ import annotations

import os
import re
import threading
from collections import Counter

import decky
from library_storage import read_json, write_json

PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "attach_targets.json")
# Tables are text; a huge one is read only this far.
TABLE_BYTES = 16 * 1024 * 1024
# A quoted name ("Game.exe", 'Game.exe') or a bare one followed by +offset or
# an argument comma (Game.exe+1A2B, aobscanmodule(INJECT, Game.exe, ...)).
_QUOTED = re.compile(r"[\"']([^\"'\\/<>:*?|\r\n]{1,100}?\.exe)[\"']", re.IGNORECASE)
_BARE = re.compile(r"(?<![\w.\-])([\w.\-]{1,100}\.exe)\s*[+,]", re.IGNORECASE)
_lock = threading.Lock()


def _name(value) -> str:
    """A process name as Cheat Engine lists it, or "" for anything else."""
    if not isinstance(value, str):
        return ""
    name = value.strip()
    return name if 4 < len(name) <= 100 and name.lower().endswith(".exe") and not re.search(r"[\\/\r\n]", name) else ""


def remembered(app_id: str) -> str:
    """The process the player last picked by hand for this game, or ""."""
    if not app_id.isdigit():
        return ""
    with _lock:
        return _name(read_json(PATH).get(app_id))


def remember(app_id: str, name: str) -> bool:
    """Keeps a pick by hand for the game's next session; False when it is not a process name."""
    name = _name(name)
    if not app_id.isdigit() or not name:
        return False
    with _lock:
        data = {key: value for key, value in read_json(PATH).items() if key.isdigit() and _name(value)}
        if data.get(app_id) != name:
            data[app_id] = name
            write_json(PATH, data)
    return True


def table_names(table: str) -> list[str]:
    """The executables a table names, most often named first."""
    try:
        with open(table, "rb") as source:
            text = source.read(TABLE_BYTES).decode("utf-8", errors="ignore")
    except OSError:
        return []
    counts: Counter[str] = Counter()
    spelling: dict[str, str] = {}
    for found in _QUOTED.findall(text) + _BARE.findall(text):
        name = _name(found)
        if name:
            counts[name.lower()] += 1
            spelling.setdefault(name.lower(), name)
    return [spelling[key] for key, _ in counts.most_common()]


def clues(app_id: str, table: str) -> list[str]:
    """Process names to look for, best first, lowercase and without repeats."""
    names = [remembered(app_id)] + table_names(table)
    return list(dict.fromkeys(name.lower() for name in names if name))
