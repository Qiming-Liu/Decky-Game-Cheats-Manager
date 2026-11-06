"""Reads the entries of a Cheat Engine table file (.ct), which is XML."""
from __future__ import annotations

import xml.etree.ElementTree as ElementTree
from pathlib import Path

TABLE_EXTENSIONS = {".ct", ".cetrainer"}
MAX_SIZE = 32 * 1024 * 1024


def _text(node: ElementTree.Element | None) -> str:
    value = (node.text or "") if node is not None else ""
    value = value.strip()
    # Descriptions are stored quoted.
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = value[1:-1]
    return value


def _entry(node: ElementTree.Element) -> dict:
    kind = _text(node.find("VariableType"))
    entry = {
        "id": int(_text(node.find("ID")) or 0),
        "desc": _text(node.find("Description")),
        "group": _text(node.find("GroupHeader")) == "1",
        "type": "script" if kind == "Auto Assembler Script" else kind,
        "active": False, "value": "", "error": "",
        "children": [_entry(child) for child in node.findall("./CheatEntries/CheatEntry")],
    }
    options = node.find("DropDownList")
    if options is not None and options.text:
        entry["options"] = [
            {"value": line.split(":", 1)[0].strip(), "label": line.split(":", 1)[-1].strip()}
            for line in options.text.splitlines() if line.strip()
        ]
    return entry


def read(path: str) -> dict:
    """The table's entry tree, as the bridge reports it before Cheat Engine attaches."""
    file = Path(path)
    if file.suffix.lower() not in TABLE_EXTENSIONS or not file.is_file():
        raise ValueError("Choose a .ct file.")
    if file.stat().st_size > MAX_SIZE:
        raise ValueError("The table file is too large.")
    try:
        root = ElementTree.parse(file).getroot()
    except ElementTree.ParseError as error:
        raise ValueError(f"The table file could not be read: {error}") from error
    if root.tag != "CheatTable":
        raise ValueError("The table file could not be read.")
    return {"table": file.name, "entries": [_entry(node) for node in root.findall("./CheatEntries/CheatEntry")]}
