"""SteamOS persistence for GCM device enrollment; no Windows APIs."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import uuid
from pathlib import Path

import decky

_identity_lock = threading.Lock()


def credential_path():
    return str(Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "auth" / "credential.json")


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


def machine_hash():
    # Stable per installation. No raw hardware identifier leaves the device.
    path = Path(credential_path()).with_name("identity.json")
    with _identity_lock:
        try:
            identity = json.loads(path.read_text(encoding="utf-8"))["id"]
            uuid.UUID(identity)
        except (OSError, ValueError, KeyError, TypeError):
            identity = uuid.uuid4().hex
            _write_private(path, {"id": identity})
    return hashlib.sha256(f"decky-gcm:{identity}".encode()).hexdigest()[:32]


def store_credential(credential):
    _write_private(credential_path(), credential)


def read_credential():
    try:
        path = Path(credential_path())
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, dict) and all(isinstance(value.get(k), str) and value[k] for k in ("client_id", "client_secret")):
            os.chmod(path, 0o600)
            return value
    except (OSError, ValueError):
        pass
    return None
