"""RPC methods for the trainer database: refreshing it, searching it and downloading from it."""
from __future__ import annotations

import asyncio

import search_cache
import steam_library
import trainer_db
import trainer_download
import trainer_search
from library_layout import is_app_id
from rpc_common import for_app, user_action


class CatalogRpc:
    _database_task = None
    _database_force = False

    async def _refresh_database(self, force):
        if force and self._database_task is not None and not self._database_task.done() and not self._database_force:
            await asyncio.shield(self._database_task)
            return await self._refresh_database(True)
        if self._database_task is None or self._database_task.done():
            self._database_force = force
            self._database_task = asyncio.create_task(asyncio.to_thread(trainer_db.refresh, force))
        return await asyncio.shield(self._database_task)

    _last_results = search_cache.RESULTS

    async def get_database_status(self):
        return trainer_db.status()

    @user_action(lambda: "Refresh the trainer database")
    async def refresh_database(self):
        result = await self._refresh_database(True)
        if result.get("errors"):
            # Only the file names: the error texts may name download addresses.
            return {**result, "message": "could not update " + ", ".join(result["errors"])}
        return result

    async def check_database_update(self):
        return await self._refresh_database(False)

    async def search_trainers(self, keyword: str, lang: str = "en"):
        try:
            results = await asyncio.to_thread(trainer_search.search, keyword, "zh" if lang == "zh" else "en")
        except trainer_search.SearchError as e:
            return {"success": False, "error": str(e), "results": []}
        search_cache.remember(results)
        return {
            "success": True,
            "results": [
                {k: t.get(k, "") for k in ("id", "trainer_name", "game_name", "origin", "version", "author", "table")}
                for t in results
            ],
        }

    @user_action(lambda trainer_id, app_id="", *_, **__: 'Start downloading trainer "%s"%s' % (
        search_cache.RESULTS.get(trainer_id, {}).get("trainer_name", trainer_id), for_app(app_id)))
    async def download_trainer(self, trainer_id: str, app_id: str = "", expected_directory: str = "",
                               expected_version: str | None = None, game_name: str = ""):
        if app_id and not is_app_id(app_id):
            return {"success": False, "error": "invalid_app_id"}
        trainer = search_cache.RESULTS.get(trainer_id)
        if trainer is None:
            return {"success": False, "error": "unknown_trainer"}
        if trainer_search.is_cheat_engine(trainer):
            # Shared by every game: it is installed beside the game folders, wherever it was found.
            app_id = ""
        if expected_version is not None and trainer.get("version", "") != expected_version:
            return {"success": False, "error": "unknown_trainer"}
        try:
            # The game folder is named after the game: Steam's own name for an
            # installed game, otherwise the one the page shows (non-Steam shortcuts).
            game = await asyncio.to_thread(steam_library.find_game, app_id) if app_id else None
            job = await trainer_download.start(trainer, app_id=app_id, expected_directory=expected_directory,
                                               game_name=game["name"] if game else game_name)
            return {"success": True, "job": job}
        except ValueError as error:
            return {"success": False, "error": str(error)}

    async def get_downloads(self):
        # Polled by the UI while a download runs — deliberately not logged.
        return await asyncio.to_thread(trainer_download.jobs)
