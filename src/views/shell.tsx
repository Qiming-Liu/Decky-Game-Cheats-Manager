import { DialogButton, Focusable, Menu, MenuItem, showContextMenu } from "@decky/ui";
import { CSSProperties, MouseEvent, ReactNode } from "react";
import { LaunchOptions, renderLaunchOptionDefinition } from "../domain/options";
import { DownloadJob } from "../utils/backend";
import { getLanguage } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { MoreIcon } from "./icons";

// Shared building blocks of the game page: one row style, one header style
// and one launch-option preview for every tab.

export const colors = {
  text: "#ffffff", muted: "#8b929a", dim: "#6b7480", accent: "#1a9fff", accentText: "#7cc4ff",
  warning: "#f5b942", danger: "#e35b5b", success: "#8ee06f", surface: "rgba(255,255,255,.04)",
  line: "rgba(255,255,255,.08)", button: "#3d4450",
} as const;

export const mono: CSSProperties = { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, overflowWrap: "anywhere" };
const buttonBase: CSSProperties = {
  width: "auto", minWidth: 0, height: 40, padding: "0 16px", fontSize: 14, whiteSpace: "nowrap",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
};

// Page-wide styles of the game page. GamePage marks its root with [data-gcm-root]
// so the rules never touch other Steam pages. Selectors stay plain classes:
// these rules are matched on every focus change, and a Deck has little CPU.
// The font is inherited; only the few Steam elements that set their own font
// are told to inherit. Inline backgrounds hide Steam's focus colour, so ghost
// buttons and whole rows get their own focus style.
const FONTS: Record<string, string> = { "zh-CN": "Noto Sans CJK SC", "zh-TW": "Noto Sans CJK TC", en: "Noto Sans" };
const pageCss = (font: string) => `
[data-gcm-root] { background: linear-gradient(180deg, #0e141b 0%, #151c24 100%) !important; }
[data-gcm-root] > .PageListColumn { background: rgba(0,0,0,.18) !important; }
[data-gcm-root] > .DialogContentTransition { background: transparent !important; }
[data-gcm-root], .gcm-font { font-family: "${font}", "Noto Sans SC", "Motiva Sans", sans-serif !important; }
[data-gcm-root] .Panel, [data-gcm-root] .DialogContent, [data-gcm-root] .PageListColumn div,
[data-gcm-root] input, .gcm-font .DialogButton:not([style*="monospace"]), .gcm-font input:not([style*="monospace"]) { font-family: inherit !important; }
.gcm-ghost.gpfocus { background: #dcdedf !important; color: #0e141b !important; }
.gcm-row.gpfocus { background: rgba(255,255,255,.1) !important; }
.DialogContent.gcm-dialog { width: 640px; max-width: 100%; box-sizing: border-box; padding: 28px 32px 24px !important; border-radius: 6px; background: #1f2126 !important; box-shadow: 0 24px 60px rgba(0,0,0,.6); }
.gcm-dialog .DialogInput { height: 46px; box-sizing: border-box; padding: 0 14px !important; border: 1px solid rgba(255,255,255,.14); border-radius: 3px; background: rgba(0,0,0,.35) !important; color: #fff; }
.gcm-dialog .gcm-code .DialogInput { border-color: transparent; background: transparent !important; }
`;
export const PageStyle = () => <style>{pageCss(FONTS[getLanguage()] || FONTS.en)}</style>;

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

export function Button({ primary, ghost, style, className, ...props }: Parameters<typeof DialogButton>[0] & { primary?: boolean; ghost?: boolean }) {
  return <DialogButton {...props} className={[className, ghost && "gcm-ghost"].filter(Boolean).join(" ") || undefined}
    style={{ ...buttonBase, ...(primary ? { background: colors.accent, color: "#fff" } : {}), ...(ghost ? { background: "transparent", color: "#a9b1b8" } : {}), ...style }} />;
}

/** A square icon-only button; `tone="danger"` paints it red. */
export function IconButton({ label, tone, style, children, ...props }: Parameters<typeof DialogButton>[0] & { label: string; tone?: "danger" }) {
  return <DialogButton {...props} aria-label={label} className="gcm-ghost" style={{
    width: 40, minWidth: 40, height: 40, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent", color: tone === "danger" ? colors.danger : "#a9b1b8", ...style,
  }}>{children}</DialogButton>;
}

export interface MenuAction { label: string; onSelect: () => void; tone?: "danger"; disabled?: boolean }

/** Opens the "more actions" menu of a row. */
export function showActions(actions: MenuAction[], target?: EventTarget) {
  showContextMenu(<Menu label="">
    {actions.map(action => <MenuItem key={action.label} tone={action.tone === "danger" ? "destructive" : undefined}
      disabled={action.disabled} onSelected={action.onSelect}>{action.label}</MenuItem>)}
  </Menu>, target ?? window);
}

export function SectionTitle({ children, first }: { children: ReactNode; first?: boolean }) {
  return <div style={{ fontSize: 12, color: colors.muted, fontWeight: 500, padding: `${first ? 2 : 16}px 4px 6px` }}>{children}</div>;
}

export interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  highlight?: boolean;
  disabled?: boolean;
  onActivate?: () => void;
  /** Extra content under the row, e.g. a progress line. */
  footer?: ReactNode;
  /** The row's menu, opened from the trailing button, the Y button or a long press. */
  more?: { label: string; actions: MenuAction[] };
  /** A control placed after the menu button, e.g. a switch. */
  trailing?: ReactNode;
  /** Taller rows for the modifier lists. */
  tall?: boolean;
  /** Title colour; rows that are not the current choice use a softer white. */
  titleColor?: string;
  /** Rows in a grid draw their line underneath instead of on top. */
  lineBelow?: boolean;
}

/** One list row: optional icon, title + description, trailing controls. */
export function Row({ icon, title, description, children, highlight, disabled, onActivate, footer, more, trailing, tall, titleColor, lineBelow }: RowProps) {
  const openMore = more && !disabled ? (target?: EventTarget) => showActions(more.actions, target) : undefined;
  const body = <div style={{ display: "flex", alignItems: "center", gap: 14, padding: tall ? (footer ? "13px 14px 9px" : "13px 14px") : "11px 14px" }}>
    {icon && <span aria-hidden style={{ display: "inline-flex", flex: "0 0 auto" }}>{icon}</span>}
    <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 16, color: titleColor || colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: colors.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{description}</div>}
    </div>
    {(children || more || trailing) && <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 14, flex: "0 0 auto" }}>
      {children}
      {more && <IconButton label={more.label} disabled={disabled} onClick={event => openMore?.(event.currentTarget ?? undefined)}><MoreIcon /></IconButton>}
      {trailing}
    </Focusable>}
  </div>;
  const style: CSSProperties = { [lineBelow ? "borderBottom" : "borderTop"]: `1px solid ${colors.line}`, background: highlight ? colors.surface : undefined, borderRadius: 3, opacity: disabled ? .5 : 1 };
  return <Focusable flow-children="row" className="gcm-row" style={style}
    {...(onActivate && !disabled ? { onActivate, onClick: onActivate } : {})}
    {...(openMore ? {
      onOptionsButton: () => openMore(), onOptionsActionDescription: more!.label,
      onContextMenu: (event: MouseEvent<HTMLDivElement>) => { event.preventDefault(); openMore(event.currentTarget); },
    } : {})}>{body}{footer}</Focusable>;
}

/** A thin progress line under a row; `indent` lines it up with the row's text. */
export function Progress({ percent, label, indent = 14 }: { percent: number; label: string; indent?: number }) {
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    style={{ height: 3, margin: `0 14px 10px ${indent}px`, borderRadius: 2, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
    <div style={{ width: `${percent}%`, height: "100%", background: colors.accent }} /></div>;
}

export function Status({ message, tone }: { message?: string; tone?: "warning" | "danger" }) {
  if (!message) return null;
  return <div role="status" style={{
    margin: "0 0 10px", padding: "8px 12px", borderRadius: 3, fontSize: 13, overflowWrap: "anywhere",
    background: tone === "warning" ? "rgba(245,185,66,.12)" : "rgba(227,91,91,.12)", color: tone === "warning" ? colors.warning : "#ff9b9b",
  }}>{message}</div>;
}

/** The short label of a download job's state. */
export const jobStateLabel = (t: Translations, job: DownloadJob, percent: number) =>
  job.state === "downloading" ? t.downloading(job.total ? percent : null) : job.state === "error" ? t.failed : t[job.state];

export type Owner = "page" | "common" | "modifier" | "other";

/** What Steam receives, with every word coloured by who owns it. */
export function Preview({ t, source, ownerOf }: {
  t: Translations; source: string; ownerOf: (definitionText: string | undefined, name: string | undefined) => Owner;
}) {
  const tone: Record<Owner, string> = { page: colors.accentText, common: "#c49bff", modifier: colors.success, other: "#a9b1b8" };
  const key = (owner: Owner, word: string, meaning: string) => <><span style={{ color: tone[owner] }}>{word}</span> = {meaning}</>;
  const segments = LaunchOptions.parse(LaunchOptions.parse(source).canonical()).segments();
  return <section aria-label={t.steamReceives} style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 4, background: "rgba(0,0,0,.35)", display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, color: colors.muted }}>
      <span>{t.steamReceives}</span>
      <span style={{ whiteSpace: "nowrap" }}>
        {key("page", t.colorBlue, t.legendPage)} · {key("common", t.colorPurple, t.legendCommon)} · {key("modifier", t.colorGreen, t.legendModifier)} · {key("other", t.colorWhite, t.legendOther)}
      </span></div>
    <div style={{ ...mono, lineHeight: 1.6, color: tone.other }}>
      {segments.length ? segments.map((segment, index) => {
        const definition = segment.definition;
        const owner = ownerOf(definition ? renderLaunchOptionDefinition(definition) : undefined, definition?.kind === "environment" ? definition.name : undefined);
        return <span key={index} style={{ color: tone[owner] }}>{index ? " " : ""}{segment.text}</span>;
      }) : t.noLaunchOptions}
    </div>
  </section>;
}
