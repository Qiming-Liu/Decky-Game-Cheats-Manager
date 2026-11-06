import type { CustomOption } from "../domain/custom";
import { callable } from "@decky/api";

export interface DatabaseStatus {
  configured: boolean;
  data_source?: { configured: boolean; state: string };
  ready: boolean;
  checked_at?: number;
  // file name -> last-modified (unix seconds), null when not downloaded yet
  files: Record<string, number | null>;
}

export interface RefreshResult {
  success: boolean;
  errors: Record<string, string>;
}

export interface TrainerResult {
  id: string;
  trainer_name: string;
  game_name: string;
  origin: string;
  version: string;
  /** False for Cheat Tables, which are listed but cannot be downloaded yet. */
  supported?: boolean;
}

export interface SearchResponse {
  success: boolean;
  error?: "keyword_too_short" | "database_missing" | string;
  results: TrainerResult[];
}

export type DownloadState = "queued" | "downloading" | "extracting" | "done" | "error" | "cancelled";

export interface DownloadJob {
  version: string;
  id: string;
  trainer_id: string;
  directory: string;
  app_ids: string[];
  trainer_name: string;
  state: DownloadState;
  downloaded: number;
  total: number;
  path: string | null;
  error: string | null;
}

export const getDatabaseStatus = callable<[], DatabaseStatus>("get_database_status");
export const refreshDatabase = callable<[], RefreshResult>("refresh_database");
export const checkDatabaseUpdate = callable<[], RefreshResult>("check_database_update");
export const cleanupTrash = callable<[], void>("cleanup_trash");
export const searchTrainers = callable<[keyword: string, lang: string], SearchResponse>("search_trainers");
export const downloadTrainer = callable<[trainer_id: string, app_id: string, expected_directory: string, expected_version: string], { success: boolean; error?: string; job?: DownloadJob }>(
  "download_trainer",
);
export const getDownloads = callable<[], DownloadJob[]>("get_downloads");

export interface LocalTrainer {
  id: string;
  name: string;
  path: string;
  files: string[];
  trainer_id: string;
  game_name: string;
  app_ids: string[];
  version: string;
  origin: string;
  /** Linked local file that no longer exists. */
  missing?: boolean;
}

export const LINKED_ORIGIN = "Linked file";

export interface LibraryResponse {
  success: boolean;
  directory?: string;
  game_name?: string;
  trainers?: LocalTrainer[];
  error?: string;
}

export const getLibrary = callable<[app_id: string, game_name: string], LibraryResponse>("get_library");
export const setLibraryDirectory = callable<[path: string], LibraryResponse>("set_library_directory");

export interface DatabaseState extends DatabaseStatus {
  updating?: boolean;
  progress?: { done: number; total: number };
  /** The first error of the last finished refresh. */
  error?: string;
}
export const getLibrarySettings = callable<[], { directory: string; database: DatabaseState }>("get_library_settings");

export interface PluginSettings { allow_multiple: boolean; auto_select: boolean; launch_delay: number }
export const LAUNCH_DELAYS = [0, 5, 10, 15, 30, 60] as const;
export const getSettings = callable<[], PluginSettings>("get_settings");
const setSettingsCall = callable<[changes: Partial<PluginSettings>], { success: boolean; error?: string; settings?: PluginSettings }>("set_settings");
export async function setSettings(changes: Partial<PluginSettings>): Promise<PluginSettings> {
  const result = await setSettingsCall(changes);
  if (!result.success || !result.settings) throw new Error(result.error || "unknownError");
  return result.settings;
}

const getLauncherCall = callable<[], { success: boolean; error?: string; path?: string }>("get_launcher");
/** The shared launcher script, written for the current settings. */
export async function getLauncher(): Promise<string> {
  const result = await getLauncherCall();
  if (!result.success || !result.path) throw new Error(result.error || "unknownError");
  return result.path;
}

export interface LogLine { time: string; level: string; message: string }
export const getLog = callable<[], { lines: LogLine[] }>("get_log");
export const clearLog = callable<[], void>("clear_log");
const manageTrainer = callable<[
  action: string, app_id: string, expected_directory: string, entry_id: string,
  filename: string, source: string, game_name: string,
], { success: boolean; error?: string; path?: string; filename?: string; job?: DownloadJob }>("manage_trainer");

interface LibraryContext { appId: string; directory: string }
interface EntryContext extends LibraryContext { entryId: string }

async function runTrainerAction(action: "import" | "delete" | "executable" | "cancel", context: LibraryContext,
  entryId = "", filename = "", source = "", gameName = "") {
  const result = await manageTrainer(action, context.appId, context.directory, entryId, filename, source, gameName);
  if (!result.success) throw new Error(result.error || "unknownError");
  return result;
}

/** Uses a local program in place and returns its resolved path. */
export async function linkTrainer(context: LibraryContext & { source: string; gameName: string }): Promise<string> {
  const result = await runTrainerAction("import", context, "", "", context.source, context.gameName);
  if (!result.path) throw new Error("unknownFile");
  return result.path;
}

export async function deleteTrainer(context: EntryContext): Promise<void> {
  await runTrainerAction("delete", context, context.entryId);
}

export async function trainerExecutable(context: EntryContext & { filename: string }): Promise<string> {
  const result = await runTrainerAction("executable", context, context.entryId, context.filename);
  if (!result.path) throw new Error("unknownFile");
  return result.path;
}

export async function cancelDownload(context: { appId: string; jobId: string }): Promise<DownloadJob> {
  const result = await runTrainerAction("cancel", { appId: context.appId, directory: "" }, context.jobId);
  if (!result.job) throw new Error("unknownDownload");
  return result.job;
}

/** The installed version and, when GitHub has a newer release, its version ("" otherwise). */
export interface UpdateInfo { current: string; latest: string }
export const getUpdate = callable<[], UpdateInfo>("get_update");
export const getSystemName = callable<[], string>("get_system_name");

type SavedOption = CustomOption;

export const getCustomOptions = callable<[], { options: SavedOption[] }>("get_custom_options");
const saveCustomOptionsCall = callable<[options: SavedOption[]], { success: boolean; error?: string; options?: SavedOption[] }>(
  "save_custom_options",
);
export async function saveCustomOptions(options: SavedOption[]): Promise<SavedOption[]> {
  const result = await saveCustomOptionsCall(options);
  if (!result.success || !result.options) throw new Error(result.error || "unknownError");
  return result.options;
}
