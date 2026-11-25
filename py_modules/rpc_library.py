"""RPC methods for the trainer library: its folder, its trainers and the downloads in it."""
from __future__ import annotations

import asyncio
import os

import library_settings
from library_layout import is_app_id
import steam_library
import trainer_db
import trainer_download
import trainer_library
from rpc_common import for_app, user_action


def _job_name(job_id: str) -> str:
    return next((job["trainer_name"] for job in trainer_download.jobs() if job["id"] == job_id), job_id)


def _entry_name(entry_id: str, expected_directory: str) -> str:
    try:
        return trainer_library.entry(entry_id, expected_directory)["name"]
    except (OSError, ValueError):
        return entry_id


class LibraryRpc:
    async def cleanup_trash(self):
        await asyncio.to_thread(trainer_library.cleanup_trash)

    async def get_library(self, app_id: str = "", game_name: str = ""):
        try:
            if app_id:
                if not is_app_id(app_id):
                    return {"success": False, "error": "invalid_app_id"}
                game = await asyncio.to_thread(steam_library.find_game, app_id)
                game_name = game["name"] if game else game_name
            library = await asyncio.to_thread(trainer_library.scan, app_id, game_name)
            return {"success": True, "game_name": game_name, **library}
        except (OSError, ValueError) as e:
            directory = await asyncio.to_thread(library_settings.directory)
            return {"success": False, "error": str(e), "directory": directory}

    @user_action(lambda path: f"Change the trainer library folder to {path}")
    async def set_library_directory(self, path: str):
        try:
            directory = await asyncio.to_thread(trainer_library.set_directory, path)
            return {"success": True, "directory": directory}
        except (OSError, ValueError) as e:
            return {"success": False, "error": str(e)}

    async def get_library_settings(self):
        directory, database = await asyncio.gather(
            asyncio.to_thread(library_settings.directory), asyncio.to_thread(trainer_db.status))
        task = self._database_task
        updating = task is not None and not task.done()
        result = task.result() if task is not None and task.done() and not task.cancelled() and not task.exception() else None
        return {
            "directory": directory,
            "database": {
                **database, "updating": updating, "progress": dict(trainer_db.PROGRESS),
                # The first error of the last finished refresh; the old files stay in use.
                "error": next(iter(result["errors"].values()), "") if result and result.get("errors") else "",
            },
        }

    async def manage_trainer(self, action: str, app_id: str, expected_directory: str,
                             entry_id: str = "", filename: str = "", source: str = "", game_name: str = ""):
        # Only a download that belongs to no game (Cheat Engine) is managed without one.
        gameless = action == "cancel" and app_id == ""
        if not gameless and not is_app_id(app_id):
            return {"success": False, "error": "invalid_app_id"}
        try:
            if action == "import":
                result = await self._link_trainer(source, app_id, game_name, expected_directory)
            elif action == "delete":
                name = await asyncio.to_thread(_entry_name, entry_id, expected_directory)
                await self._delete_trainer(name, entry_id, expected_directory, app_id)
                result = {}
            elif action == "executable":
                # Part of selecting a trainer; the frontend logs that selection.
                result = {"path": await asyncio.to_thread(trainer_library.executable, entry_id, filename, expected_directory)}
            elif action == "cancel":
                name = await asyncio.to_thread(_job_name, entry_id)
                result = {"job": await self._cancel_download(name, entry_id, app_id)}
            else:
                raise ValueError("Unknown trainer action.")
            return {"success": True, **result}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    @user_action(lambda source, app_id, game_name, _directory:
                 f'Link local program "{os.path.basename(source)}"{for_app(app_id, game_name)}')
    async def _link_trainer(self, source, app_id, game_name, expected_directory):
        return await asyncio.to_thread(trainer_library.link_file, source, app_id, game_name, expected_directory)

    @user_action(lambda name, _entry_id, _directory, app_id: f'Delete trainer "{name}"{for_app(app_id)}')
    async def _delete_trainer(self, name, entry_id, expected_directory, app_id):
        await asyncio.to_thread(trainer_library.delete, entry_id, expected_directory, app_id)

    @user_action(lambda name, _job_id, app_id: f'Cancel the download of trainer "{name}"{for_app(app_id)}')
    async def _cancel_download(self, name, job_id, app_id):
        return await asyncio.to_thread(trainer_download.cancel, job_id, app_id)
