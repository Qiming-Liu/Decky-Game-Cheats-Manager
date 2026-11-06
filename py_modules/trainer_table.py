"""Reads the entries of a Cheat Engine table file (.ct), which is XML.

Decky's bundled Python ships without the xml package, so the few tags a
table uses are read with a small parser of its own.
"""
from __future__ import annotations

import re
from pathlib import Path

TABLE_EXTENSIONS = {".ct", ".cetrainer"}
MAX_SIZE = 32 * 1024 * 1024
_TOKEN = re.compile(r"<!\[CDATA\[(.*?)\]\]>|<!--.*?-->|<\?.*?\?>|<(/?)([A-Za-z_][\w.-]*)([^>]*?)(/?)>|([^<]+)", re.S)
_ENTITY = re.compile(r"&(#x[0-9A-Fa-f]+|#\d+|quot|amp|lt|gt|apos);")


def _unescape(text: str) -> str:
    def replace(match):
        name = match.group(1)
        if name.startswith("#x"):
            return chr(int(name[2:], 16))
        if name.startswith("#"):
            return chr(int(name[1:]))
        return {"quot": '"', "amp": "&", "lt": "<", "gt": ">", "apos": "'"}[name]
    return _ENTITY.sub(replace, text)


class _Element:
    __slots__ = ("tag", "text", "children")

    def __init__(self, tag: str):
        self.tag = tag
        self.text = ""
        self.children: list[_Element] = []

    def find(self, tag: str) -> _Element | None:
        return next((child for child in self.children if child.tag == tag), None)

    def findall(self, tag: str) -> list[_Element]:
        return [child for child in self.children if child.tag == tag]


def _parse(source: str) -> _Element:
    root = _Element("")
    stack = [root]
    for match in _TOKEN.finditer(source):
        cdata, closing, tag, _attributes, empty, text = match.groups()
        if cdata is not None:
            stack[-1].text += cdata
        elif text is not None:
            stack[-1].text += _unescape(text)
        elif tag is None:
            continue
        elif closing:
            if len(stack) < 2 or stack[-1].tag != tag:
                raise ValueError("The table file could not be read.")
            stack.pop()
        else:
            element = _Element(tag)
            stack[-1].children.append(element)
            if not empty:
                stack.append(element)
    if len(stack) != 1 or len(root.children) != 1:
        raise ValueError("The table file could not be read.")
    return root.children[0]


def _text(node: _Element | None) -> str:
    value = node.text.strip() if node is not None else ""
    # Descriptions are stored quoted.
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = value[1:-1]
    return value


def _entry(node: _Element) -> dict:
    kind = _text(node.find("VariableType"))
    try:
        identifier = int(_text(node.find("ID")) or 0)
    except ValueError:
        identifier = 0
    entry = {
        "id": identifier,
        "desc": _text(node.find("Description")),
        "group": _text(node.find("GroupHeader")) == "1",
        "type": "script" if kind == "Auto Assembler Script" else kind,
        "active": False, "value": "", "error": "",
        "children": [_entry(child) for entries in node.findall("CheatEntries") for child in entries.findall("CheatEntry")],
    }
    options = node.find("DropDownList")
    if options is not None and options.text.strip():
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
        root = _parse(file.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError) as error:
        raise ValueError("The table file could not be read.") from error
    if root.tag != "CheatTable":
        raise ValueError("The table file could not be read.")
    return {"table": file.name, "entries": [_entry(node) for entries in root.findall("CheatEntries") for node in entries.findall("CheatEntry")]}
