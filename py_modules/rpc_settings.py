"""RPC methods for the plugin's settings, the saved launch options and the About page."""
from __future__ import annotations

import asyncio

import about
import custom_options
import decky
import launcher
import plugin_settings
from rpc_common import user_action


class SettingsRpc:
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

    async def get_update(self):
        # Opened with every Quick Access view; GitHub is asked at most daily.
        return await asyncio.to_thread(about.update)

    async def get_system_name(self):
        return await asyncio.to_thread(about.system_name)

    async def get_test_notice(self):
        """The test build to warn about on the first Quick Access open; "" otherwise."""
        return await asyncio.to_thread(about.test_notice)

    async def acknowledge_test_notice(self):
        try:
            await asyncio.to_thread(about.acknowledge_test_notice)
            return {"success": True}
        except OSError as error:
            return {"success": False, "error": str(error)}

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
