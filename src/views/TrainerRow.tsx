import { Focusable } from "@decky/ui";
import { CSSProperties, ReactNode } from "react";

export const actionButtonStyle: CSSProperties = {
  width: 120, minWidth: 120, height: 40, padding: "0 8px", flex: "0 0 120px",
  boxSizing: "border-box", fontSize: 14,
};

export default function TrainerRow({ children }: { children: ReactNode }) {
  return <Focusable flow-children="row" style={{
    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
    background: "#23262e", borderRadius: 2, marginBottom: 6,
  }}>{children}</Focusable>;
}

export function TrainerName({ children }: { children: ReactNode }) {
  return <div style={{ flex: "1 1 0", minWidth: 0, overflowWrap: "anywhere", fontSize: 16 }}>{children}</div>;
}
