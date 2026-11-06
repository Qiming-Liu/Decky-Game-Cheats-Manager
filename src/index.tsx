import { routerHook } from "@decky/api";
import { definePlugin } from "@decky/ui";
import { FaGamepad as PluginIcon } from "react-icons/fa";

import installGameMenu from "./patch";
import { initLanguage, PLUGIN_NAME } from "./utils/i18n";
import { GAME_PAGE_ROUTE, SETTINGS_ROUTE } from "./utils/routes";
import AdvancedSettings from "./views/AdvancedSettings";
import GamePage from "./views/GamePage";
import Settings from "./views/Settings";

/** The Quick Access title: the plugin's name, the same in every language, and its version. */
function Title() {
  const loader = (window as { DeckyPluginLoader?: { plugins?: { name: string; version?: string }[] } }).DeckyPluginLoader;
  const version = loader?.plugins?.find(plugin => plugin.name === PLUGIN_NAME)?.version;
  return <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
    <span>{PLUGIN_NAME}</span>{version && <span style={{ fontSize: 11, fontWeight: 400, color: "#6b7480" }}>v{version}</span>}
  </div>;
}

export default definePlugin(() => {
  initLanguage();
  const removeGameMenu = installGameMenu();

  routerHook.addRoute(GAME_PAGE_ROUTE, GamePage, { exact: true });
  routerHook.addRoute(SETTINGS_ROUTE, AdvancedSettings, { exact: true });

  return {
    name: PLUGIN_NAME,
    titleView: <Title />,
    content: <Settings />,
    icon: <PluginIcon />,
    onDismount() {
      routerHook.removeRoute(GAME_PAGE_ROUTE);
      routerHook.removeRoute(SETTINGS_ROUTE);
      removeGameMenu();
    },
  };
});
