"""Which game a library entry belongs to. Pure: names and entries in, a verdict out."""
from __future__ import annotations

import re
import unicodedata
from pathlib import PurePath


def normalized(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def _named_in(candidate: str, name: str) -> bool:
    candidate = re.sub(r"^\[[^\]]+\]\s*", "", PurePath(candidate).stem)
    # Keep word/number boundaries so e.g. Portal does not include Portal 2.
    pattern = re.escape(name).replace(r"\ ", r"[\s_.-]+")
    if re.search(r"(?<!\w)" + pattern + r"(?!\w|[\s_.-]+\d)", candidate, re.I):
        return True
    # Chinese GCM names commonly use 《title》 without whitespace.
    return any("\u4e00" <= c <= "\u9fff" for c in name) and f"《{name}》" in candidate


def matches(entry: dict, app_id: str, names: list[str]) -> bool:
    """An entry with app IDs belongs to exactly those games. One without is
    matched by its recorded game name, then by its file names."""
    if entry["app_ids"]:
        return app_id in entry["app_ids"]
    if entry["game_name"]:
        return normalized(entry["game_name"]) in {normalized(name) for name in names}
    candidates = [entry["name"], *entry["files"]]
    return any(_named_in(candidate, name) for candidate in candidates for name in names)
