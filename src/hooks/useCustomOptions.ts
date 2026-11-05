import { useEffect, useSyncExternalStore } from "react";
import type { CustomOption } from "../domain/custom";
import { getCustomOptions, saveCustomOptions } from "../utils/backend";

// The saved option list is shared by every game, so one copy serves all pages.
let options: CustomOption[] | undefined;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
const publish = (next: CustomOption[]) => { options = next; listeners.forEach(listener => listener()); };

function load() {
  pending ??= getCustomOptions().then(result => publish(result.options)).finally(() => { pending = undefined; });
  return pending;
}

export async function saveOptions(next: CustomOption[]) {
  publish(await saveCustomOptions(next));
}

export function useCustomOptions() {
  const value = useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => options);
  useEffect(() => { void load().catch(() => {}); }, []);
  return value;
}
