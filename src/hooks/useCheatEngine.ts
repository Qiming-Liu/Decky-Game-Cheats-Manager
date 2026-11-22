import { useEffect, useSyncExternalStore } from "react";
import { CheatEngineStatus, getCheatEngine, logFrontend, manageCheatEngine } from "../utils/backend";

// One copy of the Cheat Engine status, shared by every page: a download
// finishing on one page is reflected on the others.
let current: CheatEngineStatus | undefined;
const listeners = new Set<() => void>();
const publish = (value: CheatEngineStatus) => { current = value; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Reads the status from the backend and shares it. */
export async function readCheatEngine(): Promise<CheatEngineStatus> {
  const status = await getCheatEngine();
  publish(status);
  return status;
}
const refresh = () => { void readCheatEngine().catch(error => logFrontend("warning", "Reading the Cheat Engine status failed", error)); };

/** Reads the status again, e.g. after a download finished. */
export function invalidateCheatEngine() {
  if (listeners.size) refresh();
}

/** The shared status; undefined until it has been read. Only tables need it. */
export function useCheatEngine() {
  const status = useSyncExternalStore(subscribe, () => current);
  useEffect(refresh, []);
  return status;
}

/**
 * Downloads Cheat Engine unless it is installed (or again, to reinstall it)
 * and returns the download job, if one was started.
 */
export async function downloadCheatEngine(reinstall = false) {
  const result = await manageCheatEngine(reinstall ? "reinstall" : "download");
  if (result.cheat_engine) publish(result.cheat_engine);
  return result.job;
}

/** Runs one Cheat Engine action and publishes the status it returns. */
export async function changeCheatEngine(action: "delete" | "bridge") {
  const result = await manageCheatEngine(action);
  if (result.cheat_engine) publish(result.cheat_engine);
}
