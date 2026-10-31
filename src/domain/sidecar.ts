// Launch-option editing adapted from CheatDeck (GPL-3.0).
import { LaunchOptions, LaunchOptionDefinition } from "./options";
import { parseLiteralWord } from "./parser";

const command = "PROTON_REMOTE_DEBUG_CMD";
const filesystem = "PRESSURE_VESSEL_FILESYSTEMS_RW";
const environment = (name: string, value: string): LaunchOptionDefinition => ({ kind: "environment", name, value });
export const sidecarPath = (source: string) => {
  const value = LaunchOptions.parse(source).getEnvironment(command);
  return value === undefined ? undefined : parseLiteralWord(value);
};
export function editSidecar(source: string, path?: string): string {
  const options = LaunchOptions.parse(source);
  if (!options.editable) throw new Error("These launch options cannot be edited safely. Review them in Steam Properties.");
  if (options.hasEnvironment(filesystem) && options.getEnvironment(filesystem) === undefined)
    throw new Error("The shared-folder setting contains a dynamic value and cannot be edited safely.");
  const edits: Parameters<LaunchOptions["edit"]>[0][number][] = [
    { kind: "disable", definition: environment(command, "") },
  ];
  if (path) {
    if (!path.startsWith("/") || /[\x00-\x1f:]/.test(path)) throw new Error("Choose a valid absolute Linux program path without colons.");
    const directory = path.slice(0, path.lastIndexOf("/")) || "/";
    const existing = options.getEnvironment(filesystem);
    const directories = existing ? existing.split(":") : [];
    if (!directories.includes(directory)) directories.push(directory);
    edits.push({ kind: "enable", definition: environment(command, `'${path.split("'").join(`'"'"'`)}'`) });
    edits.push({ kind: "enable", definition: environment(filesystem, directories.join(":")) });
  }
  // Keep shared directories on disable: another launch tool may also use them.
  const result = options.edit(edits);
  if (!result.ok) throw new Error("Could not update launch options safely.");
  return result.value.toString();
}

export function readLaunchOptions(appId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let subscription: { unregister: () => void } | undefined;
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true; subscription?.unregister(); reject(new Error("Steam did not return the game's launch options."));
    }, 5000);
    try {
      subscription = SteamClient.Apps.RegisterForAppDetails(Number(appId), details => {
        if (settled || details?.strLaunchOptions === undefined) return;
        settled = true; window.clearTimeout(timer); subscription?.unregister(); resolve(details.strLaunchOptions);
      });
      if (settled) subscription.unregister();
    } catch (error) {
      settled = true; window.clearTimeout(timer); subscription?.unregister(); reject(error);
    }
  });
}

export async function saveSidecar(appId: string, expected: string, path?: string) {
  const current = await readLaunchOptions(appId);
  if (current !== expected) throw new Error("Launch options changed elsewhere. Refresh this page and try again.");
  const next = editSidecar(current, path);
  SteamClient.Apps.SetAppLaunchOptions(Number(appId), next);
  // Confirm Steam has published the write before reporting success.
  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = await readLaunchOptions(appId);
    if (saved === next) return saved;
    await new Promise(resolve => window.setTimeout(resolve, 200));
  }
  throw new Error("Steam has not confirmed the change. Refresh before trying again.");
}
