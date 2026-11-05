import { routerHook } from "@decky/api";
import { definePlugin, staticClasses } from "@decky/ui";
import { FaGamepad as PluginIcon } from "react-icons/fa";

import installGameMenu from "./patch";
import { initLanguage, PLUGIN_NAME } from "./utils/i18n";
import { GAME_PAGE_ROUTE } from "./utils/routes";
import GamePage from "./views/GamePage";
import Settings from "./views/Settings";

export default definePlugin(() => {
  initLanguage();
  const removeGameMenu = installGameMenu();

  routerHook.addRoute(GAME_PAGE_ROUTE, GamePage, { exact: true });

  return {
    name: PLUGIN_NAME,
    title: <div className={staticClasses.Title}>{PLUGIN_NAME}</div>,
    content: <Settings />,
    icon: <PluginIcon />,
    onDismount() {
      routerHook.removeRoute(GAME_PAGE_ROUTE);
      removeGameMenu();
    },
  };
});
