"""RPC methods for the plugin's log."""
from __future__ import annotations

import asyncio

import decky
import plugin_log
import proton_log
import rpc_common
from rpc_common import user_action


class LogRpc:
    async def get_log(self, limit: int = 500):
        return await asyncio.to_thread(rpc_common.LOG.read, limit)

    @user_action(lambda: "Clear the log")
    async def clear_log(self):
        await asyncio.to_thread(rpc_common.LOG.clear)

    async def get_log_export_directory(self):
        return await asyncio.to_thread(rpc_common.LOG.export_directory, decky.DECKY_USER_HOME)

    @user_action(lambda directory="": f"Export the log to {directory or '~/Downloads'}")
    async def export_log(self, directory: str = ""):
        def export():
            # Proton's logs go along as they are: they hold what made a game or trainer crash.
            appendix = proton_log.sections(decky.DECKY_USER_HOME)
            return rpc_common.LOG.export(decky.DECKY_USER_HOME, directory or None, appendix)
        return await asyncio.to_thread(export)

    async def get_proton_log_owned(self, app_id: str):
        """True when the plugin wrote the game's PROTON_LOG and may take it out again."""
        return await asyncio.to_thread(proton_log.owned, app_id)

    async def set_proton_log_owned(self, app_id: str, owned: bool):
        try:
            await asyncio.to_thread(proton_log.set_owned, app_id, owned)
            return {"success": True}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def log_frontend(self, level: str, message: str):
        plugin_log.log_frontend(decky.logger, level, message)
