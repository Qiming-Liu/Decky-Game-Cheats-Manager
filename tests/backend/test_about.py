"""The daily release check: how often GitHub is asked and that failures stay silent."""
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
        """`answer`: what GitHub lists, as one version (both newest overall and newest
        release), a (newest, newest release) pair, or an exception."""
        if isinstance(answer, str):
            answer = (answer, answer)
        with patch.object(about, "_fetch", side_effect=answer if isinstance(answer, Exception) else None,
                          return_value=None if isinstance(answer, Exception) else answer) as fetch:
            return about.update(now), fetch.call_count

    def test_asks_github_once_a_day(self):
        self.assertEqual(self.check(0, "1.2.0"), ({"current": "1.0.1", "latest": "1.2.0"}, 1))
        self.assertEqual(self.check(DAY - 1, "1.3.0"), ({"current": "1.0.1", "latest": "1.2.0"}, 0))
        self.assertEqual(self.check(DAY, "1.3.0"), ({"current": "1.0.1", "latest": "1.3.0"}, 1))

    def test_failure_is_silent_keeps_the_last_answer_and_retries_next_day(self):
        self.check(0, "1.2.0")
        self.assertEqual(self.check(7 * DAY, OSError("offline")), ({"current": "1.0.1", "latest": "1.2.0"}, 1))
        self.assertEqual(self.check(7 * DAY + 3600, "1.3.0")[1], 0)
        self.assertEqual(self.check(8 * DAY, "1.3.0"), ({"current": "1.0.1", "latest": "1.3.0"}, 1))

    def test_only_a_newer_version_is_reported(self):
        for tag, latest in (("1.0.1", ""), ("0.9", ""), ("nightly", ""), ("1.0.10", "1.0.10"), ("v1.2", "1.2.0")):
            self.path.unlink(missing_ok=True)
            self.assertEqual(self.check(0, about._version(tag))[0]["latest"], latest, tag)

    def test_test_builds_are_offered_only_to_testers(self):
        for installed, release, offered in (
            ("1.0.4", "v1.0.5-test", False),
            ("1.0.4", "v1.0.4-test", False),
            ("1.0.5-test", "v1.0.5", True),
            ("1.0.4-test", "v1.0.4", True),
            ("1.0.5-test", "v1.0.5-test", False),
            ("1.0.5-test", "v1.0.5-test2", True),
            ("1.0.5-test2", "v1.0.5-test10", True),
            ("1.0.5-test2", "v1.0.5-test", False),
            ("1.0.4-test", "v1.0.5-test", True),
            ("1.0.5-test", "v1.0.4", False),
        ):
            self.assertEqual(about.is_newer(about._version(release), installed), offered, (installed, release))

    def test_a_test_build_is_offered_its_release(self):
        with patch.object(about.decky, "DECKY_PLUGIN_VERSION", "1.0.2-test"):
            self.assertEqual(self.check(0, "1.0.1"), ({"current": "1.0.2-test", "latest": ""}, 1))
            self.path.unlink()
            self.assertEqual(self.check(0, about._version("v1.0.2"))[0]["latest"], "1.0.2")
        # A release never sees a test build, even through the daily check.
        self.path.unlink()
        self.assertEqual(self.check(0, about._version("v1.0.2-test"))[0]["latest"], "")

    def test_a_release_is_offered_the_newest_release_past_newer_test_builds(self):
        self.assertEqual(self.check(0, ("1.0.6-test1", "1.0.5"))[0]["latest"], "1.0.5")
        with patch.object(about.decky, "DECKY_PLUGIN_VERSION", "1.0.5-test2"):
            self.assertEqual(self.check(0, ("1.0.6-test1", "1.0.5"))[0]["latest"], "1.0.6-test1")

    def test_newest_picks_by_version_not_by_list_order(self):
        tags = ["v1.0.5-test12", "v1.0.4", "v1.0.5-test3", "v1.0.10", "nightly", None, "v1.0.9"]
        self.assertEqual(about.newest(tags), ("1.0.10", "1.0.10"))
        self.assertEqual(about.newest(["v1.0.5-test12", "v1.0.4", "v1.0.5-test3"]), ("1.0.5-test12", "1.0.4"))
        self.assertEqual(about.newest([]), ("", ""))

    def test_damaged_state_or_clock_jump_checks_again(self):
        self.path.write_text("not json", encoding="utf-8")
        self.assertEqual(self.check(0, "1.2.0")[1], 1)
        self.assertEqual(self.check(-30 * DAY, "1.2.0")[1], 1)


class TestBuildNoticeTest(unittest.TestCase):
    """The notice shown once after installing a test build, and never for a release."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        patcher = patch.object(about, "NOTICE_PATH", str(Path(temporary.name) / "test_notice.json"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def installed(self, version):
        return patch.object(about.decky, "DECKY_PLUGIN_VERSION", version)

    def test_a_release_never_shows_it(self):
        with self.installed("1.0.5"):
            self.assertEqual(about.test_notice(), "")
            about.acknowledge_test_notice()
            self.assertEqual(about.test_notice(), "")

    def test_each_test_build_shows_it_once(self):
        with self.installed("1.0.5-test"):
            self.assertEqual(about.test_notice(), "1.0.5-test")
            about.acknowledge_test_notice()
            self.assertEqual(about.test_notice(), "")
        with self.installed("1.0.6-test"):
            self.assertEqual(about.test_notice(), "1.0.6-test")


if __name__ == "__main__":
    unittest.main()
