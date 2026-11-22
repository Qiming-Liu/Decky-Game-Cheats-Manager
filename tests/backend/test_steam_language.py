"""Steam's interface language, which picks Cheat Engine's."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import steam_library

REGISTRY = """"Registry"
{
\t"HKCU"
\t{
\t\t"Software"
\t\t{
\t\t\t"Valve"
\t\t\t{
\t\t\t\t"Steam"
\t\t\t\t{
\t\t\t\t\t"language"\t\t"tchinese"
\t\t\t\t}
\t\t\t}
\t\t}
\t}
}
"""


class SteamLanguageTest(unittest.TestCase):
    def test_language_comes_from_steams_registry_file(self):
        with tempfile.TemporaryDirectory() as home, patch.object(steam_library.decky, "DECKY_USER_HOME", home):
            self.assertEqual(steam_library.language(), "")
            (Path(home) / ".steam").mkdir()
            (Path(home) / ".steam" / "registry.vdf").write_text(REGISTRY, encoding="utf-8")
            self.assertEqual(steam_library.language(), "tchinese")


if __name__ == "__main__":
    unittest.main()
