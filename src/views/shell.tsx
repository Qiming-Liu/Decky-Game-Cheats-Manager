import { DialogButton, Focusable } from "@decky/ui";
import { CSSProperties, ReactNode } from "react";
import { LaunchOptions, renderLaunchOptionDefinition } from "../domain/options";
import { DownloadJob } from "../utils/backend";
import { Translations } from "../utils/locales";

// Shared building blocks of the game page: one row style, one header style
// and one launch-option preview for every tab.

export const colors = {
  text: "#ffffff", muted: "#8b929a", dim: "#6b7480", accent: "#1a9fff", accentText: "#7cc4ff",
  warning: "#f5b942", danger: "#e35b5b", success: "#8ee06f", surface: "rgba(255,255,255,.04)",
  line: "rgba(255,255,255,.08)", button: "#3d4450",
} as const;

export const mono: CSSProperties = { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, overflowWrap: "anywhere" };
export const iconStyle = { marginRight: 8, verticalAlign: -2 } as const;
const buttonBase: CSSProperties = { width: "auto", minWidth: 0, height: 40, padding: "0 16px", fontSize: 14, whiteSpace: "nowrap" };

export function PageHeader({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
    <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "baseline", gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text, whiteSpace: "nowrap" }}>{title}</h1>
      {note && <span style={{ fontSize: 12, color: colors.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</span>}
    </div>
    {children}
  </Focusable>;
}

export function Button({ primary, style, ...props }: Parameters<typeof DialogButton>[0] & { primary?: boolean }) {
  return <DialogButton {...props} style={{ ...buttonBase, ...(primary ? { background: colors.accent, color: "#fff" } : {}), ...style }} />;
}

/** A square icon-only button; `tone="danger"` paints it red. */
export function IconButton({ label, tone, style, children, ...props }: Parameters<typeof DialogButton>[0] & { label: string; tone?: "danger" }) {
  return <DialogButton {...props} aria-label={label} style={{
    width: 40, minWidth: 40, height: 40, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent", color: tone === "danger" ? colors.danger : "#a9b1b8", ...style,
  }}>{children}</DialogButton>;
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
}

/** One list row: optional icon, title + description, trailing controls. */
export function Row({ icon, title, description, children, highlight, disabled, onActivate, footer }: RowProps) {
  const body = <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 14px" }}>
    {icon && <span aria-hidden style={{ display: "inline-flex", flex: "0 0 auto", fontSize: 18 }}>{icon}</span>}
    <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 16, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: colors.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{description}</div>}
    </div>
    {children && <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>{children}</Focusable>}
  </div>;
  const style: CSSProperties = { borderTop: `1px solid ${colors.line}`, background: highlight ? colors.surface : undefined, borderRadius: 3, opacity: disabled ? .5 : 1 };
  return <Focusable flow-children="row" style={style}
    {...(onActivate && !disabled ? { onActivate, onClick: onActivate } : {})}>{body}{footer}</Focusable>;
}

export function Progress({ percent, label }: { percent: number; label: string }) {
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    style={{ height: 3, margin: "0 14px 10px 14px", borderRadius: 2, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
    <div style={{ width: `${percent}%`, height: "100%", background: colors.accent }} /></div>;
}

export function Status({ message, tone }: { message?: string; tone?: "warning" | "danger" }) {
  if (!message) return null;
  return <div role="status" style={{
    margin: "0 0 10px", padding: "8px 12px", borderRadius: 3, fontSize: 13, overflowWrap: "anywhere",
    background: tone === "warning" ? "rgba(245,185,66,.12)" : "rgba(227,91,91,.12)", color: tone === "warning" ? colors.warning : "#ff9b9b",
  }}>{message}</div>;
}

export const chip = (text: ReactNode, color = colors.accentText, background = "rgba(26,159,255,.18)") =>
  <span style={{ fontSize: 12, color, background, padding: "3px 10px", borderRadius: 10, whiteSpace: "nowrap" }}>{text}</span>;

/** The short label of a download job's state. */
export const jobStateLabel = (t: Translations, job: DownloadJob, percent: number) =>
  job.state === "downloading" ? t.downloading(job.total ? percent : null) : job.state === "error" ? t.failed : t[job.state];

export type Owner = "page" | "modifier" | "other";

/** What Steam receives, with every word coloured by who owns it. */
export function Preview({ t, source, ownerOf, legend }: {
  t: Translations; source: string; ownerOf: (definitionText: string | undefined, name: string | undefined) => Owner; legend: string;
}) {
  const segments = LaunchOptions.parse(LaunchOptions.parse(source).canonical()).segments();
  const tone: Record<Owner, string> = { page: colors.accentText, modifier: colors.success, other: "#a9b1b8" };
  return <section aria-label={t.steamReceives} style={{ marginTop: 12, padding: "10px 14px", borderRadius: 4, background: "rgba(0,0,0,.35)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, color: colors.muted, marginBottom: 4 }}>
      <span>{t.steamReceives}</span><span style={{ whiteSpace: "nowrap" }}>{legend}</span></div>
    <div style={{ ...mono, lineHeight: 1.6, color: tone.other }}>
      {segments.length ? segments.map((segment, index) => {
        const definition = segment.definition;
        const owner = ownerOf(definition ? renderLaunchOptionDefinition(definition) : undefined, definition?.kind === "environment" ? definition.name : undefined);
        return <span key={index} style={{ color: tone[owner] }}>{index ? " " : ""}{segment.text}</span>;
      }) : t.noLaunchOptions}
    </div>
  </section>;
}
