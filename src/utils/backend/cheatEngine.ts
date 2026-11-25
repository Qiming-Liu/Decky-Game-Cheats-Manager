// The shared Cheat Engine.
import { callable } from "@decky/api";
import type { DownloadJob } from "./catalog";

export interface CheatEngineStatus {
  installed: boolean;
  /** The Cheat Engine.exe path. */
  path: string;
  folder: string;
  version: string;
  /** The plugin's autorun script is in place. */
  bridge: boolean;
}
export const getCheatEngine = callable<[], CheatEngineStatus>("get_cheat_engine");
const manageCheatEngineCall = callable<[action: string],
  { success: boolean; error?: string; job?: DownloadJob; cheat_engine?: CheatEngineStatus }>("manage_cheat_engine");
/** "download" does nothing when Cheat Engine is installed; "reinstall" downloads it again in its place. */
export async function manageCheatEngine(action: "download" | "reinstall" | "delete" | "bridge") {
  const result = await manageCheatEngineCall(action);
  if (!result.success) throw new Error(result.error || "unknownError");
  return result;
}
