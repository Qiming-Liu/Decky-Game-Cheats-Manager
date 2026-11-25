import { DialogButton } from "@decky/ui";
import { buttonBase, colors } from "./theme";

export function Button({ primary, ghost, style, className, ...props }: Parameters<typeof DialogButton>[0] & { primary?: boolean; ghost?: boolean }) {
  // A coloured background hides Steam's focus colour, so those buttons get their own.
  const solid = !ghost && (primary || style?.background !== undefined);
  return <DialogButton {...props} className={[className, ghost && "gcm-ghost", solid && "gcm-solid"].filter(Boolean).join(" ") || undefined}
    style={{ ...buttonBase, ...(primary ? { background: colors.accent, color: "#fff" } : {}), ...(ghost ? { background: "transparent", color: "#a9b1b8" } : {}), ...style }} />;
}

/** A gamepad button badge drawn inside a button, so the shortcut is visible. */
export const Badge = ({ button, dark }: { button: string; dark?: boolean }) =>
  <span aria-hidden style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 10,
    background: dark ? "rgba(14,20,27,.85)" : "#a9b1b8", color: dark ? "#fff" : "#0e141b", fontSize: 12, fontWeight: 700,
  }}>{button}</span>;

/** A square icon-only button; `tone="danger"` paints it red. */
export function IconButton({ label, tone, style, children, ...props }: Parameters<typeof DialogButton>[0] & { label: string; tone?: "danger" }) {
  return <DialogButton {...props} aria-label={label} className="gcm-ghost" style={{
    width: 40, minWidth: 40, height: 40, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent", color: tone === "danger" ? colors.danger : "#a9b1b8", ...style,
  }}>{children}</DialogButton>;
}
