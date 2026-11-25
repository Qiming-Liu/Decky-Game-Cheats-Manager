import type { CSSProperties } from "react";
import { getLanguage } from "../../utils/i18n";

// Shared building blocks of the game page: one row style, one header style
// and one launch-option preview for every tab.

export const colors = {
  text: "#ffffff", muted: "#8b929a", dim: "#6b7480", accent: "#1a9fff", accentText: "#7cc4ff",
  warning: "#f5b942", danger: "#e35b5b", success: "#8ee06f", surface: "rgba(255,255,255,.04)",
  line: "rgba(255,255,255,.08)", button: "#3d4450",
} as const;

export const mono: CSSProperties = { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, overflowWrap: "anywhere" };
export const buttonBase: CSSProperties = {
  width: "auto", minWidth: 0, height: 40, padding: "0 16px", fontSize: 14, whiteSpace: "nowrap",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
};

// Page-wide styles of the game page. GamePage marks its root with [data-gcm-root]
// so the rules never touch other Steam pages. Selectors stay plain classes:
// these rules are matched on every focus change, and a Deck has little CPU.
// The font is inherited; only the few Steam elements that set their own font
// are told to inherit. Inline backgrounds hide Steam's focus colour, so ghost
// buttons and whole rows get their own focus style. The Quick Access menu is
// a window of its own without these page styles; it takes FOCUS_CSS alone.
export const FOCUS_CSS = `
.gcm-ghost.gpfocus, .gcm-solid.gpfocus { background: #dcdedf !important; color: #0e141b !important; }
.gcm-row.gpfocus, .gcm-row.gpfocuswithin { background: rgba(255,255,255,.1) !important; }
`;
const FONTS: Record<string, string> = { "zh-CN": "Noto Sans CJK SC", "zh-TW": "Noto Sans CJK TC", en: "Noto Sans" };
const pageCss = (font: string) => `
[data-gcm-root] { background: linear-gradient(180deg, #0e141b 0%, #151c24 100%) !important; }
[data-gcm-root] > .PageListColumn { background: rgba(0,0,0,.18) !important; }
[data-gcm-root] > .DialogContentTransition { background: transparent !important; }
[data-gcm-root], .gcm-font { font-family: "${font}", "Motiva Sans", sans-serif !important; }
[data-gcm-root] .Panel, [data-gcm-root] .DialogContent, [data-gcm-root] .PageListColumn div,
[data-gcm-root] input, .gcm-font .DialogButton:not([style*="monospace"]), .gcm-font input:not([style*="monospace"]) { font-family: inherit !important; }
${FOCUS_CSS.trim()}
.gcm-card.gpfocus { filter: brightness(1.3); }
.DialogContent.gcm-dialog { width: 640px; max-width: 100%; box-sizing: border-box; padding: 28px 32px 24px !important; border-radius: 6px; background: #1f2126 !important; box-shadow: 0 24px 60px rgba(0,0,0,.6); }
.gcm-dialog .DialogInput { height: 46px; box-sizing: border-box; padding: 0 14px !important; border: 1px solid rgba(255,255,255,.14); border-radius: 3px; background: rgba(0,0,0,.35) !important; color: #fff; }
.gcm-dialog .gcm-code .DialogInput { border-color: transparent; background: transparent !important; }
`;
export const PageStyle = () => <style>{pageCss(FONTS[getLanguage()] || FONTS.en)}</style>;
