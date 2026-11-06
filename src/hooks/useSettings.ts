import { useEffect, useSyncExternalStore } from "react";
import { getSettings, PluginSettings, setSettings } from "../utils/backend";

// The plugin-wide settings, shared by the settings page and every game page.
let current: PluginSettings | undefined;
const listeners = new Set<() => void>();
const publish = (value: PluginSettings) => { current = value; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, () => current);
  useEffect(() => { void getSettings().then(publish).catch(() => {}); }, []);
  return settings;
}

export async function changeSettings(changes: Partial<PluginSettings>) {
  publish(await setSettings(changes));
}
