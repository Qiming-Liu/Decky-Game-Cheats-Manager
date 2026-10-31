"""The small platform boundary used by generated upstream GCM modules."""
from __future__ import annotations

import os
import threading

import decky

DATABASE_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "db")
SEARCH_LOCK = threading.RLock()
settings = {
    "language": "en_US", "enSearchResults": False, "sortByOrigin": False,
    "enableFling": True, "enableXiaoXing": True, "enableCT": True, "enableGCM": True,
}


def quiet(*args, **kwargs):
    # Upstream diagnostics can include signed URLs and registration responses.
    # Public adapters surface structured, sanitized errors instead.
    pass


def tr(message):
    return message


def is_chinese(text):
    import zhon.cedict
    return any(char in zhon.cedict.all for char in text)


class Signal:
    def __init__(self, callback=None):
        self.callback = callback
        self.events = []

    def emit(self, *args):
        self.events.append(args)
        if self.callback:
            self.callback(*args)


class BackendWorker:
    """Synchronous event callbacks, with no Qt application/thread dependency."""
    def __init__(self, parent=None):
        self.message = Signal()
        self.messageBox = Signal()
        self.progress = Signal()
        self.finished = Signal()


class AuthProxy:
    def __getattr__(self, name):
        from data_source import client
        return getattr(client(), name)


auth = AuthProxy()


def __getattr__(name):
    if name in {"APP_VERSION", "API_TIMEOUT", "RETRY_STATUSES"}:
        from _gcm_core import config
        return getattr(config, name)
    raise AttributeError(name)
