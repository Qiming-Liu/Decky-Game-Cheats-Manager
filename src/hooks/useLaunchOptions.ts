import { useCallback, useEffect, useSyncExternalStore } from "react";
import { readLaunchOptions, writeLaunchOptions } from "../domain/steam";

// One copy of each game's launch options shared by every tab of the game page,
// so a change made on one tab is immediately reflected on the others.
interface Snapshot { value?: string; error: string }
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
    const value = await readLaunchOptions(appId);
    if (request === current.request) publish(appId, { value, error: "" });
  } catch (error) {
    if (request === current.request) publish(appId, { value: current.snapshot.value, error: error instanceof Error ? error.message : "unknownError" });
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
  // Re-read whenever a tab opens: other tools may have changed the value.
  useEffect(() => { void load(appId); }, [appId]);

  const update = useCallback(async (edit: (current: string) => string) => {
    const current = store(appId);
    if (current.snapshot.value === undefined) throw new Error("Launch options are not loaded yet.");
    current.request++; // A pending read must not overwrite the value written below.
    try {
      publish(appId, { value: await writeLaunchOptions(appId, current.snapshot.value, edit), error: "" });
    } catch (error) {
      await load(appId);
      throw error;
    }
  }, [appId]);
  return { options: snapshot.value, error: snapshot.error, refresh: () => load(appId), update };
}
