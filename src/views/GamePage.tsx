import { PLUGIN_NAME, useTranslations } from "../utils/i18n";
import { SidebarNavigation } from "@decky/ui";
import { useEffect } from "react";
import { checkDatabaseUpdate, cleanupTrash } from "../utils/backend";
import { FaMagic, FaSlidersH, FaTerminal } from "react-icons/fa";
import { getAppIdFromLocation } from "../utils/routes";
import Modifiers from "./Modifiers";
import CommonSettings from "./CommonSettings";
import CustomOptions from "./CustomOptions";
import { colors } from "./shell";

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
  // The game is named in the sidebar so every tab shows which game it edits.
  const title = <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
    <span style={{ fontSize: 12, color: colors.muted, letterSpacing: .5 }}>{PLUGIN_NAME}</span>
    <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25, color: colors.text, overflowWrap: "anywhere" }}>{name || t.gameTitle(appId)}</span>
    <span style={{ fontSize: 12, color: colors.muted }}>AppID {appId}</span>
  </div>;
  return <SidebarNavigation key={appId} title={title} showTitle pages={[
    { identifier: "modifiers", title: t.tabModifiers, hideTitle: true, icon: <FaMagic />, content: <Modifiers appId={appId} gameName={name} /> },
    { identifier: "common", title: t.tabCommon, hideTitle: true, icon: <FaSlidersH />, content: <CommonSettings appId={appId} /> },
    { identifier: "custom", title: t.tabCustom, hideTitle: true, icon: <FaTerminal />, content: <CustomOptions appId={appId} /> },
  ]} />;
}
