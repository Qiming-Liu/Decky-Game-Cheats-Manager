"""Both sides of the RPC contract name the same methods."""
from __future__ import annotations

import inspect
import re
import unittest
from pathlib import Path

import main

SOURCES = Path(__file__).resolve().parents[2] / "src"


class RpcSurfaceTest(unittest.TestCase):
    def test_every_method_the_frontend_calls_exists(self):
        called = set()
        for path in list(SOURCES.rglob("*.ts")) + list(SOURCES.rglob("*.tsx")):
            text = path.read_text(encoding="utf-8")
            if "callable" in text:
                # The method name is the one string argument after the type parameters.
                called.update(re.findall(r'>\(\s*"(\w+)"\s*\)', text))
        self.assertGreater(len(called), 20)
        missing = sorted(name for name in called if not inspect.iscoroutinefunction(getattr(main.Plugin, name, None)))
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
