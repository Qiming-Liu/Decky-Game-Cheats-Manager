"""Fetch a complete release catalog; keep CI device credentials out of the package."""
from __future__ import annotations

import logging
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py_modules"))


def main():
    with tempfile.TemporaryDirectory(prefix="gcm-release-") as temporary:
        sys.modules["decky"] = SimpleNamespace(
            DECKY_PLUGIN_DIR=str(ROOT),
            DECKY_PLUGIN_SETTINGS_DIR=temporary,
            logger=logging.getLogger("gcm-release"),
        )
        import gcm_bridge
        gcm_bridge.ensure_paths()
        import trainer_db

        result = trainer_db.refresh()
        if not result["success"]:
            # Print filenames only, never server responses or signed URLs.
            raise SystemExit("Release catalog fetch failed: " + ", ".join(result["errors"]))
        destination = ROOT / "db"
        destination.mkdir(exist_ok=True)
        for name in (*trainer_db.DATABASE_FILES, trainer_db.STATE_FILE):
            shutil.copyfile(Path(trainer_db.DATABASE_PATH) / name, destination / name)
    print("Release catalog fetched and validated.")


if __name__ == "__main__":
    main()
