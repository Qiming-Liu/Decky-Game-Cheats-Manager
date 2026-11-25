import timing from "../data/timing.json";
import { Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";
import { getTrainerStatus, type TrainerEvent, type TrainerStatus as Status } from "../utils/backend";
import type { Hint } from "../domain/environment";
import { useTranslations } from "../utils/i18n";
import type { Translations } from "../utils/locales";
import { colors } from "./shell";

interface ProgramState { program: string; pid: number; kind: TrainerEvent["kind"]; label: string; color: string }

// A program that ends cleanly this soon handed its work to another process (Cheat Engine's launcher does).
const HAND_OFF_SECONDS = 5;

/** Each started program's latest state, in start order. */
function programStates(t: Translations, status: Status): ProgramState[] {
  const running = new Set(status.running);
  const states = new Map<string, ProgramState>();
  for (const event of status.events) {
    if (event.kind === "dialog" || event.kind === "handoff" || event.kind === "hold") continue;
    const key = `${event.program}:${event.pid}`;
    if (event.kind === "exit" && Number(event.text.split(" ")[0]) === 0
      && Number(event.text.split(" ")[1]) <= HAND_OFF_SECONDS) {
      states.delete(key);
      continue;
    }
    states.set(key, describe(t, event));
  }
  // A program that is gone without an exit record (killed, or the starter could not follow it).
  for (const state of states.values()) {
    if (["started", "window", "nowindow"].includes(state.kind) && !running.has(state.program.toLowerCase()))
      Object.assign(state, { label: t.trainerGone, color: colors.warning });
  }
  return [...states.values()];
}

function describe(t: Translations, event: TrainerEvent): ProgramState {
  const base = { program: event.program, pid: event.pid, kind: event.kind };
  switch (event.kind) {
    case "started": return { ...base, label: t.trainerStarting, color: colors.muted };
    case "window": return { ...base, label: t.trainerWindow, color: colors.success };
    case "nowindow": return { ...base, label: t.trainerNoWindow(Number(event.text) || 30), color: colors.warning };
    case "failed": return { ...base, label: t.trainerFailed(event.text), color: colors.danger };
    case "exit": {
      const code = event.text.split(" ")[0] || "";
      return Number(code) === 0
        ? { ...base, label: t.trainerClosed, color: colors.muted }
        : { ...base, label: t.trainerCrashed(code), color: colors.danger };
    }
    default: return { ...base, label: t.trainerUnwatched, color: colors.muted };
  }
}

const clock = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * What the running game's trainers did, as the starter saw it: started, a
 * window or none, how they exited, and every message box they showed, with
 * its text. A trainer that reports an error in a box behind the game, or
 * quits, is shown here instead of failing unseen. Nothing is interpreted:
 * a message box reads as the program wrote it. Hints about what the game
 * runs on come first (src/domain/environment.ts).
 */
export default function TrainerStatus({ appId, hints = [] }: { appId: string; hints?: Hint[] }) {
  const t = useTranslations();
  const [status, setStatus] = useState<Status>();
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const result = await getTrainerStatus(appId);
        if (!disposed && result.success && result.known)
          setStatus({ app_id: appId, known: true, events: result.events || [], running: result.running || [] });
      } catch {
        // The backend did not answer; the next poll tries again.
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, timing.trainer_status_poll_ms);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [appId]);
  const programs = status ? programStates(t, status) : [];
  const dialogs = status ? status.events.filter(event => event.kind === "dialog").reverse() : [];
  const hintText: Record<Hint, string> = {
    wineMono: t.hintWineMono, dotnetPrefix: t.hintDotnetPrefix, oldWow64: t.hintOldWow64, brokenMono: t.hintBrokenMono,
    untracked: t.hintUntracked,
  };
  if (!programs.length && !dialogs.length && !hints.length) return null;
  return <PanelSectionRow>
    <Focusable flow-children="column" aria-label={t.trainerStatusTitle} style={{
      boxSizing: "border-box", padding: "12px 14px", borderRadius: 4, background: "rgba(0,0,0,.28)", marginBottom: 14,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{t.trainerStatusTitle}</div>
      {hints.map(hint => <div key={hint} style={{ fontSize: 11, color: colors.warning, overflowWrap: "anywhere" }}>{hintText[hint]}</div>)}
      {programs.map(state => <div key={`${state.program}:${state.pid}`}
        style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
        <span style={{ color: colors.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state.program}</span>
        <span style={{ color: state.color, flex: "0 0 auto" }}>{state.label}</span>
      </div>)}
      {dialogs.map(dialog => {
        const [title, ...lines] = dialog.text.split("\n");
        // Focusable so a long message can be scrolled to with the controller.
        return <Focusable key={`${dialog.time}:${dialog.pid}:${title}`} className="gcm-row" onActivate={() => {}}
          style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px", borderRadius: 4,
            background: "rgba(245,185,66,.08)", borderLeft: `2px solid ${colors.warning}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <span style={{ color: colors.warning, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title || t.trainerMessage}</span>
            <span style={{ color: colors.dim, flex: "0 0 auto" }}>{clock(dialog.time)}</span>
          </div>
          <div style={{ color: colors.muted, fontSize: 11, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {dialog.program} · {lines.join("\n").trim().slice(0, 800)}</div>
        </Focusable>;
      })}
    </Focusable>
  </PanelSectionRow>;
}
