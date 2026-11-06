"""Reading table files and the file bridge to Cheat Engine."""
from __future__ import annotations

import json
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
        self.assertEqual(runes["type"], "4 Bytes")
        self.assertEqual(level["options"], [{"value": "0", "label": "+0"}, {"value": "10", "label": "+10"}])
        for bad in (self.root / "missing.ct", self.root / "notes.txt"):
            with self.assertRaises(ValueError):
                trainer_table.read(str(bad))

    def test_bridge_numbers_commands_and_reads_state_beside_the_table(self):
        ct_bridge.start(str(self.table))
        runtime = self.root / ct_bridge.RUNTIME
        self.assertTrue(runtime.is_dir())
        self.assertEqual(ct_bridge.send(str(self.table), {"id": 2, "active": True}), 1)
        self.assertEqual(ct_bridge.send(str(self.table), {"id": 3, "value": 100}), 2)
        lines = [json.loads(line) for line in (runtime / ct_bridge.COMMANDS).read_text(encoding="utf-8").splitlines()]
        self.assertEqual(lines, [{"n": 1, "id": 2, "active": True}, {"n": 2, "id": 3, "value": "100"}])
        for bad in ({}, {"id": "2", "active": True}, {"run": "x"}, {"id": 2, "active": True, "extra": 1}):
            with self.assertRaises(ValueError):
                ct_bridge.send(str(self.table), bad)
        self.assertIsNone(ct_bridge.state(str(self.table)))
        (runtime / ct_bridge.STATE).write_text(json.dumps({"table": "EldenRing.CT", "attached": "eldenring.exe", "pid": 7, "last_n": 2, "entries": []}))
        state = ct_bridge.state(str(self.table))
        self.assertEqual((state["attached"], state["last_n"]), ("eldenring.exe", 2))
        self.assertGreaterEqual(state["age"], 0)
        # Starting again drops the old commands; stopping removes the folder.
        ct_bridge.start(str(self.table))
        self.assertEqual(ct_bridge.send(str(self.table), {"all": False}), 1)
        self.assertIsNone(ct_bridge.state(str(self.table)))
        ct_bridge.stop(str(self.table))
        self.assertFalse(runtime.exists())


if __name__ == "__main__":
    unittest.main()
