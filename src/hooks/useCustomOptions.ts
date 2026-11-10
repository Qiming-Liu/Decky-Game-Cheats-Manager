import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CustomOption, launchContext } from "../domain/custom";
import { LaunchContext } from "../domain/options";
import { getCustomOptions, saveCustomOptions } from "../utils/backend";

// The saved option list is shared by every game, so one copy serves all pages.
let options: CustomOption[] | undefined;
// The user's home directory, so launch options can name paths through `~`.
let home = "";
// Preset launcher files found on the last load; read again whenever a page opens.
let installed: Record<string, boolean> = {};
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
const publish = (next: CustomOption[]) => {
  options = next;
  listeners.forEach(listener => listener());
};

function load() {
  pending ??= getCustomOptions().then(result => {
    home = result.home;
    installed = result.installed;
    publish(result.options);
  }).finally(() => { pending = undefined; });
  return pending;
}

export const publishOptions = (next: CustomOption[]) => publish(next);
/** False when a preset's launcher file is missing (the tool is not installed). */
export const presetInstalled = (preset: string) => installed[preset] !== false;
/** Reads the preset launcher files again, e.g. when a preset is turned on. */
export const checkPresets = () => load();

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

/** How this user's launch options are read: the saved options' commands and the home directory. */
export function useLaunchContext(): LaunchContext {
  const saved = useCustomOptions();
  return useMemo(() => launchContext(saved ?? [], home), [saved]);
}
