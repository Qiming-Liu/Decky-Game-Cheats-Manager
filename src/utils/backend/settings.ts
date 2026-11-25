// Plugin settings, the launcher script, saved launch options and the About page.
import { callable } from "@decky/api";
import settingsData from "../../../py_modules/data/settings.json";
import type { CustomOption } from "../../domain/custom";

export interface PluginSettings {
  allow_multiple: boolean; auto_attach: boolean; launch_delay: number; skip_launcher_check: boolean;
  /** Write PROTON_LOG=1 next to a trainer command; on by default in test builds. */
  proton_log: boolean;
}
/** Seconds a game may run before its trainers start; the backend accepts the same list. */
export const LAUNCH_DELAYS: readonly number[] = settingsData.launch_delays;
export const getSettings = callable<[], PluginSettings>("get_settings");
const setSettingsCall = callable<[changes: Partial<PluginSettings>], { success: boolean; error?: string; settings?: PluginSettings }>("set_settings");
export async function setSettings(changes: Partial<PluginSettings>): Promise<PluginSettings> {
  const result = await setSettingsCall(changes);
  if (!result.success || !result.settings) throw new Error(result.error || "unknownError");
  return result.settings;
}

const resetSettingsCall = callable<[], { success: boolean; error?: string; settings?: PluginSettings; options?: CustomOption[] }>("reset_settings");
/** Plugin settings and saved custom options back to their defaults. */
export async function resetSettings(): Promise<{ settings: PluginSettings; options: CustomOption[] }> {
  const result = await resetSettingsCall();
  if (!result.success || !result.settings || !result.options) throw new Error(result.error || "unknownError");
  return { settings: result.settings, options: result.options };
}

export interface Launcher { path: string; legacy: string[]; home: string }
const getLauncherCall = callable<[], { success: boolean; error?: string } & Partial<Launcher>>("get_launcher");
/**
 * The launcher script, written for the current settings, the earlier script
 * paths older launch options may still name, and the user's home directory.
 */
export async function getLauncher(): Promise<Launcher> {
  const result = await getLauncherCall();
  if (!result.success || !result.path) throw new Error(result.error || "unknownError");
  return { path: result.path, legacy: result.legacy ?? [], home: result.home ?? "" };
}

/** The installed version and, when GitHub has a newer release, its version ("" otherwise). */
export interface UpdateInfo { current: string; latest: string }
export const getUpdate = callable<[], UpdateInfo>("get_update");
export const getSystemName = callable<[], string>("get_system_name");
/** The installed test build whose notice is still to be shown; "" for a release or once seen. */
export const getTestNotice = callable<[], string>("get_test_notice");
export const acknowledgeTestNotice = callable<[], { success: boolean; error?: string }>("acknowledge_test_notice");

type SavedOption = CustomOption;

/** The saved options, the user's home directory and which preset launcher files exist. */
export const getCustomOptions = callable<[], { options: SavedOption[]; home: string; installed: Record<string, boolean> }>("get_custom_options");
const saveCustomOptionsCall = callable<[options: SavedOption[]], { success: boolean; error?: string; options?: SavedOption[] }>(
  "save_custom_options",
);
export async function saveCustomOptions(options: SavedOption[]): Promise<SavedOption[]> {
  const result = await saveCustomOptionsCall(options);
  if (!result.success || !result.options) throw new Error(result.error || "unknownError");
  return result.options;
}
