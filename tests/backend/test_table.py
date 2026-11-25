"""Reading table files and the file bridge to Cheat Engine."""
from __future__ import annotations

import json
import threading
from unittest.mock import patch
import tempfile
import unittest
from pathlib import Path

import ct_bridge
import library_storage
import table_trust
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

    def test_reports_what_can_run_code(self):
        # The base table's only script is an empty template.
        self.assertEqual(trainer_table.read(str(self.table))["code"], [])
        end = "</CheatTable>"
        for extra, code in (
            ("<LuaScript>\n  \n</LuaScript><Forms/><Files/>", []),
            ("<LuaScript>os.execute('x')</LuaScript>", ["lua"]),
            ('<Forms><UDF1 Class="TCEForm"/></Forms>', ["forms"]),
            ('<Files><TableFile><Name>a.dll</Name><Data>AA==</Data></TableFile></Files>', ["files"]),
        ):
            with self.subTest(extra=extra):
                self.table.write_text(TABLE.replace(end, extra + end), encoding="utf-8")
                self.assertEqual(trainer_table.read(str(self.table))["code"], code)
        self.table.write_text(TABLE.replace("[ENABLE]\n[DISABLE]", "[ENABLE]\ndb 90\n[DISABLE]"), encoding="utf-8")
        self.assertEqual(trainer_table.read(str(self.table))["code"], ["assembler"])
        self.table.write_text(TABLE.replace("[ENABLE]\n[DISABLE]", "[ENABLE]\n{$LUA}\nprint(1)\n[DISABLE]"), encoding="utf-8")
        self.assertEqual(trainer_table.read(str(self.table))["code"], ["assembler", "lua"])

    def test_a_local_table_that_can_run_code_is_confirmed_by_file_name(self):
        trust = self.root / "trust.json"
        with patch("table_trust.TRUST_PATH", str(trust)):
            # A local table that can run nothing needs no confirmation; one that can does.
            self.assertEqual(table_trust.status(str(self.table))["state"], "ok")
            lua = TABLE.replace("</CheatTable>", "<LuaScript>print(1)</LuaScript></CheatTable>")
            self.table.write_text(lua, encoding="utf-8")
            self.assertEqual(table_trust.status(str(self.table)), {"state": "unconfirmed", "code": ["lua"]})
            table_trust.confirm(str(self.table))
            self.assertEqual(table_trust.status(str(self.table))["state"], "ok")
            # Only the name counts: new contents, or the same name elsewhere, stay confirmed.
            self.table.write_text(lua.replace("print(1)", "print(2)"), encoding="utf-8")
            self.assertEqual(table_trust.status(str(self.table))["state"], "ok")
            (self.root / "other").mkdir()
            elsewhere = self.root / "other" / self.table.name
            elsewhere.write_text(lua, encoding="utf-8")
            self.assertEqual(table_trust.status(str(elsewhere))["state"], "ok")
            renamed = self.root / "renamed.ct"
            renamed.write_text(lua, encoding="utf-8")
            self.assertEqual(table_trust.status(str(renamed))["state"], "unconfirmed")
            # Names from an earlier version's path-to-hash records still count.
            library_storage.write_json(trust, {str(renamed): "0" * 64})
            self.assertEqual(table_trust.status(str(renamed))["state"], "ok")
            # A table a download holds needs no confirmation.
            folder = self.root / "Game (1)" / "Trainer [abc]"
            (folder / "sub").mkdir(parents=True)
            downloaded = folder / "sub" / "t.ct"
            downloaded.write_text(lua, encoding="utf-8")
            library_storage.write_json(folder / library_storage.METADATA, {"content_hashes": {"sub/t.ct": "x"}})
            self.assertEqual(table_trust.status(str(downloaded))["state"], "ok")
            with self.assertRaises((OSError, ValueError)):
                table_trust.status(str(self.root / "missing.ct"))

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
        # An earlier session's state, attached but no longer written, is not taken as attached.
        stale = {"pid": 436, "processes": [], "age": ct_bridge.STATE_FRESH + 30}
        replies = iter([None, stale, listed, listed, listed, {"pid": 352}])
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

    def _attach(self, app_id, replies, now):
        """Runs the attach loop on canned states, the clock at `now` seconds after it begins."""
        proc = self.root / "proc"
        proc.mkdir(exist_ok=True)
        sent = []
        replies = iter(replies)
        calls = []

        def clock():
            # The first reading is when attaching begins.
            calls.append(None)
            return 0 if len(calls) == 1 else now
        with patch.object(ct_bridge, "_stop", threading.Event()), patch.object(ct_bridge, "ATTACH_POLL", 0), \
                patch.object(ct_bridge, "send", lambda table, command: sent.append(command)), \
                patch.object(ct_bridge, "state", lambda table: next(replies)), \
                patch.object(ct_bridge.time, "monotonic", clock), \
                patch.object(ct_bridge.game_window, "_root_properties", lambda display: {}):
            ct_bridge._attach_when_ready(str(self.table), app_id, [], proc)
        return sent

    def test_attach_waits_for_the_process_the_table_names_over_a_launcher(self):
        import attach_memory
        self.table.write_text(TABLE.replace("<Address>12345</Address>", '<Address>"GTA5.exe"+1A2B</Address>'),
                              encoding="utf-8")
        self.assertEqual(attach_memory.table_names(str(self.table)), ["GTA5.exe"])
        launcher = {"pid": 0, "processes": [{"pid": 30, "name": "PlayGTAV.exe", "window": True}]}
        both = {"pid": 0, "processes": launcher["processes"] + [{"pid": 50, "name": "GTA5.exe", "window": False}]}
        # The launcher alone leads, but within CLUE_ALONE nothing is sent for it.
        sent = self._attach("901", [launcher] * 5 + [both, both, {"pid": 50, "processes": both["processes"]}],
                            1)
        self.assertEqual(sent, [{"attach": 50}])

    def test_attach_falls_back_then_switches_to_the_clue(self):
        self.table.write_text(TABLE.replace("<Address>12345</Address>", '<Address>"GTA5.exe"+1A2B</Address>'),
                              encoding="utf-8")
        launcher = {"pid": 0, "processes": [{"pid": 30, "name": "PlayGTAV.exe", "window": True}]}
        on_launcher = {"pid": 30, "processes": launcher["processes"]}
        both = {"pid": 30, "processes": launcher["processes"] + [{"pid": 50, "name": "GTA5.exe", "window": False}]}
        late = ct_bridge.CLUE_ALONE + 1
        # The clue does not show within CLUE_ALONE: the ranked pick goes first,
        # and the clued process replaces it once it appears.
        sent = self._attach("902", [launcher, launcher, on_launcher, both, both, {**both, "pid": 50}], late)
        self.assertEqual(sent, [{"attach": 30}, {"attach": 50}])

    def test_the_players_pick_is_remembered_and_comes_first(self):
        import asyncio
        import attach_memory
        import rpc_game
        processes = [{"pid": 30, "name": "Launcher.exe", "window": True}, {"pid": 50, "name": "Game.exe", "window": False}]
        ct_bridge.start(str(self.table))
        (self.root / ct_bridge.RUNTIME / ct_bridge.STATE).write_text(
            json.dumps({"pid": 30, "processes": processes, "entries": []}), encoding="utf-8")
        # The name comes from Cheat Engine's own list, not from what the panel sent.
        result = asyncio.run(rpc_game.GameRpc().attach_table(str(self.table), 50, "made-up.exe", "903"))
        self.assertTrue(result["success"])
        self.assertEqual(attach_memory.remembered("903"), "Game.exe")
        self.assertFalse(attach_memory.remember("../x", "Game.exe"))
        self.assertFalse(attach_memory.remember("903", "C:\\Games\\Game.exe"))
        # Next session: the remembered process is attached at once, the launcher is not.
        listed = {"pid": 0, "processes": processes}
        sent = self._attach("903", [listed, listed, {"pid": 50, "processes": processes}], 1)
        self.assertEqual(sent, [{"attach": 50}])

    def test_a_game_launch_drops_the_last_sessions_bridge_files(self):
        import asyncio
        import rpc_game
        # A session that ended without the panel: an attach to a process ID that means nothing now.
        runtime = self.root / ct_bridge.RUNTIME
        runtime.mkdir()
        (runtime / ct_bridge.COMMANDS).write_text('{"n": 5, "attach": 372}\n', encoding="utf-8")
        (runtime / ct_bridge.STATE).write_text(json.dumps({"pid": 372, "entries": []}), encoding="utf-8")
        with patch.object(rpc_game.launch_check, "watch", lambda *args: None), \
                patch.object(rpc_game.plugin_settings, "load", lambda: {"auto_attach": False}), \
                patch.object(rpc_game.ce_watch, "watch", lambda *args: None):
            result = asyncio.run(rpc_game.GameRpc().check_trainer_launch("42", [str(self.table)]))
        self.assertTrue(result["success"])
        self.assertEqual((runtime / ct_bridge.COMMANDS).read_text(encoding="utf-8"), "")
        self.assertIsNone(ct_bridge.state(str(self.table)))


if __name__ == "__main__":
    unittest.main()
