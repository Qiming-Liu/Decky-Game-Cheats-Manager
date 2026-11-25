import { Focusable, Navigation } from "@decky/ui";
import type { ReactNode } from "react";
import { useTranslations } from "../../utils/i18n";
import { BackIcon } from "../icons";
import { IconButton } from "./buttons";
import { colors, PageStyle } from "./theme";

export function StandalonePage({ title, children }: { title: string; children: ReactNode }) {
  const t = useTranslations();
  return <div className="gcm-font" style={{
    // Leave room for Steam's status bar and button hints.
    position: "absolute", inset: 0, boxSizing: "border-box", overflow: "hidden",
    padding: "clamp(48px, 8.5vh, 68px) clamp(24px, 4vw, 48px) clamp(52px, 8vh, 64px)",
    background: "linear-gradient(180deg, #0e141b 0%, #151c24 100%)", color: "#dcdedf", display: "flex", flexDirection: "column", gap: "clamp(8px, 2.2vh, 18px)",
  }}>
    <PageStyle />
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <IconButton label={t.back} style={{ background: colors.button, color: colors.text }} onClick={() => Navigation.NavigateBack()}><BackIcon /></IconButton>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text }}>{title}</h1>
    </Focusable>
    {children}
  </div>;
}

/** Page title with the page's actions on the right; `noteEnd` moves the note to the far right. */
export function PageHeader({ title, note, noteEnd, before, children, gap = 16 }: {
  title: ReactNode; note?: ReactNode; noteEnd?: boolean; before?: ReactNode; children?: ReactNode; gap?: number;
}) {
  const noteText = note && <span style={{ fontSize: 12, color: colors.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</span>;
  return <Focusable flow-children="row" style={{ display: "flex", alignItems: noteEnd ? "baseline" : "center", justifyContent: "space-between", gap: 16, marginBottom: gap }}>
    <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: before ? "center" : "baseline", gap: 12 }}>
      {before}
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text, whiteSpace: "nowrap" }}>{title}</h1>
      {!noteEnd && noteText}
    </div>
    {noteEnd && noteText}
    {children && <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>{children}</div>}
  </Focusable>;
}
