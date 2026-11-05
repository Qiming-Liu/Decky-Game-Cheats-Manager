"""Load the build-generated GCM core without global config/PyQt shims."""
from __future__ import annotations

import os
import sys

import decky

PLUGIN_DIR = decky.DECKY_PLUGIN_DIR
VENDOR_DIR = os.path.join(PLUGIN_DIR, "py_modules", "_vendor")
DATABASE_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "db")


def ensure_paths():
    if os.path.isdir(VENDOR_DIR) and VENDOR_DIR not in sys.path:
        sys.path.insert(0, VENDOR_DIR)


def load_search_index():
    ensure_paths()
    os.makedirs(DATABASE_PATH, exist_ok=True)
    try:
        from _gcm_core import search_index
    except ModuleNotFoundError as error:
        if error.name == "_gcm_core":
            raise RuntimeError("GCM core missing; run scripts/build_gcm_core.py before starting the plugin") from None
        raise
    return search_index


def is_chinese(text):
    from gcm_runtime import is_chinese as detect
    return detect(text)
