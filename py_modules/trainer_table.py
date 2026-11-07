"""Reads the entries of a Cheat Engine table file (.ct), which is XML.

Decky's bundled Python ships the expat parser but not xml.etree, so the
few tags a table uses are collected straight from expat's callbacks.
"""
from __future__ import annotations

from pathlib import Path
from xml.parsers import expat

TABLE_EXTENSIONS = {".ct", ".cetrainer"}
MAX_SIZE = 32 * 1024 * 1024
# The tags of a CheatEntry whose text is kept; everything else (scripts, hotkeys) is skipped.
FIELDS = {"ID", "Description", "VariableType", "GroupHeader", "DropDownList"}


def _entry() -> dict:
    return {"id": 0, "desc": "", "group": False, "type": "", "active": False, "value": "", "error": "", "children": []}


class _Reader:
    """Builds the entry tree from the CheatEntry elements as expat reports them."""

    def __init__(self):
        self.root = _entry()
        self.stack = [self.root]
        self.field = None
        self.text: list[str] = []
        self.depth = 0
        self.top = ""

    def start(self, tag, _attributes):
        self.depth += 1
        if self.depth == 1:
            self.top = tag
        if tag == "CheatEntry":
            entry = _entry()
            self.stack[-1]["children"].append(entry)
            self.stack.append(entry)
        elif tag in FIELDS and len(self.stack) > 1:
            self.field, self.text = tag, []

    def data(self, text):
        if self.field is not None:
            self.text.append(text)

    def end(self, tag):
        self.depth -= 1
        if tag == "CheatEntry":
            if len(self.stack) > 1:
                self.stack.pop()
        elif tag == self.field:
            self._apply(self.stack[-1], tag, "".join(self.text))
            self.field = None

    @staticmethod
    def _apply(entry: dict, tag: str, text: str):
        value = text.strip()
        if tag == "ID":
            try:
                entry["id"] = int(value or 0)
            except ValueError:
                entry["id"] = 0
        elif tag == "Description":
            # Descriptions are stored quoted.
            entry["desc"] = value[1:-1] if len(value) >= 2 and value[0] == value[-1] == '"' else value
        elif tag == "VariableType":
            entry["type"] = "script" if value == "Auto Assembler Script" else value
        elif tag == "GroupHeader":
            entry["group"] = value == "1"
        elif tag == "DropDownList" and value:
            entry["options"] = [
                {"value": line.split(":", 1)[0].strip(), "label": line.split(":", 1)[-1].strip()}
                for line in text.splitlines() if line.strip()
            ]


def read(path: str) -> dict:
    """The table's entry tree, as the bridge reports it before Cheat Engine attaches."""
    file = Path(path)
    if file.suffix.lower() not in TABLE_EXTENSIONS or not file.is_file():
        raise ValueError("Choose a .ct file.")
    if file.stat().st_size > MAX_SIZE:
        raise ValueError("The table file is too large.")
    reader = _Reader()
    parser = expat.ParserCreate()
    parser.StartElementHandler = reader.start
    parser.EndElementHandler = reader.end
    parser.CharacterDataHandler = reader.data
    try:
        with file.open("rb") as source:
            parser.ParseFile(source)
    except (OSError, expat.ExpatError) as error:
        raise ValueError("The table file could not be read.") from error
    if reader.top != "CheatTable" or len(reader.stack) != 1:
        raise ValueError("The table file could not be read.")
    return {"table": file.name, "entries": reader.root["children"]}
