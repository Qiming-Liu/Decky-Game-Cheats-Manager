import { PLUGIN_NAME, useTranslations } from "../utils/i18n";
import { SidebarNavigation } from "@decky/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkDatabaseUpdate, cleanupTrash } from "../utils/backend";
import { getAppIdFromLocation } from "../utils/routes";
import Modifiers from "./Modifiers";
import CommonSettings from "./CommonSettings";
import CustomOptions from "./CustomOptions";
import About from "./About";
import AdvancedSettings from "./AdvancedSettings";
import { UpdateDot } from "./update";
import { useUpdate } from "../hooks/useUpdate";
import { colors, PageStyle } from "./shell";
import { AlertCircleIcon, GearIcon, InfoIcon, PlayIcon, SlidersIcon, TerminalIcon } from "./icons";
import { isCompatToolUnsupported } from "../domain/compatTool";
import { isUnsupportedLauncher } from "../domain/steam";
import { useSettings } from "../hooks/useSettings";

/**
 * The name of the compatibility tool Steam runs the game with, e.g. "Proton 9.0",
 * and the program a non-Steam shortcut starts.
 */
function useCompatTool(appId: string | null | undefined) {
  const [tool, setTool] = useState("");
  const [command, setCommand] = useState("");
  useEffect(() => {
    if (!appId || typeof SteamClient === "undefined") return;
    let subscription: { unregister: () => void } | undefined;
    try {
      subscription = SteamClient.Apps.RegisterForAppDetails(Number(appId), details => {
        setTool(details?.strCompatToolDisplayName || "");
        setCommand(details?.strShortcutExe || "");
      });
    } catch { return; }
    return () => subscription?.unregister();
  }, [appId]);
  return { tool, command };
}

export default function GamePage() {
  const t = useTranslations();
  const appId = getAppIdFromLocation();
  const { tool: compatTool, command } = useCompatTool(appId);
  const unsupported = isCompatToolUnsupported(compatTool);
  const settings = useSettings();
  const launcherBlocked = isUnsupportedLauncher(command) && settings?.skip_launcher_check !== true;
  const { latest } = useUpdate();
  // Marks the page's root so the page styles apply here and nowhere else.
  // An attribute, not a class: Steam rewrites the root's class list.
  // Steam renders the sidebar title more than once and attaches it before the
  // sidebar is in the document, so every copy looks for the root a few times
  // and the marks are only removed when the page closes.
  const marked = useRef(new Set<Element>());
  const titleRef = useCallback((title: HTMLDivElement | null) => {
    if (!title) return;
    let attempts = 0;
    const mark = () => {
      const root = title.isConnected ? title.closest(".PageListColumn")?.parentElement : undefined;
      if (root) { root.setAttribute("data-gcm-root", ""); marked.current.add(root); }
      // The plugin's own window is hidden and its timers are throttled; the
      // title's window is the one on screen.
      else if (++attempts < 30) (title.ownerDocument.defaultView || window).setTimeout(mark, 50);
    };
    mark();
  }, []);
  useEffect(() => () => {
    marked.current.forEach(root => root.removeAttribute("data-gcm-root"));
    marked.current.clear();
  }, []);
  useEffect(() => {
    if (appId) {
      void checkDatabaseUpdate().catch(() => {});
      void cleanupTrash().catch(() => {});
    }
  }, [appId]);
  if (!appId) return <div>{t.noAppId}</div>;
  const name = typeof appStore === "undefined" ? "" : appStore?.GetAppOverviewByAppID?.(Number(appId))?.display_name || "";
  // The game is named in the sidebar so every tab shows which game it edits.
  const title = <div ref={titleRef} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
    <PageStyle />
    <span style={{ fontSize: 12, fontWeight: 400, color: colors.muted, letterSpacing: .5 }}>{PLUGIN_NAME}</span>
    <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25, color: colors.text, overflowWrap: "anywhere" }}>{name || t.gameTitle(appId)}</span>
    <div style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.5, color: colors.muted }}>
      {/* One text run, so a long tool name wraps like a sentence and the mark stays on its first line. */}
      {compatTool && <div style={{ display: "flex", alignItems: "flex-start", gap: 4, color: unsupported ? colors.warning : colors.success }}>
        {unsupported && <span style={{ display: "inline-flex", flex: "0 0 auto", marginTop: 2 }}><AlertCircleIcon size={14} color={colors.warning} /></span>}
        <span style={{ minWidth: 0 }}>{compatTool}
          {unsupported && <span style={{ whiteSpace: "nowrap" }}> · {t.compatUnsupported}</span>}</span>
      </div>}
      {launcherBlocked && <div style={{ display: "flex", alignItems: "flex-start", gap: 4, color: colors.warning }}>
        <span style={{ display: "inline-flex", flex: "0 0 auto", marginTop: 2 }}><AlertCircleIcon size={14} color={colors.warning} /></span>
        <span style={{ minWidth: 0 }}>{t.launcherUnsupported}</span>
      </div>}
      <div>AppID {appId}</div>
    </div>
  </div>;
  return <SidebarNavigation key={appId} title={title} showTitle pages={[
    { identifier: "modifiers", title: t.tabModifiers, hideTitle: true, icon: <PlayIcon />, content: <Modifiers appId={appId} gameName={name} unsupportedTool={unsupported ? compatTool : ""} /> },
    { identifier: "common", title: t.tabCommon, hideTitle: true, icon: <SlidersIcon />, content: <CommonSettings appId={appId} /> },
    { identifier: "custom", title: t.tabCustom, hideTitle: true, icon: <TerminalIcon />, content: <CustomOptions appId={appId} /> },
    { identifier: "advanced", title: t.advancedSettings, hideTitle: true, icon: <GearIcon />, content: <AdvancedSettings embedded /> },
    {
      identifier: "about", hideTitle: true, icon: <InfoIcon />, content: <About appId={appId} compatTool={compatTool} />,
      title: <span style={{ display: "flex", alignItems: "center", gap: 10 }}>{t.tabAbout}{latest && <UpdateDot />}</span>,
    },
  ]} />;
}
