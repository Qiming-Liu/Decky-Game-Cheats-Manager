import { Focusable, Menu, MenuItem, showContextMenu } from "@decky/ui";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { MoreIcon } from "../icons";
import { IconButton } from "./buttons";
import { colors } from "./theme";

export interface MenuAction { label: string; onSelect: () => void; tone?: "danger"; disabled?: boolean }

/** Opens the "more actions" menu of a row. */
export function showActions(actions: MenuAction[], target?: EventTarget) {
  showContextMenu(<Menu label="">
    {actions.map(action => <MenuItem key={action.label} tone={action.tone === "danger" ? "destructive" : undefined}
      disabled={action.disabled} onSelected={action.onSelect}>{action.label}</MenuItem>)}
  </Menu>, target ?? window);
}

/** A section's small heading; `top` overrides the space above it. */
export function SectionTitle({ children, first, top }: { children: ReactNode; first?: boolean; top?: number }) {
  return <div style={{ fontSize: 12, color: colors.muted, fontWeight: 500, padding: `${top ?? (first ? 2 : 16)}px 4px 6px` }}>{children}</div>;
}

export interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  highlight?: boolean;
  disabled?: boolean;
  onActivate?: () => void;
  /** Non-interactive content at the row's end, inside the part that is pressed. */
  aside?: ReactNode;
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
  /** An opened row, e.g. a trainer showing its programs. */
  open?: boolean;
  /** Vertical padding that shrinks with the screen height, so a settings page fits. */
  dense?: boolean;
}

/** One list row: optional icon, title + description, trailing controls. */
export function Row({ icon, title, description, children, aside, highlight, disabled, onActivate, footer, more, trailing, tall, titleColor, lineBelow, open, dense }: RowProps) {
  const openMore = more && !disabled ? (target?: EventTarget) => showActions(more.actions, target) : undefined;
  const controls = children || more || trailing;
  const [top, bottom] = dense ? ["clamp(4px, 1.2vh, 11px)", "clamp(4px, 1.2vh, 11px)"]
    : (tall ? [13, footer ? 9 : 13] : [11, 11]).map(value => `${value}px`);
  const main = <>
    {icon && <span aria-hidden style={{ display: "inline-flex", flex: "0 0 auto" }}>{icon}</span>}
    <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 16, color: titleColor || colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: colors.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{description}</div>}
    </div>
    {aside}
  </>;
  // A controller cannot move from a focused element into its children, so a
  // row that is pressed itself keeps its text in its own focusable part and
  // its buttons beside it, each reachable with left and right.
  const mainStyle: CSSProperties = { flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 14, padding: `${top} 14px ${bottom}` };
  const body = <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 14, paddingRight: controls ? 14 : 0 }}>
    {onActivate && !disabled ? <Focusable onActivate={onActivate} style={mainStyle}>{main}</Focusable> : <div style={mainStyle}>{main}</div>}
    {controls && <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 14, flex: "0 0 auto" }}>
      {children}
      {more && <IconButton label={more.label} disabled={disabled} onClick={event => openMore?.(event.currentTarget ?? undefined)}><MoreIcon /></IconButton>}
      {trailing}
    </Focusable>}
  </Focusable>;
  const style: CSSProperties = {
    [lineBelow ? "borderBottom" : "borderTop"]: `1px solid ${colors.line}`, background: open ? "#1b2838" : highlight ? colors.surface : undefined,
    borderRadius: open ? 4 : 3, boxShadow: open ? "inset 0 0 0 1px rgba(124,196,255,.35)" : undefined, opacity: disabled ? .5 : 1,
  };
  return <Focusable flow-children="column" className="gcm-row" style={style}
    {...(openMore ? {
      onOptionsButton: () => openMore(), onOptionsActionDescription: more!.label,
      onContextMenu: (event: MouseEvent<HTMLDivElement>) => { event.preventDefault(); openMore(event.currentTarget); },
    } : {})}>{body}{footer}</Focusable>;
}
