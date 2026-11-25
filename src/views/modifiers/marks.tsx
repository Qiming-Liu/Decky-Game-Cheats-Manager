import { colors } from "../shell";
import { CheckIcon, LinkIcon } from "../icons";

/** The compact button the trainer list uses in its rows. */
export const small = { height: 36, padding: "0 14px", fontSize: 13 } as const;

/** Marks a trainer in use: a solid blue disc with the "starts with the game" link. */
export const InUseBadge = ({ label }: { label: string }) =>
  <span role="img" aria-label={label} title={label} style={{
    display: "inline-flex", width: 30, height: 30, flex: "0 0 30px", borderRadius: 15, background: colors.accent, color: "#fff",
    alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 3px rgba(26,159,255,.25)",
  }}><LinkIcon size={16} width={2.6} /></span>;

/** A ticked box: a selected trainer when several may run. */
export const CheckedBox = ({ label }: { label: string }) =>
  <span role="img" aria-label={label} style={{
    display: "inline-flex", width: 20, height: 20, flex: "0 0 20px", borderRadius: 5, background: colors.accent, color: "#fff",
    alignItems: "center", justifyContent: "center",
  }}><CheckIcon size={14} width={3.2} /></span>;
