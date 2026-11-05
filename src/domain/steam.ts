import { LaunchOptions } from "./options";

// Steam's EAppType value for non-Steam shortcuts.
const SHORTCUT_APP_TYPE = 1073741824;

export function isShortcut(appId: string): boolean {
  return typeof appStore !== "undefined" && appStore?.GetAppOverviewByAppID?.(Number(appId))?.app_type === SHORTCUT_APP_TYPE;
}

export function readLaunchOptions(appId: string): Promise<string> {
  const shortcut = isShortcut(appId);
  return new Promise((resolve, reject) => {
    let subscription: { unregister: () => void } | undefined;
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true; subscription?.unregister(); reject(new Error("Steam did not return the game's launch options."));
    }, 5000);
    try {
      subscription = SteamClient.Apps.RegisterForAppDetails(Number(appId), details => {
        const value = shortcut ? details?.strShortcutLaunchOptions : details?.strLaunchOptions;
        if (settled || value === undefined) return;
        settled = true; window.clearTimeout(timer); subscription?.unregister(); resolve(value);
      });
      if (settled) subscription.unregister();
    } catch (error) {
      settled = true; window.clearTimeout(timer); subscription?.unregister(); reject(error);
    }
  });
}

/**
 * Applies `edit` to the launch options Steam currently has, provided they still
 * match what the page displayed. Environment assignments are always written in
 * canonical (sorted) order. Resolves with the value Steam confirmed.
 */
export async function writeLaunchOptions(appId: string, expected: string, edit: (current: string) => string): Promise<string> {
  const current = await readLaunchOptions(appId);
  if (current !== expected) throw new Error("Launch options changed elsewhere. Refresh this page and try again.");
  const next = LaunchOptions.parse(edit(current)).canonical();
  if (next === current) return current;
  if (isShortcut(appId)) SteamClient.Apps.SetShortcutLaunchOptions(Number(appId), next);
  else SteamClient.Apps.SetAppLaunchOptions(Number(appId), next);
  // Confirm Steam has published the write before reporting success.
  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = await readLaunchOptions(appId);
    if (saved === next) return saved;
    await new Promise(resolve => window.setTimeout(resolve, 200));
  }
  throw new Error("Steam has not confirmed the change. Refresh before trying again.");
}
