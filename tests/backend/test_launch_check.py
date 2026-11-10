"""The launch record: the launch log is taken once, and trainer processes are found in /proc."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import launch_check


class LaunchCheckTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.proc = self.root / "proc"

    def process(self, pid, parent, comm, cmdline, environ=()):
        folder = self.proc / str(pid)
        folder.mkdir(parents=True)
        (folder / "comm").write_text(comm + "\n")
        (folder / "stat").write_text(f"{pid} ({comm}) S {parent} 0 0")
        (folder / "cmdline").write_bytes(b"\0".join(word.encode() for word in cmdline) + b"\0")
        (folder / "environ").write_bytes(b"\0".join(item.encode() for item in environ))

    def test_launch_log_is_read_once(self):
        log = self.root / ".gcm-launch.log"
        line = r"2026-11-10 starter: started Z:\t\训练器.exe as pid 40"
        log.write_bytes(f"{line}\r\n\r\n".encode())
        self.assertEqual(launch_check.take_lines([log, log, self.root / "missing"]), [line])
        self.assertEqual(log.read_bytes(), b"")
        self.assertEqual(launch_check.take_lines([log]), [])

    def test_trainers_are_found_with_their_steam_ids(self):
        self.process(10, 1, "reaper", ["reaper", "SteamLaunch", "AppId=413150", "--", "proton"])
        self.process(20, 10, "Trainer.exe", [r"Z:\trainers\Trainer.exe"],
                     ["SteamAppId=413150", "XAUTHORITY=/run/secret", "HOME=/home/deck"])
        # The starter's watch names the trainer too; it is not a trainer.
        self.process(21, 10, "gcm-start.exe", [r"Z:\t\.gcm-start.exe", "--watch", "20", r"Z:\trainers\Trainer.exe"])
        self.process(30, 1, "Trainer.exe", [r"Z:\other\trainer.exe"])
        found = launch_check.find_processes(["/home/deck/trainers/Trainer.exe"], self.proc)
        self.assertEqual([(item["pid"], item["reaper"]) for item in found], [("20", "413150"), ("30", None)])
        self.assertEqual(found[0]["environment"], {"SteamAppId": "413150", "XAUTHORITY": "/run/secret"})
        described = launch_check._describe(found[0])
        self.assertEqual(described, "trainer.exe pid 20: SteamAppId=413150; reaper AppId=413150")

    def test_a_launcher_that_never_ran_is_reported(self):
        with patch.object(launch_check, "log_files", return_value=[self.root / ".gcm-launch.log"]), \
                patch.object(launch_check, "find_processes", return_value=[]), \
                self.assertLogs(level="WARNING") as logs:
            launch_check.check("413150", ["/t/Trainer.exe"], "GE-Proton11-11")
        self.assertIn("the launcher left no record", logs.output[0])
        self.assertIn("no trainer process runs (trainer.exe)", logs.output[1])


if __name__ == "__main__":
    unittest.main()
