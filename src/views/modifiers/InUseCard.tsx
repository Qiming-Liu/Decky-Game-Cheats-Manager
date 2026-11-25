import { Focusable } from "@decky/ui";
import { useTranslations } from "../../utils/i18n";
import { Badge, Button, colors } from "../shell";
import { AlertCircleIcon, LinkIcon, StopIcon } from "../icons";

/** A red warning, optionally with the button that resolves it. */
export type Alert = string | { text: string; action: { label: string; onClick: () => void } };

/**
 * What starts with the game, with the button that stops it, and the red
 * warnings: joined under the card, or on their own when nothing is in use.
 */
export function InUseCard({ count, names, viaCheatEngine, hints = [], alerts, busy, onClear }: {
  /** How many programs start with the game; the card shows only when there are some. */
  count: number;
  /** The trainers in use, already joined for the reader's language. */
  names: string;
  /** The "through Cheat Engine" note, or "" when no table is in use. */
  viaCheatEngine: string;
  /** What the game runs on may stop trainers: a hint, shown under the names. */
  hints?: readonly string[];
  alerts: readonly Alert[]; busy: boolean; onClear: () => void;
}) {
  const t = useTranslations();
  const warned = alerts.length > 0;
  return <>
    {count > 0 && <Focusable flow-children="row" aria-label={t.runsWithGame} style={{
      display: "flex", alignItems: "center", gap: 14, padding: "12px 12px 12px 14px", marginBottom: warned ? 0 : 16,
      borderRadius: warned ? "6px 6px 0 0" : 6, background: "#1b2838",
      border: `1px solid ${warned ? "rgba(227,91,91,.6)" : "rgba(124,196,255,.25)"}`,
    }}>
      <span aria-hidden style={{
        display: "inline-flex", width: 40, height: 40, flex: "0 0 40px", borderRadius: 8, background: "rgba(26,159,255,.18)",
        color: colors.accentText, alignItems: "center", justifyContent: "center",
      }}><LinkIcon size={20} /></span>
      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, fontSize: 16, fontWeight: 500, color: colors.text }}>
          <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{names}</span>
          {count > 1 && <span style={{ flex: "0 0 auto", fontSize: 14, fontWeight: 400, color: colors.accentText }}>{t.moreCount(count)}</span>}
        </div>
        <div style={{ fontSize: 12, color: colors.muted }}>
          <span style={{ color: colors.accentText }}>{t.runsWithGame}</span>
          {viaCheatEngine && ` · ${viaCheatEngine}`} · {t.switchWindowHint}</div>
        {hints.map(hint => <div key={hint} style={{ fontSize: 12, color: colors.warning }}>{hint}</div>)}
      </div>
      <Button disabled={busy} onClick={onClear}
        onOptionsButton={() => { if (!busy) onClear(); }} onOptionsActionDescription={count > 1 ? t.stopAll : t.stopUsing}>
        <StopIcon size={14} />{count > 1 ? t.stopAll : t.stopUsing}<Badge button="Y" /></Button>
    </Focusable>}
    {warned && <div role="alert" style={{
      display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", marginBottom: 16,
      borderRadius: count > 0 ? "0 0 6px 6px" : 6, background: "rgba(227,91,91,.16)",
      border: "1px solid rgba(227,91,91,.6)", ...(count > 0 ? { borderTop: 0 } : {}), color: "#ff9b9b", fontSize: 13,
    }}>{alerts.map(alert => {
      const text = typeof alert === "string" ? alert : alert.text;
      return <Focusable key={text} flow-children="row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <AlertCircleIcon size={18} color={colors.danger} /><span style={{ flex: "1 1 auto" }}>{text}</span>
        {typeof alert !== "string" && <Button style={{ height: 30, padding: "0 12px", fontSize: 12 }} disabled={busy}
          onClick={alert.action.onClick}>{alert.action.label}</Button>}
      </Focusable>;
    })}</div>}
  </>;
}
