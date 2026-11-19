import { routerHook } from "@decky/api";
import { definePlugin } from "@decky/ui";

import installGameMenu from "./patch";
import watchTrainerLaunches from "./launchCheck";
import { logFrontend } from "./utils/backend";
import { initLanguage, PLUGIN_NAME } from "./utils/i18n";
import { GAME_PAGE_ROUTE, SETTINGS_ROUTE } from "./utils/routes";
import AdvancedSettings from "./views/AdvancedSettings";
import GamePage from "./views/GamePage";
import { PluginIcon } from "./views/icons";
import Settings from "./views/Settings";
import { UpdateDot, VersionBadge } from "./views/update";
import { refreshUpdate, useUpdate } from "./hooks/useUpdate";

/** The Quick Access title: the plugin's name, the same in every language, and its version. */
function Title() {
  const { current, latest } = useUpdate();
  return <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
    <span>{PLUGIN_NAME}</span><VersionBadge current={current} latest={latest} />
  </div>;
}

/** The plugin's Quick Access icon, with a yellow dot while a newer release exists. */
function Icon() {
  const { latest } = useUpdate();
  return <span style={{ position: "relative", display: "inline-flex" }}>
    <PluginIcon />
    {latest && <UpdateDot style={{ position: "absolute", top: -3, right: -5 }} />}
  </span>;
}

export default definePlugin(() => {
  initLanguage();
  const removeGameMenu = installGameMenu();
  const stopLaunchCheck = watchTrainerLaunches();
  void refreshUpdate();

  try {
    routerHook.addRoute(GAME_PAGE_ROUTE, GamePage, { exact: true });
    routerHook.addRoute(SETTINGS_ROUTE, AdvancedSettings, { exact: true });
  } catch (error) {
    logFrontend("error", "Registering the plugin pages failed", error);
    throw error;
  }

  return {
    name: PLUGIN_NAME,
    titleView: <Title />,
    content: <Settings />,
    icon: <Icon />,
    onDismount() {
      routerHook.removeRoute(GAME_PAGE_ROUTE);
      routerHook.removeRoute(SETTINGS_ROUTE);
      removeGameMenu();
      stopLaunchCheck();
    },
  };
});
