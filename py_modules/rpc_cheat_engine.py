"""RPC methods for the shared Cheat Engine."""
from __future__ import annotations

import asyncio

import cheat_engine
import decky
import search_cache
import trainer_download
import trainer_search
from rpc_common import user_action


class CheatEngineRpc:
    async def get_cheat_engine(self):
        try:
            return await asyncio.to_thread(cheat_engine.status)
        except (OSError, ValueError) as error:
            # A library that cannot be read has no Cheat Engine to offer; the
            # pages still work for everything that needs none.
            decky.logger.warning("Could not read the Cheat Engine status: %s", error)
            return cheat_engine.missing()

    @user_action(lambda action, _value="": f"Cheat Engine: {action}")
    async def manage_cheat_engine(self, action: str, _value: str = ""):
        """Downloads, reinstalls, removes or repairs the bridge for the shared Cheat Engine."""
        try:
            if action == "download" and (await asyncio.to_thread(cheat_engine.status))["installed"]:
                # One copy serves every game: a second request uses the one that is there.
                return {"success": True, "cheat_engine": await asyncio.to_thread(cheat_engine.status)}
            if action in ("download", "reinstall"):
                entry = await asyncio.to_thread(trainer_search.cheat_engine_entry)
                if entry is None:
                    return {"success": False, "error": "cheat_engine_unlisted"}
                search_cache.RESULTS[entry["id"]] = entry
                job = await trainer_download.start(entry, app_id="")
                return {"success": True, "job": job}
            if action == "delete":
                await asyncio.to_thread(cheat_engine.remove)
            elif action == "bridge":
                if not await asyncio.to_thread(cheat_engine.install_bridge):
                    raise ValueError("cheat_engine_missing")
            else:
                raise ValueError("Unknown Cheat Engine action.")
            return {"success": True, "cheat_engine": await asyncio.to_thread(cheat_engine.status)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}
