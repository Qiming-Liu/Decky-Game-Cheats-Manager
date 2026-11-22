"""Reading table files and the file bridge to Cheat Engine."""
from __future__ import annotations

import json
import threading
from unittest.mock import patch
import tempfile
import unittest
from pathlib import Path

import ct_bridge
import trainer_table

TABLE = """<?xml version="1.0" encoding="utf-8"?>
<CheatTable CheatEngineTableVersion="45">
  <CheatEntries>
    <CheatEntry>
      <ID>1</ID>
      <Description>"Player"</Description>
      <Options moHideChildren="1"/>
      <GroupHeader>1</GroupHeader>
      <CheatEntries>
        <CheatEntry>
          <ID>2</ID>
          <Description>"Infinite Health"</Description>
          <VariableType>Auto Assembler Script</VariableType>
          <AssemblerScript>[ENABLE]
[DISABLE]</AssemblerScript>
          <Hotkeys>
            <Hotkey>
              <Action>Toggle Activation</Action>
              <Keys><Key>112</Key></Keys>
              <ID>0</ID>
              <Description>Toggle health</Description>
            </Hotkey>
          </Hotkeys>
        </CheatEntry>
        <CheatEntry>
          <ID>3</ID>
          <Description>"Runes"</Description>
          <VariableType>4 Bytes</VariableType>
          <Address>12345</Address>
        </CheatEntry>
        <CheatEntry>
          <ID>4</ID>
          <Description>"Weapon level"</Description>
          <DropDownList DescriptionOnly="1">0:+0
10:+10
</DropDownList>
          <VariableType>Byte</VariableType>
        </CheatEntry>
      </CheatEntries>
    </CheatEntry>
  </CheatEntries>
</CheatTable>
"""


class TableTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.table = self.root / "EldenRing.CT"
        self.table.write_text(TABLE, encoding="utf-8")

    def test_table_entries_keep_groups_types_and_options(self):
        read = trainer_table.read(str(self.table))
        self.assertEqual(read["table"], "EldenRing.CT")
        group = read["entries"][0]
        self.assertEqual((group["id"], group["desc"], group["group"]), (1, "Player", True))
        script, runes, level = group["children"]
        self.assertEqual((script["type"], script["active"], script["group"]), ("script", False, False))
        # A hotkey's own ID and Description do not replace the entry's.
        self.assertEqual((script["id"], script["desc"]), (2, "Infinite Health"))
        self.assertEqual(runes["type"], "4 Bytes")
        self.assertEqual(level["options"], [{"value": "0", "label": "+0"}, {"value": "10", "label": "+10"}])
        for bad in (self.root / "missing.ct", self.root / "notes.txt"):
            with self.assertRaises(ValueError):
                trainer_table.read(str(bad))

    def test_marks_only_comment_scripts(self):
        template = "[ENABLE]\n[DISABLE]"
        for script, comment in (
            (template, True),
            ("[enable] // Enable section\n/* A note */\n{ Credits }\n[disable]\n// End", True),
            ("[ENABLE]\n// A note\n[DISABLE]\ndb 90", False),
            ("[ENABLE]\n/* A note */ db 90\n[DISABLE]", False),
            ("[ENABLE]\n{$lua}\nprint('enabled')\n{$asm}\n[DISABLE]", False),
            ("[ENABLE]\n/* Unterminated comment\n[DISABLE]", False),
        ):
            with self.subTest(script=script):
                self.table.write_text(TABLE.replace(template, script), encoding="utf-8")
                entries = trainer_table.read(str(self.table))["entries"][0]["children"]
                self.assertEqual(entries[0].get("displayOnly", False), comment)
                self.assertNotIn("displayOnly", entries[1])

    def test_empty_byte_array_heading_keeps_its_writable_children(self):
        table = TABLE.replace(
            "<GroupHeader>1</GroupHeader>",
            "<VariableType>Array of byte</VariableType><ByteLength>0</ByteLength><Address>12345</Address>",
        )
        self.table.write_text(table, encoding="utf-8")
        heading = trainer_table.read(str(self.table))["entries"][0]
        self.assertTrue(heading["displayOnly"])
        self.assertNotIn("displayOnly", heading["children"][1])
        self.table.write_text(table.replace("<ByteLength>0", "<ByteLength>1"), encoding="utf-8")
        self.assertNotIn("displayOnly", trainer_table.read(str(self.table))["entries"][0])

    @patch("ct_bridge.time.time_ns", return_value=1_000_000_000)
    def test_bridge_numbers_commands_and_reads_state_beside_the_table(self, _clock):
        ct_bridge.start(str(self.table))
        runtime = self.root / ct_bridge.RUNTIME
        self.assertTrue(runtime.is_dir())
        first = ct_bridge.send(str(self.table), {"id": 2, "active": True})
        second = ct_bridge.send(str(self.table), {"id": 3, "value": 100})
        self.assertGreater(second, first)
        lines = [json.loads(line) for line in (runtime / ct_bridge.COMMANDS).read_text(encoding="utf-8").splitlines()]
        self.assertEqual(lines, [{"n": first, "id": 2, "active": True}, {"n": second, "id": 3, "value": "100"}])
        for bad in ({}, {"id": "2", "active": True}, {"run": "x"}, {"id": 2, "active": True, "extra": 1}):
            with self.assertRaises(ValueError):
                ct_bridge.send(str(self.table), bad)
        self.assertIsNone(ct_bridge.state(str(self.table)))
        (runtime / ct_bridge.STATE).write_text(json.dumps({"table": "EldenRing.CT", "attached": "eldenring.exe", "pid": 7, "last_n": 2, "entries": []}))
        state = ct_bridge.state(str(self.table))
        self.assertEqual((state["attached"], state["last_n"]), ("eldenring.exe", 2))
        self.assertGreaterEqual(state["age"], 0)
        # Starting again drops the old commands, but Cheat Engine still runs and
        # remembers the last number: a new session never reuses one.
        ct_bridge.start(str(self.table))
        self.assertEqual((runtime / ct_bridge.COMMANDS).read_text(encoding="utf-8"), "")
        self.assertGreater(ct_bridge.send(str(self.table), {"all": False}), second)
        self.assertIsNone(ct_bridge.state(str(self.table)))
        ct_bridge.stop(str(self.table))
        self.assertFalse(runtime.exists())
        # Only the bridge's own files are removed: anything else in the folder stays.
        ct_bridge.start(str(self.table))
        self.assertGreater(ct_bridge.send(str(self.table), {"all": True}), second + 1)
        (runtime / "notes.txt").write_text("mine", encoding="utf-8")
        ct_bridge.stop(str(self.table))
        self.assertEqual([file.name for file in runtime.iterdir()], ["notes.txt"])

    def test_attach_takes_cheat_engines_own_list_and_stops_once_attached(self):
        proc = self.root / "proc"
        proc.mkdir()
        listed = {"pid": 0, "processes": [
            {"pid": 48, "name": "services.exe", "window": False},
            {"pid": 424, "name": "cheatengine-x86_64-SSE4-AVX2.exe", "window": True},
            {"pid": 352, "name": "Game.exe", "window": True},
            {"pid": 400, "name": "steam.exe", "window": True},
        ]}
        sent = []
        replies = iter([None, listed, listed, listed, {"pid": 352}])
        # A fresh stop flag: unloading the plugin in another test sets the shared one.
        with patch.object(ct_bridge, "_stop", threading.Event()), patch.object(ct_bridge, "ATTACH_POLL", 0), \
                patch.object(ct_bridge, "send", lambda table, command: sent.append(command)), \
                patch.object(ct_bridge, "state", lambda table: next(replies)), \
                patch.object(ct_bridge.game_window, "_root_properties", lambda display: {}):
            ct_bridge._attach_when_ready(str(self.table), "42", [], proc)
        # Cheat Engine's PID for the game, sent once after the second sighting.
        self.assertEqual(sent, [{"attach": 352}])
        # The folder Cheat Engine writes its state (and so its list) into exists before anything is sent.
        self.assertTrue((self.root / ct_bridge.RUNTIME).is_dir())
        for bad in (0, -1, True, 1.5):
            with self.assertRaises(ValueError):
                ct_bridge.send(str(self.table), {"attach": bad})

if __name__ == "__main__":
    unittest.main()
