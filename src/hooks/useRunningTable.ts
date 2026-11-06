import { Router } from "@decky/ui";
import { useEffect, useState } from "react";
import { isTable, launcherPrograms, sidecarPath } from "../domain/sidecar";
import { readLaunchOptions } from "../domain/steam";
import { getLauncher } from "../utils/backend";

export interface RunningTable { appId: string; name: string; table: string }

/**
 * The table the running game opened through the launcher, if any: the Quick
 * Access panel shows its switches. Steam has no event for this, so the running
 * game is checked every two seconds while the panel is mounted. (The in-game
 * overlay has its own Quick Access window, whose visibility Decky's hook does
 * not report, so mounting is the only signal.)
 */
export function useRunningTable(): RunningTable | undefined {
  const [running, setRunning] = useState<RunningTable>();
  useEffect(() => {
    let disposed = false;
    let lastAppId = "";
    const check = async () => {
      const app = Router.MainRunningApp;
      const appId = app ? String(app.appid) : "";
      if (appId === lastAppId) return;
      try {
        if (!appId) { lastAppId = ""; setRunning(undefined); return; }
        const [options, launcher] = await Promise.all([readLaunchOptions(appId), getLauncher()]);
        if (disposed) return;
        const table = launcherPrograms(sidecarPath(options), launcher.path).find(isTable);
        lastAppId = appId;
        setRunning(table ? { appId, name: app?.display_name || "", table } : undefined);
      } catch {
        // Steam did not answer; the next check tries again.
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  return running;
}
