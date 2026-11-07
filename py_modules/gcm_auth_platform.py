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
from pathlib import Path

import decky

_lock = threading.Lock()
# systemd's machine ID, generated on first boot and readable by every user.
MACHINE_ID_PATHS = ("/etc/machine-id", "/var/lib/dbus/machine-id")
# Files earlier releases kept: states tied to a random identity, and that identity.
LEGACY_FILES = ("credential.json", "state.json", "identity.json")


def state_path():
    return str(Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auth" / "device-state.json")


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


def device_hasher(prefix):
    """Return a function giving a stable, non-reversible identifier for this device.

    It is derived from the machine ID, so it survives reinstalling the plugin, and is
    never random. The configuration chooses the prefix through the binding.
    """
    def device_hash():
        for path in MACHINE_ID_PATHS:
            try:
                machine_id = Path(path).read_text(encoding="ascii").strip()
            except (OSError, UnicodeDecodeError):
                continue
            if machine_id:
                return hashlib.sha256(f"{prefix}{machine_id}".encode()).hexdigest()[:32]
        raise OSError("No machine ID available for this device")
    return device_hash


def _forget_legacy():
    """Drop state from earlier releases once, so this release registers afresh."""
    for name in LEGACY_FILES:
        try:
            os.remove(Path(state_path()).with_name(name))
        except OSError:
            pass


def save_state(value):
    _write_private(state_path(), value)


def load_state():
    with _lock:
        _forget_legacy()
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
