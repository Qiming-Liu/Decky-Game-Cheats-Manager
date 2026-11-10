import { useCallback, useEffect, useSyncExternalStore } from "react";
import { isUnsupportedLauncher, readLaunchDetails, writeLaunchOptions } from "../domain/steam";
import { logFrontend, logUserAction } from "../utils/backend";
import { useSettings } from "./useSettings";

// One copy of each game's launch options shared by every tab of the game page,
// so a change made on one tab is immediately reflected on the others.
interface Snapshot { value?: string; command?: string; error: string }
interface Store { snapshot: Snapshot; listeners: Set<() => void>; request: number }

const stores = new Map<string, Store>();
const empty: Snapshot = { error: "" };

function store(appId: string): Store {
  let current = stores.get(appId);
  if (!current) stores.set(appId, current = { snapshot: empty, listeners: new Set(), request: 0 });
  return current;
}

function publish(appId: string, snapshot: Snapshot) {
  const current = store(appId);
  current.snapshot = snapshot;
  current.listeners.forEach(listener => listener());
}

async function load(appId: string) {
  const current = store(appId);
  const request = ++current.request;
  try {
    const { options: value, command } = await readLaunchDetails(appId);
    if (request === current.request) publish(appId, { value, command, error: "" });
  } catch (error) {
    logFrontend("error", `Reading launch options of app ${appId} failed`, error);
    if (request === current.request) publish(appId, { ...current.snapshot, error: error instanceof Error ? error.message : "unknownError" });
  }
}

export function useLaunchOptions(appId: string) {
  const subscribe = useCallback((listener: () => void) => {
    const current = store(appId);
    current.listeners.add(listener);
    return () => {
      current.listeners.delete(listener);
      if (!current.listeners.size) stores.delete(appId);
    };
  }, [appId]);
  const snapshot = useSyncExternalStore(subscribe, () => store(appId).snapshot);
  const settings = useSettings();
  // Games started by a Flatpak or AppImage launcher are left alone unless the
  // user chose to skip this check.
  const blocked = isUnsupportedLauncher(snapshot.command) && settings?.skip_launcher_check !== true;
  // Re-read whenever a tab opens: other tools may have changed the value.
  useEffect(() => { void load(appId); }, [appId]);

  /** Edits the launch options; `action` says what the user did, for the log ("Turn X on"). */
  const update = useCallback(async (edit: (current: string) => string, action: string) => {
    const described = `${action} for app ${appId}`;
    const current = store(appId);
    try {
      if (current.snapshot.value === undefined) throw new Error("Launch options are not loaded yet.");
      if (blocked) throw new Error("unsupported_launcher");
    } catch (error) {
      logUserAction(described, error);
      throw error;
    }
    current.request++; // A pending read must not overwrite the value written below.
    try {
      publish(appId, { ...current.snapshot, value: await writeLaunchOptions(appId, current.snapshot.value, edit), error: "" });
    } catch (error) {
      logUserAction(described, error);
      await load(appId);
      throw error;
    }
    logUserAction(described);
  }, [appId, blocked]);
  return { options: snapshot.value, error: snapshot.error, blocked, refresh: () => load(appId), update };
}
