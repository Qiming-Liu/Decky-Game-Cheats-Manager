"""Reads the entries of a Cheat Engine table file (.ct), which is XML.

Decky's bundled Python ships the expat parser but not xml.etree, so the
few tags a table uses are collected straight from expat's callbacks.
"""
from __future__ import annotations

import re
from pathlib import Path
from xml.parsers import expat

import plugin_data

TABLE_EXTENSIONS = set(plugin_data.load("library")["table_extensions"])
MAX_SIZE = 32 * 1024 * 1024
# Only direct entry fields are read. Script text is classified and then discarded.
FIELDS = {"ID", "Description", "VariableType", "GroupHeader", "DropDownList", "AssemblerScript", "ByteLength"}
AA_COMMENT_TOKEN = re.compile(
    r"[ \t\r\n]+|//[^\r\n]*|/\*[\s\S]*?\*/|\{(?!\$)[^{}]*\}"
    r"|\[(?:ENABLE|DISABLE)\][ \t]*(?=//|[\r\n]|$)",
    re.IGNORECASE,
)
# What in a table runs code when Cheat Engine opens it or an entry is switched
# on. Lua and forms (whose handlers are Lua) reach the whole system; embedded
# files can be written to disk by that Lua; Auto Assembler patches the game.
CODE_TEXT = {"LuaScript": "lua", "LuaScriptEntry": "lua", "AssemblerScript": "assembler"}
CODE_FORMS = {"CustomForm", "UDF1"}
CODE_FILES = {"TableFile", "File"}


def _is_comment_script(text: str) -> bool:
    """Recognize empty templates and comments without interpreting script code."""
    position = 0
    while position < len(text):
        token = AA_COMMENT_TOKEN.match(text, position)
        if token is None:
            return False
        # Directives inside a multiline comment may be seen by an earlier AA pass.
        if token.group().startswith(("/*", "{")) and "{$" in token.group():
            return False
        position = token.end()
    return True


def _entry() -> dict:
    return {"id": 0, "desc": "", "group": False, "type": "", "active": False, "value": "", "error": "", "children": []}


class _Reader:
    """Builds the entry tree from the CheatEntry elements as expat reports them."""

    def __init__(self):
        self.root = _entry()
        self.stack = [self.root]
        # The depth of each open CheatEntry; only its direct children are its
        # fields (a hotkey inside it has an ID and a Description of its own).
        self.depths = [0]
        self.field = None
        self.text: list[str] = []
        self.depth = 0
        self.top = ""
        self.code: set[str] = set()
        self.code_tag = None
        self.code_text: list[str] = []
        self.containers: list[str] = []

    def start(self, tag, _attributes):
        self.depth += 1
        if self.depth == 1:
            self.top = tag
        if tag in CODE_TEXT and self.code_tag is None:
            self.code_tag, self.code_text = tag, []
        elif tag in CODE_FORMS or (self.containers and self.containers[-1] == "Forms"):
            self.code.add("forms")
        elif tag in CODE_FILES and "Files" in self.containers:
            self.code.add("files")
        # Empty <Forms/> and <Files/> containers hold nothing that runs.
        self.containers.append(tag)
        if tag == "CheatEntry":
            entry = _entry()
            self.stack[-1]["children"].append(entry)
            self.stack.append(entry)
            self.depths.append(self.depth)
        elif tag in FIELDS and len(self.stack) > 1 and self.depth == self.depths[-1] + 1:
            self.field, self.text = tag, []

    def data(self, text):
        if self.field is not None:
            self.text.append(text)
        if self.code_tag is not None:
            self.code_text.append(text)

    def end(self, tag):
        depth, self.depth = self.depth, self.depth - 1
        self.containers.pop()
        if tag == self.code_tag:
            text = "".join(self.code_text)
            if text.strip() and not (tag == "AssemblerScript" and _is_comment_script(text)):
                self.code.add(CODE_TEXT[tag])
                # Auto Assembler runs {$lua} blocks as Lua.
                if tag == "AssemblerScript" and "{$lua}" in text.lower():
                    self.code.add("lua")
            self.code_tag, self.code_text = None, []
        if tag == "CheatEntry":
            if len(self.stack) > 1:
                entry = self.stack.pop()
                comment_script = entry.pop("comment_script", False)
                byte_length = entry.pop("byte_length", None)
                if (
                    (entry["type"] == "script" and comment_script and not entry["children"])
                    or (entry["type"] == "Array of byte" and byte_length == "0")
                    or (entry["group"] and not entry["type"] and not entry["children"])
                ):
                    entry["displayOnly"] = True
                self.depths.pop()
        elif tag == self.field and depth == self.depths[-1] + 1:
            self._apply(self.stack[-1], tag, "".join(self.text))
            self.field, self.text = None, []

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
        elif tag == "AssemblerScript":
            entry["comment_script"] = _is_comment_script(text)
        elif tag == "ByteLength":
            entry["byte_length"] = value
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
    # `code`: what in the file can run code (lua, forms, files, assembler), for the import warning.
    return {"table": file.name, "entries": reader.root["children"], "code": sorted(reader.code)}
