"""Saved custom launch options: presets, validation and persistence."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import custom_options


class CustomOptionsTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "custom_options.json"
        patcher = patch.object(custom_options, "PATH", str(self.path))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_presets_until_first_save_then_only_saved_list(self):
        self.assertEqual([item["id"] for item in custom_options.load()], [item["id"] for item in custom_options.PRESETS])
        saved = custom_options.save([{"id": "user-1", "name": " Overlay ", "definitions": ["MANGOHUD=1"]}])
        self.assertEqual(saved, [{"id": "user-1", "name": "Overlay", "definitions": ["MANGOHUD=1"]}])
        self.assertEqual(custom_options.load(), saved)
        custom_options.save([])
        self.assertEqual(custom_options.load(), [])

    def test_invalid_lists_are_rejected_without_changing_the_file(self):
        custom_options.save([{"id": "keep", "name": "", "detected": True, "definitions": ["-novid"]}])
        for value in (None, [{"id": "../x", "definitions": ["a"]}], [{"id": "a", "definitions": []}],
                      [{"id": "a", "definitions": ["a\nb"]}], [{"id": "a", "definitions": ["x"]}] * 2):
            with self.assertRaises(ValueError):
                custom_options.save(value)
        self.assertEqual(custom_options.load()[0]["id"], "keep")
        self.assertTrue(custom_options.load()[0]["detected"])

    def test_damaged_file_falls_back_to_presets(self):
        self.path.write_text('{"options": "broken"}', encoding="utf-8")
        self.assertEqual(len(custom_options.load()), len(custom_options.PRESETS))
