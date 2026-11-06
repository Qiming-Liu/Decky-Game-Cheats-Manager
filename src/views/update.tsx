import { Focusable, Navigation } from "@decky/ui";
import { CSSProperties } from "react";
import { RELEASE_URL } from "../hooks/useUpdate";
import { useTranslations } from "../utils/i18n";
import { colors } from "./shell";

// The new-version marks: a pulsing yellow dot and the yellow version badge.
// They stay until the plugin is updated; there is nothing to dismiss.

const PULSE = "@keyframes gcm-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(245,185,66,.6) } 50% { box-shadow: 0 0 0 6px rgba(245,185,66,0) } } .gcm-badge.gpfocus { background: #f5b942 !important; color: #0e141b !important; }";

/** Opens a page in Steam's own browser; Game Mode has no other browser. */
export function openExternal(url: string) {
  Navigation.NavigateToExternalWeb(url);
  Navigation.CloseSideMenus();
}

export function UpdateDot({ size = 9, style }: { size?: number; style?: CSSProperties }) {
  return <>
    <style>{PULSE}</style>
    <span aria-hidden style={{
      display: "inline-block", flex: "0 0 auto", width: size, height: size, borderRadius: size, background: colors.warning,
      animation: "gcm-pulse 1.6s ease-in-out infinite", ...style,
    }} />
  </>;
}

/** "v1.0.1 → v1.2.0": the installed version, then the newer one in yellow, which opens the release page. */
export function VersionBadge({ current, latest }: { current: string; latest: string }) {
  const t = useTranslations();
  if (!current) return null;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 400, color: colors.muted }}>
    <span>v{current}</span>
    {latest && <>
      <span aria-hidden>→</span>
      <Focusable className="gcm-badge" aria-label={t.newVersion(`v${latest}`)} onActivate={() => openExternal(RELEASE_URL)}
        onClick={() => openExternal(RELEASE_URL)} style={{
          display: "inline-flex", alignItems: "center", gap: 6, height: 26, boxSizing: "border-box", padding: "0 9px", borderRadius: 3,
          background: "rgba(245,185,66,.16)", color: colors.warning, fontWeight: 700, cursor: "pointer",
        }}>
        <UpdateDot size={7} />v{latest}
      </Focusable>
    </>}
  </span>;
}
