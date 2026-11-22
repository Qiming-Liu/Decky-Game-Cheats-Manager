"""Fetch a complete release catalog; keep CI-only local state out of the package."""
from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py_modules"))
MACHINE_ID_VARIABLE = "GCM_BUILD_MACHINE_ID"


def _build_machine_id():
    """Machine ID for hosts without /etc/machine-id (Windows), from the environment or ignored .env."""
    value = os.environ.get(MACHINE_ID_VARIABLE, "").strip()
    env_file = ROOT / ".env"
    if not value and env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, _, rest = line.partition("=")
            if key.strip() == MACHINE_ID_VARIABLE:
                value = rest.strip().strip("'\"")
    return value


def _use_build_machine_id(temporary):
    value = _build_machine_id()
    if not value:
        return
    path = Path(temporary) / "machine-id"
    path.write_text(value + "\n", encoding="ascii")
    import gcm_auth_platform
    gcm_auth_platform.MACHINE_ID_PATHS = (str(path),)


def main():
    with tempfile.TemporaryDirectory(prefix="gcm-release-") as temporary:
        sys.modules["decky"] = SimpleNamespace(
            DECKY_PLUGIN_DIR=str(ROOT),
            DECKY_PLUGIN_SETTINGS_DIR=temporary,
            DECKY_PLUGIN_VERSION=json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"],
            logger=logging.getLogger("gcm-release"),
        )
        import gcm_bridge
        gcm_bridge.ensure_paths()
        _use_build_machine_id(temporary)
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
