import { useTranslations } from "../utils/i18n";
import { SidebarNavigation } from "@decky/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkDatabaseUpdate, cleanupTrash } from "../utils/backend";
import { getAppIdFromLocation } from "../utils/routes";
import Modifiers from "./Modifiers";
import CommonSettings from "./CommonSettings";
import CustomOptions from "./CustomOptions";
import { colors, PageStyle } from "./shell";
import { AlertCircleIcon, PlayIcon, SlidersIcon, TerminalIcon } from "./icons";
import { isCompatToolUnsupported } from "../domain/compatTool";

/** The name of the compatibility tool Steam runs the game with, e.g. "Proton 9.0". */
function useCompatTool(appId: string | null | undefined) {
  const [tool, setTool] = useState("");
  useEffect(() => {
    if (!appId || typeof SteamClient === "undefined") return;
    let subscription: { unregister: () => void } | undefined;
    try {
      subscription = SteamClient.Apps.RegisterForAppDetails(Number(appId), details => {
        setTool(details?.strCompatToolDisplayName || "");
      });
    } catch { return; }
    return () => subscription?.unregister();
  }, [appId]);
  return tool;
}

export default function GamePage() {
  const t = useTranslations();
  const appId = getAppIdFromLocation();
  const compatTool = useCompatTool(appId);
  const unsupported = isCompatToolUnsupported(compatTool);
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
    <span style={{ fontSize: 12, fontWeight: 400, color: colors.muted, letterSpacing: .5 }}>{t.menuLabel}</span>
    <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25, color: colors.text, overflowWrap: "anywhere" }}>{name || t.gameTitle(appId)}</span>
    <div style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.5, color: colors.muted }}>
      {compatTool && <div style={{ display: "flex", alignItems: "center", gap: 4, color: unsupported ? colors.danger : colors.warning }}>
        {unsupported && <AlertCircleIcon size={14} color={colors.danger} />}
        <span>{compatTool}</span>
        {unsupported && <span>· {t.compatUnsupported}</span>}
      </div>}
      <div>AppID {appId}</div>
    </div>
  </div>;
  return <SidebarNavigation key={appId} title={title} showTitle pages={[
    { identifier: "modifiers", title: t.tabModifiers, hideTitle: true, icon: <PlayIcon />, content: <Modifiers appId={appId} gameName={name} unsupportedTool={unsupported ? compatTool : ""} /> },
    { identifier: "common", title: t.tabCommon, hideTitle: true, icon: <SlidersIcon />, content: <CommonSettings appId={appId} /> },
    { identifier: "custom", title: t.tabCustom, hideTitle: true, icon: <TerminalIcon />, content: <CustomOptions appId={appId} /> },
  ]} />;
}
