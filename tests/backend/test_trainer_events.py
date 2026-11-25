"""The events the starter writes: read back as written, scoped to the running game's session."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import trainer_events


class TrainerEventsTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.file = Path(temporary.name) / ".gcm-events.log"
        self.addCleanup(trainer_events._sessions.clear)

    def write(self, *lines):
        with open(self.file, "a", encoding="utf-8", newline="") as handle:
            handle.write("".join(line + "\n" for line in lines))

    def test_a_message_box_reads_as_the_program_wrote_it(self):
        # Title, then text with a tab, a Windows path and a second line, escaped by the starter.
        self.write("1000\t292\tdialog\t训练器.exe\t错误提示\\n没有找到地址\\t0x0\\nZ:\\\\t\\\\a.exe", "garbage line",
                   "1001\t292\tunknown\tx.exe\t")
        events = trainer_events.read([self.file, self.file.with_name("missing")], 0)
        self.assertEqual(events, [{"time": 1000, "pid": 292, "kind": "dialog", "program": "训练器.exe",
                                   "text": "错误提示\n没有找到地址\t0x0\nZ:\\t\\a.exe"}])

    def test_only_the_running_games_session_is_shown(self):
        self.write("100\t40\tstarted\told.exe\t", "1000\t50\tstarted\tTrainer.exe\t", "1031\t50\tnowindow\tTrainer.exe\t30")
        trainer_events.begin("413150", ["/t/Trainer.exe"], now=1000 + trainer_events.SESSION_MARGIN)
        with patch.object(trainer_events.launch_check, "find_processes", return_value=[{"name": "trainer.exe"}]) as find:
            result = trainer_events.status("413150", [self.file])
        self.assertTrue(result["known"])
        self.assertEqual([event["kind"] for event in result["events"]], ["started", "nowindow"])
        self.assertEqual(result["running"], ["trainer.exe"])
        # Programs a trainer started itself are looked for as well.
        self.assertIn("Trainer.exe", find.call_args.args[0])
        self.assertFalse(trainer_events.status("620", [self.file])["known"])

    def test_without_an_app_id_the_game_whose_trainers_run_is_found(self):
        trainer_events.begin("1", ["/t/a.exe"], now=10)
        trainer_events.begin("2", ["/t/b.exe"], now=20)

        def processes(names, proc):
            return [{"name": "a.exe"}] if "/t/a.exe" in names else []
        with patch.object(trainer_events.launch_check, "find_processes", side_effect=processes):
            self.assertEqual(trainer_events.status("", [self.file])["app_id"], "1")

    def test_problems_go_to_the_plugin_log_once(self):
        self.write("1000\t50\texit\tTrainer.exe\t0xc0000005 12", "1000\t50\twindow\tTrainer.exe\t3 Main")
        trainer_events.begin("413150", ["/t/Trainer.exe"], now=1000)
        with patch.object(trainer_events.launch_check, "find_processes", return_value=[]), \
                self.assertLogs(level="INFO") as logs:
            trainer_events.status("413150", [self.file])
            trainer_events.status("413150", [self.file])
        self.assertEqual(len(logs.output), 1)
        self.assertIn("Trainer.exe (pid 50) exit: 0xc0000005 12", logs.output[0])


if __name__ == "__main__":
    unittest.main()
