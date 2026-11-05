"""Private local state for the GCM data-source configuration on SteamOS.

The configuration decides what it stores; this module only keeps it under Decky's
settings directory with owner-only permissions.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import uuid
from pathlib import Path

import decky

_lock = threading.Lock()


def state_path():
    return str(Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auth" / "state.json")


def _write_private(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=".gcm-", dir=path.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install_id():
    """A stable random identifier for this installation; never derived from hardware."""
    path = Path(state_path()).with_name("identity.json")
    with _lock:
        try:
            identity = json.loads(path.read_text(encoding="utf-8"))["id"]
            uuid.UUID(identity)
        except (OSError, ValueError, KeyError, TypeError):
            identity = uuid.uuid4().hex
            _write_private(path, {"id": identity})
    return hashlib.sha256(f"decky-gcm:{identity}".encode()).hexdigest()[:32]


def save_state(value):
    _write_private(state_path(), value)


def load_state():
    try:
        path = Path(state_path())
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, dict) and value:
            os.chmod(path, 0o600)
            return value
    except (OSError, ValueError):
        pass
    return None


def clear_state():
    try:
        os.remove(state_path())
    except OSError:
        pass
