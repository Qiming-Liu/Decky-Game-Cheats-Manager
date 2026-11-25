"""Checking a table's byte patterns against the game's files."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import table_scan

TABLE = """<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <ID>1</ID>
      <Description>"Found"</Description>
      <AssemblerScript>[ENABLE]
// aobscanmodule(OLD, GameAssembly.dll, FF FF FF FF)
aobscanmodule(INJECT,GameAssembly.dll,48 8B 05 ?? ?? ?? ?? 8B 4?)
[DISABLE]</AssemblerScript>
      <CheatEntries>
        <CheatEntry>
          <ID>2</ID>
          <Description>"Missing"</Description>
          <AssemblerScript>aobscanmodule(INJECT, GameAssembly.dll, 0F1F4400??AABBCC)</AssemblerScript>
        </CheatEntry>
      </CheatEntries>
    </CheatEntry>
    <CheatEntry>
      <ID>3</ID>
      <Description>"Whole process"</Description>
      <AssemblerScript>aobscan(INJECT, 11 22 33 44)</AssemblerScript>
    </CheatEntry>
    <CheatEntry>
      <ID>4</ID>
      <Description>"Main executable"</Description>
      <AssemblerScript>aobscanmodule(INJECT, $process, DE AD BE EF 01)</AssemblerScript>
    </CheatEntry>
    <CheatEntry>
      <ID>5</ID>
      <Description>"Value"</Description>
      <VariableType>4 Bytes</VariableType>
    </CheatEntry>
  </CheatEntries>
</CheatTable>
"""


def pe(sections: list[bytes], body: bytes) -> bytes:
    """A minimal PE header with the given section names, then `body`."""
    head = bytearray(512)
    head[:2] = b"MZ"
    head[60:64] = (64).to_bytes(4, "little")
    head[64:68] = b"PE\0\0"
    head[70:72] = len(sections).to_bytes(2, "little")
    head[84:86] = (0).to_bytes(2, "little")  # no optional header
    for i, name in enumerate(sections):
        head[88 + 40 * i:88 + 40 * i + len(name)] = name
    return bytes(head) + body


class TableScanTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.game = self.root / "Game"
        (self.game / "Game_Data").mkdir(parents=True)
        self.module = self.game / "GameAssembly.dll"
        self.module.write_bytes(pe([b".text"], b"\x00" * 64 + bytes.fromhex("488B051234567 88B45".replace(" ", "")) + b"\x00" * 64))
        (self.game / "Game.exe").write_bytes(pe([b".text"], b"\x90" * 32 + bytes.fromhex("DEADBEEF01")))
        self.table = self.root / "game.ct"
        self.table.write_text(TABLE, encoding="utf-8")
        found = {"app_id": "10", "name": "Game", "branch": "public", "build_id": 1, "game_directory": str(self.game)}
        patcher = patch("table_scan.steam_library.find_game", return_value=found)
        patcher.start()
        self.addCleanup(patcher.stop)
        table_scan._cache.clear()

    def test_each_entry_reports_whether_its_patterns_are_in_the_game_files(self):
        result = table_scan.scan(str(self.table), "10")
        # A commented-out scan is ignored; a whole-process scan proves nothing.
        self.assertEqual(result["entries"], {"1": "found", "2": "missing", "3": "unchecked", "4": "found"})

    def test_a_packed_module_or_an_unknown_one_is_not_claimed_missing(self):
        self.module.write_bytes(pe([b".text", b".bind"], b"\x00" * 64))
        self.assertEqual(table_scan.scan(str(self.table), "10")["entries"]["2"], "unchecked")
        self.module.unlink()
        table_scan._cache.clear()
        self.assertEqual(table_scan.scan(str(self.table), "10")["entries"]["2"], "unchecked")

    def test_il2cpp_entries_using_the_injected_helper_are_listed_with_the_cpu(self):
        injected = TABLE.replace("<ID>5</ID>", """<ID>6</ID>
      <AssemblerScript>{$lua}
[ENABLE]
LaunchMonoDataCollector()
[DISABLE]</AssemblerScript>
    </CheatEntry>
    <CheatEntry>
      <ID>7</ID>
      <AssemblerScript>define(money,ThingPackage.ChangeMoney)
aobscanregion(stat,ThingPackage:GetThingCount,ThingPackage:GetThingCount+367,49 63 47)</AssemblerScript>
    </CheatEntry>
    <CheatEntry>
      <ID>8</ID>
      <AssemblerScript>define(sleep,kernel32.Sleep)
// LaunchMonoDataCollector()
local r = AddressList:getMemoryRecordByID(1)</AssemblerScript>
    </CheatEntry>
    <CheatEntry>
      <ID>5</ID>""")
        self.table.write_text(injected, encoding="utf-8")
        with patch("table_scan.platform.machine", return_value="aarch64"):
            result = table_scan.scan(str(self.table), "10")
        # A Lua method call, a module export and a commented-out call are not the helper.
        self.assertEqual(result["injection"], ["6", "7"])
        self.assertTrue(result["arm"])
        with patch("table_scan.platform.machine", return_value="x86_64"):
            self.assertFalse(table_scan.arm_device())
        # Only IL2CPP games are pointed out: the helper worked on ARM for Mono games.
        self.module.rename(self.game / "mono-2.0-bdwgc.dll")
        table_scan._cache.clear()
        self.assertEqual(table_scan.scan(str(self.table), "10")["injection"], [])

    def test_patterns_need_enough_fixed_bytes(self):
        self.assertEqual(table_scan.parse_pattern("4? ?? *"), [(0x40, 0xF0), (0, 0), (0, 0)])
        self.assertIsNone(table_scan.parse_pattern("ABC"))
        self.assertIsNone(table_scan.find(b"\x48\x00\x48", table_scan.parse_pattern("48 ?? 48")))
        self.assertTrue(table_scan.find(b"..\x01\x02\x03\x09\x05", table_scan.parse_pattern("01 02 03 ?? 05")))
        self.assertFalse(table_scan.find(b"..\x01\x02\x03\x09\x06", table_scan.parse_pattern("01 02 03 ?? 05")))


if __name__ == "__main__":
    unittest.main()
