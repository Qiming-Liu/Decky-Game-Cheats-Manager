"""Values and settings kept as JSON in `py_modules/data`, apart from the code."""
from __future__ import annotations

import functools
import json
import os

import decky

DIRECTORY = os.path.join(decky.DECKY_PLUGIN_DIR, "py_modules", "data")


@functools.cache
def load(name: str) -> dict:
    """The contents of `data/<name>.json`. A missing or damaged file is a broken installation."""
    with open(os.path.join(DIRECTORY, f"{name}.json"), encoding="utf-8") as source:
        return json.load(source)
