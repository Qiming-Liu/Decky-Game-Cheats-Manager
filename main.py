from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), "py_modules"))

import gcm_bridge

gcm_bridge.ensure_paths()

import ce_watch  # noqa: E402
import cheat_engine  # noqa: E402
import ct_bridge  # noqa: E402
import decky  # noqa: E402
import launch_check  # noqa: E402
import launcher  # noqa: E402
import plugin_log  # noqa: E402
import trainer_db  # noqa: E402
import trainer_download  # noqa: E402
import trainer_library  # noqa: E402
from rpc_catalog import CatalogRpc  # noqa: E402
from rpc_cheat_engine import CheatEngineRpc  # noqa: E402
import rpc_common  # noqa: E402
from rpc_game import GameRpc  # noqa: E402
from rpc_library import LibraryRpc  # noqa: E402
from rpc_log import LogRpc  # noqa: E402
from rpc_settings import SettingsRpc  # noqa: E402

# Decky kills a plugin that is still running five seconds after its stop request.
UNLOAD_WAIT = 3.5
# Staging directories older than this process were left by a killed one.
STARTED_AT = time.time()


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
    ct_bridge.stop_watching()
    ce_watch.stop()
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
    rpc_common.LOG.detach()
    logging.shutdown()
    os._exit(0)


class Plugin(CatalogRpc, LibraryRpc, SettingsRpc, CheatEngineRpc, GameRpc, LogRpc):
    """The RPC surface the frontend calls. Each group of methods is in its own
    `py_modules/rpc_*.py`; this class adds the plugin's start and stop."""

    async def _main(self):
        rpc_common.LOG.attach(decky.logger, f"DeckyGCM v{decky.DECKY_PLUGIN_VERSION} started")
        plugin_log.install_exception_hooks(decky.logger)
        plugin_log.log_loop_errors(asyncio.get_running_loop(), decky.logger)
        await asyncio.to_thread(trainer_db.initialize)
        await asyncio.to_thread(trainer_library.cleanup_trash)
        await asyncio.to_thread(trainer_db.cleanup_staging, STARTED_AT)
        await asyncio.to_thread(trainer_download.cleanup_staging, STARTED_AT)
        # Games' launch options point at this file; restore it if the settings folder was cleared.
        try:
            await asyncio.to_thread(launcher.script)
        except OSError as error:
            decky.logger.warning("Could not write the launcher script: %s", error)
        # Cheat Engine installed by an earlier version gets the current bridge and language pack.
        try:
            await asyncio.to_thread(cheat_engine.install_bridge)
        except OSError as error:
            decky.logger.warning("Could not update Cheat Engine's bridge: %s", error)
        trainer_download.resume()
        # Replaces Decky's event-loop SIGTERM callback; see _stop_background_work.
        signal.signal(signal.SIGTERM, _terminate)
        decky.logger.info("DeckyGCM loaded")

    async def _unload(self):
        # Still used when Decky stops the plugin before _main installed the handler.
        _stop_background_work()
        rpc_common.LOG.detach()

    async def _uninstall(self):
        pass
