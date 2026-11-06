import { useEffect, useSyncExternalStore } from "react";
import { CheatEngineStatus, getCheatEngine, manageCheatEngine } from "../utils/backend";

// One copy of the Cheat Engine status, shared by every page: a download
// finishing on one page is reflected on the others.
let current: CheatEngineStatus | undefined;
const listeners = new Set<() => void>();
const publish = (value: CheatEngineStatus) => { current = value; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Reads the status again, e.g. after a download finished. */
export function invalidateCheatEngine() {
  if (listeners.size) void getCheatEngine().then(publish).catch(() => {});
}

export function useCheatEngine() {
  const status = useSyncExternalStore(subscribe, () => current);
  useEffect(() => { void getCheatEngine().then(publish).catch(() => {}); }, []);
  return status;
}

/** Runs one Cheat Engine action and publishes the status it returns. */
export async function changeCheatEngine(action: "link" | "delete" | "language" | "bridge", value = "") {
  const result = await manageCheatEngine(action, value);
  if (result.cheat_engine) publish(result.cheat_engine);
}
