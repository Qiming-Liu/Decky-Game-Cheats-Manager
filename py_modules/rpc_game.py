"""RPC methods for a running game: how its trainers started, and its Cheat Engine table."""
from __future__ import annotations

import asyncio
import os

import attach_memory
import ce_watch
import ct_bridge
import decky
import game_environment
import game_window
import launch_check
import plugin_settings
import table_scan
import table_trust
import trainer_events
import trainer_table
from rpc_common import user_action


class GameRpc:
    async def check_trainer_launch(self, app_id: str, programs: list, compat_tool: str = ""):
        # Runs in the background and only writes to the log.
        try:
            launch_check.watch(app_id, programs, compat_tool)
            trainer_events.begin(app_id, [program for program in programs if isinstance(program, str) and program])
            # Cheat Engine is pointed at the game without waiting for anyone to
            # open the panel, unless the player turned that off.
            attach = (await asyncio.to_thread(plugin_settings.load))["auto_attach"]
            tables = [program for program in programs
                      if isinstance(program, str) and program.lower().endswith(tuple(trainer_table.TABLE_EXTENSIONS))]
            # A game that ended without the panel open leaves its session's
            # commands and state behind; a new Cheat Engine would replay an old
            # attach to a process ID that is now another program.
            for program in tables:
                try:
                    await asyncio.to_thread(ct_bridge.start, program)
                except OSError as error:
                    decky.logger.warning("Cannot reset the table session for app %s: %s", app_id, error)
            for program in tables if attach else []:
                ct_bridge.watch_attach(program, app_id, programs)
            # What Cheat Engine does while the game runs goes into the log.
            if tables:
                ce_watch.watch(app_id, tables[0])
            for table in tables:
                try:
                    trust = await asyncio.to_thread(table_trust.status, table)
                except (OSError, ValueError):
                    continue
                if trust["state"] != "ok":
                    decky.logger.warning('Table "%s" for app %s is %s: Cheat Engine opened it anyway',
                                         os.path.basename(table), app_id, trust["state"])
        except ValueError as error:
            return {"success": False, "error": str(error)}
        return {"success": True}

    async def get_trainer_status(self, app_id: str = ""):
        """What the running game's trainers did (trainer_events.status). Polled by the panel — not logged."""
        if not isinstance(app_id, str) or (app_id and not app_id.isdigit()):
            return {"success": False, "error": "invalid_app_id"}
        try:
            return {"success": True, **await asyncio.to_thread(trainer_events.status, app_id)}
        except OSError as error:
            return {"success": False, "error": str(error)}

    async def get_game_environment(self, app_id: str, programs: list, exe: str = ""):
        """What the game runs on (game_environment): before the start, and while it runs. Not logged."""
        if not isinstance(app_id, str) or not app_id.isdigit():
            return {"success": False, "error": "invalid_app_id"}
        programs = [program for program in programs if isinstance(program, str)] if isinstance(programs, list) else []
        try:
            return {"success": True,
                    "prelaunch": await asyncio.to_thread(game_environment.prelaunch, app_id, exe if isinstance(exe, str) else ""),
                    "runtime": await asyncio.to_thread(game_environment.runtime, app_id, programs)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def scan_table(self, path: str, app_id: str):
        """Which entries' byte patterns are missing from the game's files (table_scan.scan)."""
        try:
            return {"success": True, **await asyncio.to_thread(table_scan.scan, path, app_id)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def get_table_trust(self, path: str):
        """Whether a table is still the file the player agreed to run (table_trust.status)."""
        try:
            return {"success": True, **await asyncio.to_thread(table_trust.status, path)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    @user_action(lambda path: f'Confirm table "{os.path.basename(path)}"')
    async def confirm_table(self, path: str):
        try:
            await asyncio.to_thread(table_trust.confirm, path)
            return {"success": True}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def get_game_window(self, app_id: str, programs: list):
        # Polled for a short while after a game with trainers starts — not logged.
        try:
            return {"success": True, **await asyncio.to_thread(game_window.windows, app_id, programs)}
        except ValueError as error:
            return {"success": False, "error": str(error)}

    async def get_table(self, path: str):
        """The entries of a table file, shown greyed out until Cheat Engine reports."""
        try:
            return {"success": True, **await asyncio.to_thread(trainer_table.read, path)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def table_session(self, action: str, table: str, app_id: str = ""):
        """Starts or stops the bridge to Cheat Engine for a running game's table.
        Attaching happens in the background when the game starts (check_trainer_launch)."""
        # Follows the Quick Access panel opening and closing — not a user action, not logged.
        try:
            if action == "start":
                await asyncio.to_thread(ct_bridge.start, table)
                return {"success": True}
            if action == "stop":
                await asyncio.to_thread(ct_bridge.stop, table)
                return {"success": True}
            raise ValueError("Unknown table action.")
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def get_game_processes(self, app_id: str, programs: list, table: str):
        """Cheat Engine's own process list (inside Proton), most likely game first; empty until it answers."""
        try:
            current = await asyncio.to_thread(ct_bridge.state, table)
            found = (current or {}).get("processes") or []
            return {"success": True, "processes": await asyncio.to_thread(game_window.rank, found, app_id, programs)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    @user_action(lambda table, pid, name="", app_id="": f'Attach Cheat Engine to "{name}" (pid {pid})')
    async def attach_table(self, table: str, pid: int, name: str = "", app_id: str = ""):
        """The player's pick from the panel; the game's next session looks for that process first."""
        try:
            if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
                raise ValueError("Unknown process.")
            number = await asyncio.to_thread(ct_bridge.send, table, {"attach": pid})
            # The name Cheat Engine lists for that process, not the one the panel sent.
            current = await asyncio.to_thread(ct_bridge.state, table)
            listed = next((item.get("name") for item in (current or {}).get("processes") or []
                           if isinstance(item, dict) and item.get("pid") == pid), "")
            if isinstance(app_id, str) and listed:
                try:
                    await asyncio.to_thread(attach_memory.remember, app_id, listed)
                except OSError as error:
                    decky.logger.warning("Cannot remember the process for app %s: %s", app_id, error)
            return {"success": True, "n": number}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    async def get_table_state(self, table: str):
        # Polled by the Quick Access panel while a game runs — not logged.
        try:
            return {"success": True, "state": await asyncio.to_thread(ct_bridge.state, table)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}

    @user_action(lambda table, command: f'Table command for "{os.path.basename(table)}": '
                 + ", ".join(sorted(str(key) for key in command)))
    async def send_table_command(self, table: str, command: dict):
        try:
            return {"success": True, "n": await asyncio.to_thread(ct_bridge.send, table, command)}
        except (OSError, ValueError) as error:
            return {"success": False, "error": str(error)}
