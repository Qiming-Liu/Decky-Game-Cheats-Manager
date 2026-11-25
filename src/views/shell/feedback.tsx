import { DialogButton } from "@decky/ui";
import { type ReactNode, useState } from "react";
import type { DownloadJob } from "../../utils/backend";
import type { Translations } from "../../utils/locales";
import { ChevronDownIcon, ChevronUpIcon } from "../icons";
import { buttonBase, colors } from "./theme";

/** A closed note that opens in place; the header is a button so a controller can reach it. */
export function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div style={{ marginTop: 12 }}>
    <DialogButton className="gcm-ghost" aria-expanded={open} onClick={() => setOpen(!open)} style={{
      ...buttonBase, width: "100%", height: 36, justifyContent: "flex-start", padding: "0 10px", gap: 8,
      background: "transparent", color: colors.muted, fontSize: 13,
    }}>{open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}<span>{title}</span></DialogButton>
    {open && <div style={{ padding: "4px 12px 0 34px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, lineHeight: 1.5, color: "#a9b1b8" }}>
      {children}</div>}
  </div>;
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
