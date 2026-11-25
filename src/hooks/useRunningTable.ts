import timing from "../data/timing.json";
import { Router } from "@decky/ui";
import { useEffect, useState } from "react";
import { isTable, launcherPrograms, trainerCommand } from "../domain/trainerCommand";
import { readLaunchOptions } from "../domain/steam";
import { getLauncher, getTrainerStatus } from "../utils/backend";

/** A running game that started trainers through the launcher, and the table among them, if any. */
export interface RunningGame {
  appId: string; name: string; programs: string[]; table?: string;
  /** Steam does not report the game as running; the backend named it from its running trainers. */
  untracked?: boolean;
}
export interface RunningTable extends RunningGame { table: string }

/**
 * The running game whose launch options start trainers: the Quick Access
 * panel shows how they are doing, and a table's switches. Steam has no event
 * for this, so the running game is checked every two seconds while the panel
 * is mounted. (The in-game overlay has its own Quick Access window, whose
 * visibility Decky's hook does not report, so mounting is the only signal.)
 * A game whose own Steam ID differs from its shortcut's is not reported by
 * Steam at all; then the backend names the latest game whose trainers run.
 */
export function useRunningGame(): RunningGame | undefined {
  const [running, setRunning] = useState<RunningGame>();
  useEffect(() => {
    let disposed = false;
    let lastAppId = "";
    const check = async () => {
      const app = Router.MainRunningApp;
      const appId = app ? String(app.appid) : "";
      if (appId && appId === lastAppId) return;
      try {
        let programs: string[] = [];
        if (appId) {
          const [options, launcher] = await Promise.all([readLaunchOptions(appId), getLauncher()]);
          if (disposed) return;
          programs = launcherPrograms(trainerCommand(options, launcher.home), launcher.path, ...launcher.legacy);
        }
        if (programs.length) {
          lastAppId = appId;
          setRunning({ appId, name: app?.display_name || "", programs, table: programs.find(isTable) });
          return;
        }
        // Steam reports no game, or one that starts no trainers: a game that
        // reports another Steam ID than its shortcut's. The backend names the
        // latest game whose trainers run.
        lastAppId = "";
        const status = await getTrainerStatus("");
        if (disposed) return;
        const found = status.success && status.known && status.running?.length ? status.programs || [] : [];
        setRunning(previous => found.length && status.app_id
          ? previous?.appId === status.app_id ? previous
            : { appId: status.app_id, name: "", programs: found, table: found.find(isTable), untracked: true }
          : undefined);
      } catch {
        // Steam or the backend did not answer; the next check tries again.
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, timing.running_table_poll_ms);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  return running;
}
