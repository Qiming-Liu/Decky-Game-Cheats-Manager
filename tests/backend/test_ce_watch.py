"""Finding the game's Cheat Engine and copying its bridge log."""
from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path

import ce_watch


class CheatEngineWatchTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_cheat_engine_folder_comes_from_its_windows_command_line(self):
        proc = self.root / "proc"
        for pid, line in (("10", r"Z:\home\deck\Games\P5S\P5S.exe"),
                          ("11", r"Z:\home\deck\DeckyGCM\Cheat Engine 7.6 [ab12]\cheatengine-x86_64-SSE4-AVX2.exe"
                                 "\0" r"Z:\home\deck\Downloads\P5S.CT")):
            (proc / pid).mkdir(parents=True)
            (proc / pid / "cmdline").write_bytes(line.encode() + b"\0")
        self.assertEqual(ce_watch.cheat_engine(["10", "11"], proc),
                         ("11", Path("/home/deck/DeckyGCM/Cheat Engine 7.6 [ab12]")))
        self.assertEqual(ce_watch.cheat_engine(["10"], proc), ("", None))

    def test_bridge_log_is_copied_from_this_start_on(self):
        log = self.root / "decky_gcm.log"
        log.write_bytes(b"2026-11-22 10:00:00 ---- loaded in Cheat Engine 7.6\n2026-11-22 10:00:01 old start\n")
        started = time.time()
        os.utime(log, (started - 60, started - 60))
        # A start from before this game is not copied again.
        tail = ce_watch._Tail(log, started)
        self.assertEqual(tail.lines(), [])
        with open(log, "ab") as out:
            out.write(b"2026-11-22 10:05:00 ---- loaded in Cheat Engine 7.6\n")
            out.write('2026-11-22 10:05:01 windows: TMainForm "Cheat Engine"; TMessageForm "信息"\n'.encode("gbk"))
            out.write(b"2026-11-22 10:05:02 partial")
        # File times come from a coarser clock than time.time() and can lag behind it.
        os.utime(log, (started + 1, started + 1))
        self.assertEqual(tail.lines(), ["2026-11-22 10:05:00 ---- loaded in Cheat Engine 7.6",
                                        '2026-11-22 10:05:01 windows: TMainForm "Cheat Engine"; TMessageForm "信息"'])
        # A watch that starts after Cheat Engine wrote its first lines still gets them.
        late = ce_watch._Tail(log, started)
        self.assertEqual(late.lines()[0], "2026-11-22 10:05:00 ---- loaded in Cheat Engine 7.6")


if __name__ == "__main__":
    unittest.main()
