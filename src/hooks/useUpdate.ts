import { useEffect, useSyncExternalStore } from "react";
import { getUpdate, UpdateInfo } from "../utils/backend";

// One shared answer for the Quick Access title, the plugin icon and the game
// page. The backend asks GitHub at most once a week and never fails loudly, so
// asking it whenever a view mounts is cheap.

export const REPOSITORY_URL = "https://github.com/Qiming-Liu/Decky-Game-Cheats-Manager";
export const RELEASE_URL = `${REPOSITORY_URL}/releases/latest`;

let info: UpdateInfo = { current: "", latest: "" };
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

export function refreshUpdate(): Promise<void> {
  pending ??= getUpdate().then(next => {
    if (next && (next.current !== info.current || next.latest !== info.latest)) {
      info = { current: next.current || "", latest: next.latest || "" };
      listeners.forEach(listener => listener());
    }
  }).catch(() => {}).finally(() => { pending = undefined; });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useUpdate(): UpdateInfo {
  const value = useSyncExternalStore(subscribe, () => info);
  useEffect(() => { void refreshUpdate(); }, []);
  return value;
}
