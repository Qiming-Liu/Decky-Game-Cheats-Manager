"""The weekly release check: how often GitLab is asked and that failures stay silent."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import about

DAY = 24 * 3600


class UpdateCheckTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "update_check.json"
        for target, value in ((about, ("PATH", str(self.path))), (about.decky, ("DECKY_PLUGIN_VERSION", "1.0.1"))):
            patcher = patch.object(target, *value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def check(self, now, answer):
        with patch.object(about, "_fetch", side_effect=answer if isinstance(answer, Exception) else None,
                          return_value=None if isinstance(answer, Exception) else answer) as fetch:
            return about.update(now), fetch.call_count

    def test_asks_gitlab_once_a_week(self):
        self.assertEqual(self.check(0, "1.2.0"), ({"current": "1.0.1", "latest": "1.2.0"}, 1))
        self.assertEqual(self.check(6 * DAY, "1.3.0"), ({"current": "1.0.1", "latest": "1.2.0"}, 0))
        self.assertEqual(self.check(7 * DAY, "1.3.0"), ({"current": "1.0.1", "latest": "1.3.0"}, 1))

    def test_failure_is_silent_keeps_the_last_answer_and_retries_next_day(self):
        self.check(0, "1.2.0")
        self.assertEqual(self.check(7 * DAY, OSError("offline")), ({"current": "1.0.1", "latest": "1.2.0"}, 1))
        self.assertEqual(self.check(7 * DAY + 3600, "1.3.0")[1], 0)
        self.assertEqual(self.check(8 * DAY, "1.3.0"), ({"current": "1.0.1", "latest": "1.3.0"}, 1))

    def test_only_a_newer_version_is_reported(self):
        for tag, latest in (("1.0.1", ""), ("0.9", ""), ("nightly", ""), ("1.0.10", "1.0.10"), ("v1.2", "1.2.0")):
            self.path.unlink(missing_ok=True)
            self.assertEqual(self.check(0, about._version(tag))[0]["latest"], latest, tag)

    def test_a_test_build_is_offered_its_release(self):
        with patch.object(about.decky, "DECKY_PLUGIN_VERSION", "1.0.2-test"):
            self.assertEqual(self.check(0, "1.0.1"), ({"current": "1.0.2-test", "latest": ""}, 1))
            self.path.unlink()
            self.assertEqual(self.check(0, about._version("v1.0.2"))[0]["latest"], "1.0.2")
        self.assertFalse(about.is_newer("1.0.2-test", "1.0.2"))

    def test_damaged_state_or_clock_jump_checks_again(self):
        self.path.write_text("not json", encoding="utf-8")
        self.assertEqual(self.check(0, "1.2.0")[1], 1)
        self.assertEqual(self.check(-30 * DAY, "1.2.0")[1], 1)


if __name__ == "__main__":
    unittest.main()
