from __future__ import annotations

import asyncio
import functools
import logging
import os
import signal
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), "py_modules"))

import gcm_bridge

gcm_bridge.ensure_paths()

import decky  # noqa: E402
import trainer_db  # noqa: E402
import trainer_download  # noqa: E402
import trainer_search  # noqa: E402
import trainer_library  # noqa: E402
import steam_library  # noqa: E402
import custom_options  # noqa: E402
import launcher  # noqa: E402
import launch_check  # noqa: E402
import plugin_settings  # noqa: E402
import about  # noqa: E402
import plugin_log  # noqa: E402

# Decky kills a plugin that is still running five seconds after its stop request.
UNLOAD_WAIT = 3.5
# Staging directories older than this process were left by a killed one.
STARTED_AT = time.time()
# One persistent log for everything the plugin logs through decky.logger.
LOG = plugin_log.PluginLog(decky.DECKY_PLUGIN_LOG_DIR, "deckygcm")


# Decky stops a plugin with SIGTERM and then closes its socket. Once the socket
# is closed, Decky's read loop in this process spins without yielding
# (decky-loader 3.3.1), so the event loop runs nothing else: depending on which
# event it handles first, Decky's own SIGTERM callback and _unload never run,
# or an await inside _unload never resumes, and Decky kills the process after
# five seconds. Nothing here may wait on the event loop. Stop the work on this
# thread instead, within that limit.
def _stop_background_work() -> bool:
    deadline = time.monotonic() + UNLOAD_WAIT
    trainer_db.stop()
    launch_check.stop()
    stopped = trainer_download.close(UNLOAD_WAIT)
    stopped = trainer_db.wait_idle(max(0.0, deadline - time.monotonic())) and stopped
    if not stopped:
        decky.logger.warning("DeckyGCM unloaded while background work was still stopping")
    decky.logger.info("DeckyGCM unloaded")
    return stopped


def _terminate(signum, frame):
    # A Python-level handler still runs while the event loop spins, because the
    # interpreter checks for signals between bytecodes. Decky's _uninstall call
    # is skipped; this plugin keeps nothing that it would clean up.
    _stop_background_work()
    LOG.detach()
    logging.shutdown()
    os._exit(0)


# The log records what the user did, one line per action with its outcome.
user_action = functools.partial(plugin_log.user_action, decky.logger)


def _for_app(app_id: str, game_name: str = "") -> str:
    if not app_id:
        return ""
    return f" for app {app_id}" + (f" ({game_name})" if game_name else "")


def _job_name(job_id: str) -> str:
    return next((job["trainer_name"] for job in trainer_download.jobs() if job["id"] == job_id), job_id)


def _entry_name(entry_id: str, expected_directory: str) -> str:
    try:
        return trainer_library.entry(entry_id, expected_directory)["name"]
    except (OSError, ValueError):
        return entry_id


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

    async def cleanup_trash(self):
        await asyncio.to_thread(trainer_library.cleanup_trash)

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
                {k: t[k] for k in ("id", "trainer_name", "game_name", "origin", "version", "supported")}
                for t in results
            ],
        }

    @user_action(lambda trainer_id, app_id="", *_, **__: 'Start downloading trainer "%s"%s' % (
        Plugin._last_results.get(trainer_id, {}).get("trainer_name", trainer_id), _for_app(app_id)))
    async def download_trainer(self, trainer_id: str, app_id: str = "", expected_directory: str = "",
                               expected_version: str | None = None):
        if app_id and (not app_id.isascii() or not app_id.isdigit()):
            return {"success": False, "error": "invalid_app_id"}
        trainer = Plugin._last_results.get(trainer_id)
        if trainer is None or not trainer.get("supported", True):
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

    @user_action(lambda path: f"Change the trainer library folder to {path}")
    async def set_library_directory(self, path: str):
        try:
            directory = await asyncio.to_thread(trainer_library.set_directory, path)
            return {"success": True, "directory": directory}
        except (OSError, ValueError) as e:
            return {"success": False, "error": str(e)}

    async def get_library_settings(self):
        directory, database = await asyncio.gather(
            asyncio.to_thread(trainer_library.directory), asyncio.to_thread(trainer_db.status))
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

    async def get_settings(self):
        return await asyncio.to_thread(plugin_settings.load)

    @user_action(lambda changes: "Change settings: " + ", ".join(f"{k}={v!r}" for k, v in changes.items()))
    async def set_settings(self, changes: dict):
        try:
            settings = await asyncio.to_thread(plugin_settings.update, changes)
            await asyncio.to_thread(launcher.script)
            return {"success": True, "settings": settings}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    @user_action(lambda: "Reset settings and custom launch options")
    async def reset_settings(self):
        """Plugin settings and the custom option list back to their defaults.
        Downloaded trainers and the library folder stay."""
        try:
            settings = await asyncio.to_thread(plugin_settings.reset)
            options = await asyncio.to_thread(custom_options.reset)
            await asyncio.to_thread(launcher.script)
            return {"success": True, "settings": settings, "options": options}
        except OSError as error:
            return {"success": False, "error": str(error)}

    async def get_launcher(self):
        try:
            # The home directory lets the frontend write and read `~/` paths.
            return {"success": True, **await asyncio.to_thread(launcher.script), "home": decky.DECKY_USER_HOME}
        except OSError as error:
            return {"success": False, "error": str(error)}

    async def check_trainer_launch(self, app_id: str, programs: list, compat_tool: str = ""):
        # Runs in the background and only writes to the log.
        try:
            launch_check.watch(app_id, programs, compat_tool)
        except ValueError as error:
            return {"success": False, "error": str(error)}
        return {"success": True}

    async def get_update(self):
        # Opened with every Quick Access view; GitHub is asked at most weekly.
        return await asyncio.to_thread(about.update)

    async def get_system_name(self):
        return await asyncio.to_thread(about.system_name)

    async def get_log(self, limit: int = 500):
        return await asyncio.to_thread(LOG.read, limit)

    @user_action(lambda: "Clear the log")
    async def clear_log(self):
        await asyncio.to_thread(LOG.clear)

    async def get_log_export_directory(self):
        return await asyncio.to_thread(LOG.export_directory, decky.DECKY_USER_HOME)

    @user_action(lambda directory="": f"Export the log to {directory or '~/Downloads'}")
    async def export_log(self, directory: str = ""):
        return await asyncio.to_thread(LOG.export, decky.DECKY_USER_HOME, directory or None)

    async def log_frontend(self, level: str, message: str):
        plugin_log.log_frontend(decky.logger, level, message)

    async def get_custom_options(self):
        options, installed = await asyncio.gather(
            asyncio.to_thread(custom_options.load), asyncio.to_thread(custom_options.installed_presets))
        return {"options": options, "home": decky.DECKY_USER_HOME, "installed": installed}

    @user_action(lambda options: f"Save custom launch options ({len(options)} in the list)")
    async def save_custom_options(self, options: list):
        try:
            return {"success": True, "options": await asyncio.to_thread(custom_options.save, options)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def manage_trainer(self, action: str, app_id: str, expected_directory: str,
                             entry_id: str = "", filename: str = "", source: str = "", game_name: str = ""):
        if not app_id or not app_id.isascii() or not app_id.isdigit():
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
                 f'Link local program "{os.path.basename(source)}"{_for_app(app_id, game_name)}')
    async def _link_trainer(self, source, app_id, game_name, expected_directory):
        return await asyncio.to_thread(trainer_library.link_file, source, app_id, game_name, expected_directory)

    @user_action(lambda name, _entry_id, _directory, app_id: f'Delete trainer "{name}"{_for_app(app_id)}')
    async def _delete_trainer(self, name, entry_id, expected_directory, app_id):
        await asyncio.to_thread(trainer_library.delete, entry_id, expected_directory, app_id)

    @user_action(lambda name, _job_id, app_id: f'Cancel the download of trainer "{name}"{_for_app(app_id)}')
    async def _cancel_download(self, name, job_id, app_id):
        return await asyncio.to_thread(trainer_download.cancel, job_id, app_id)

    async def _main(self):
        LOG.attach(decky.logger, f"DeckyGCM v{decky.DECKY_PLUGIN_VERSION} started")
        await asyncio.to_thread(trainer_db.initialize)
        await asyncio.to_thread(trainer_library.cleanup_trash)
        await asyncio.to_thread(trainer_db.cleanup_staging, STARTED_AT)
        await asyncio.to_thread(trainer_download.cleanup_staging, STARTED_AT)
        # Games' launch options point at this file; restore it if the settings folder was cleared.
        try:
            await asyncio.to_thread(launcher.script)
        except OSError as error:
            decky.logger.warning("Could not write the launcher script: %s", error)
        trainer_download.resume()
        # Replaces Decky's event-loop SIGTERM callback; see _stop_background_work.
        signal.signal(signal.SIGTERM, _terminate)
        decky.logger.info("DeckyGCM loaded")

    async def _unload(self):
        # Still used when Decky stops the plugin before _main installed the handler.
        _stop_background_work()
        LOG.detach()

    async def _uninstall(self):
        pass
