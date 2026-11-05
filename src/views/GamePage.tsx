import { PLUGIN_NAME, useTranslations } from "../utils/i18n";
import { SidebarNavigation } from "@decky/ui";
import { useEffect } from "react";
import { checkDatabaseUpdate, cleanupTrash } from "../utils/backend";
import { FaMagic, FaSlidersH, FaTerminal } from "react-icons/fa";
import { getAppIdFromLocation } from "../utils/routes";
import Modifiers from "./Modifiers";
import CommonSettings from "./CommonSettings";
import CustomOptions from "./CustomOptions";

export default function GamePage() {
  const t = useTranslations();
  const appId = getAppIdFromLocation();
  useEffect(() => {
    if (appId) {
      void checkDatabaseUpdate().catch(() => {});
      void cleanupTrash().catch(() => {});
    }
  }, [appId]);
  if (!appId) return <div>{t.noAppId}</div>;
  const name = typeof appStore === "undefined" ? "" : appStore?.GetAppOverviewByAppID?.(Number(appId))?.display_name || "";
  return <SidebarNavigation key={appId} title={PLUGIN_NAME} showTitle pages={[
    { identifier: "modifiers", title: t.tabModifiers, hideTitle: true, icon: <FaMagic />, content: <Modifiers appId={appId} gameName={name} /> },
    { identifier: "common", title: t.tabCommon, hideTitle: true, icon: <FaSlidersH />, content: <CommonSettings appId={appId} /> },
    { identifier: "custom", title: t.tabCustom, hideTitle: true, icon: <FaTerminal />, content: <CustomOptions appId={appId} /> },
  ]} />;
}
