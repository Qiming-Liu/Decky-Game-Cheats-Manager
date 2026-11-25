"""What every group of RPC methods shares: the log and how user actions are written to it."""
from __future__ import annotations

import functools

import decky
import plugin_log

# One persistent log for everything the plugin logs through decky.logger.
LOG = plugin_log.PluginLog(decky.DECKY_PLUGIN_LOG_DIR, "deckygcm")

# The log records what the user did, one line per action with its outcome.
user_action = functools.partial(plugin_log.user_action, decky.logger)


def for_app(app_id: str, game_name: str = "") -> str:
    if not app_id:
        return ""
    return f" for app {app_id}" + (f" ({game_name})" if game_name else "")
