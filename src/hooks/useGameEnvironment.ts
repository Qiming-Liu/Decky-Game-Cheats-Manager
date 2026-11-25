import timing from "../data/timing.json";
import { useEffect, useState } from "react";
import type { EnvironmentFacts } from "../domain/environment";
import { getGameEnvironment } from "../utils/backend";

/**
 * What the game runs on, read while a view shows it: once, and while
 * `running`, again every few seconds (a game loads its runtime after it
 * starts). Released on unmount.
 */
export function useGameEnvironment(appId: string | undefined, programs: string[], exe = "", running = false): EnvironmentFacts {
  const [facts, setFacts] = useState<EnvironmentFacts>({});
  const key = programs.join("\n");
  useEffect(() => {
    if (!appId) { setFacts({}); return; }
    let disposed = false;
    const read = async () => {
      try {
        const result = await getGameEnvironment(appId, programs, exe);
        if (!disposed && result.success) setFacts({ prelaunch: result.prelaunch, runtime: result.runtime });
      } catch {
        // The backend did not answer; a later read tries again.
      }
    };
    void read();
    const timer = running ? window.setInterval(() => { void read(); }, timing.game_environment_poll_ms) : 0;
    return () => { disposed = true; if (timer) window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, key, exe, running]);
  return facts;
}
