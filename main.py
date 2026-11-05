from __future__ import annotations

import asyncio
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "py_modules"))

import gcm_bridge

gcm_bridge.ensure_paths()

import action_log  # noqa: E402
import decky  # noqa: E402
import trainer_db  # noqa: E402
import trainer_download  # noqa: E402
import trainer_search  # noqa: E402
import trainer_library  # noqa: E402
import steam_library  # noqa: E402


class Plugin:
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

    # A bounded cache shared by both panels: searching another game must not
    # invalidate the first panel's download buttons. Only cached IDs are accepted.
    _last_results: dict[str, dict] = {}

    @action_log.log_call
    async def get_database_status(self):
        return trainer_db.status()

    @action_log.log_call
    async def refresh_database(self):
        return await self._refresh_database(True)

    async def check_database_update(self):
        return await self._refresh_database(False)

    async def cleanup_trash(self):
        await asyncio.to_thread(trainer_library.cleanup_trash)

    @action_log.log_call
    async def search_trainers(self, keyword: str, lang: str = "en"):
        try:
            results = await asyncio.to_thread(trainer_search.search, keyword, "zh" if lang == "zh" else "en")
        except trainer_search.SearchError as e:
            return {"success": False, "error": str(e), "results": []}
        Plugin._last_results.update({t["id"]: t for t in results})
        while len(Plugin._last_results) > 2000:
            del Plugin._last_results[next(iter(Plugin._last_results))]
        return {
            "success": True,
            "results": [
                {k: t[k] for k in ("id", "trainer_name", "game_name", "origin", "version")}
                for t in results
            ],
        }

    @action_log.log_call
    async def download_trainer(self, trainer_id: str, app_id: str = "", expected_directory: str = "",
                               expected_version: str | None = None):
        if app_id and (not app_id.isascii() or not app_id.isdigit()):
            return {"success": False, "error": "invalid_app_id"}
        trainer = Plugin._last_results.get(trainer_id)
        if trainer is None:
            return {"success": False, "error": "unknown_trainer"}
        if expected_version is not None and trainer.get("version", "") != expected_version:
            return {"success": False, "error": "unknown_trainer"}
        try:
            job = await trainer_download.start(trainer, app_id=app_id, expected_directory=expected_directory)
            return {"success": True, "job": job}
        except ValueError as error:
            return {"success": False, "error": str(error)}

    async def get_downloads(self):
        # Polled by the UI while a download runs — deliberately not logged.
        return await asyncio.to_thread(trainer_download.jobs)

    @action_log.log_call
    async def get_library(self, app_id: str = "", game_name: str = ""):
        try:
            if app_id:
                if not app_id.isascii() or not app_id.isdigit():
                    return {"success": False, "error": "invalid_app_id"}
                game = await asyncio.to_thread(steam_library.find_game, app_id)
                game_name = game["name"] if game else game_name
            library = await asyncio.to_thread(trainer_library.scan, app_id, game_name)
            return {"success": True, "game_name": game_name, **library}
        except (OSError, ValueError) as e:
            directory = await asyncio.to_thread(trainer_library.directory)
            return {"success": False, "error": str(e), "directory": directory}

    @action_log.log_call
    async def set_library_directory(self, path: str):
        try:
            directory = await asyncio.to_thread(trainer_library.set_directory, path)
            return {"success": True, "directory": directory}
        except (OSError, ValueError) as e:
            return {"success": False, "error": str(e)}

    async def get_library_settings(self):
        directory, database = await asyncio.gather(
            asyncio.to_thread(trainer_library.directory), asyncio.to_thread(trainer_db.status))
        return {"directory": directory, "database": database}

    async def manage_trainer(self, action: str, app_id: str, expected_directory: str,
                             entry_id: str = "", filename: str = "", source: str = "", game_name: str = ""):
        if not app_id or not app_id.isascii() or not app_id.isdigit():
            return {"success": False, "error": "invalid_app_id"}
        try:
            if action == "import":
                result = await asyncio.to_thread(trainer_library.import_file, source, app_id, game_name, expected_directory)
            elif action == "delete":
                await asyncio.to_thread(trainer_library.delete, entry_id, expected_directory, app_id)
                result = {}
            elif action == "executable":
                result = {"path": await asyncio.to_thread(trainer_library.executable, entry_id, filename, expected_directory)}
            elif action == "cancel":
                result = {"job": await asyncio.to_thread(trainer_download.cancel, entry_id, app_id)}
            else:
                raise ValueError("Unknown trainer action.")
            return {"success": True, **result}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def _main(self):
        await asyncio.to_thread(trainer_db.initialize)
        await asyncio.to_thread(trainer_library.cleanup_trash)
        trainer_download.resume()
        decky.logger.info("DeckyGCM loaded")

    async def _unload(self):
        try:
            if self._database_task is not None:
                await asyncio.shield(self._database_task)
        finally:
            await trainer_download.shutdown()
        decky.logger.info("DeckyGCM unloaded")

    async def _uninstall(self):
        pass
