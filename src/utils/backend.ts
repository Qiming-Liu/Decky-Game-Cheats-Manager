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
  author?: string;
  /** A Cheat Engine table, opened through Cheat Engine. */
  table?: boolean;
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
  author?: string;
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

const getLauncherCall = callable<[], { success: boolean; error?: string; path?: string; cheat_engine?: string }>("get_launcher");
/** The shared launcher script, written for the current settings, and the Cheat Engine program if installed. */
export async function getLauncher(): Promise<{ path: string; cheatEngine: string }> {
  const result = await getLauncherCall();
  if (!result.success || !result.path) throw new Error(result.error || "unknownError");
  return { path: result.path, cheatEngine: result.cheat_engine || "" };
}

export interface CheatEngineStatus {
  installed: boolean;
  /** The Cheat Engine.exe path. */
  path: string;
  folder: string;
  version: string;
  /** The user's own folder rather than a downloaded copy. */
  linked: boolean;
  zh_cn: boolean;
  /** The plugin's autorun script is in place. */
  bridge: boolean;
}
export const getCheatEngine = callable<[], CheatEngineStatus>("get_cheat_engine");
const manageCheatEngineCall = callable<[action: string, value: string],
  { success: boolean; error?: string; job?: DownloadJob; cheat_engine?: CheatEngineStatus }>("manage_cheat_engine");
export async function manageCheatEngine(action: "download" | "link" | "delete" | "language" | "bridge", value = "") {
  const result = await manageCheatEngineCall(action, value);
  if (!result.success) throw new Error(result.error || "unknownError");
  return result;
}

export interface TableEntry {
  id: number;
  desc: string;
  group: boolean;
  active: boolean;
  /** "script" for Auto Assembler entries, else the value type. */
  type: string;
  value?: string;
  options?: { value: string; label: string }[];
  error: string;
  children: TableEntry[];
}
export interface TableState {
  table: string;
  attached: string;
  pid: number;
  last_n: number;
  entries: TableEntry[];
  /** Seconds since Cheat Engine last wrote the state. */
  age: number;
}
export const getTable = callable<[path: string], { success: boolean; error?: string; table?: string; entries?: TableEntry[] }>("get_table");
export const tableSession = callable<[action: "start" | "stop" | "attach", table: string, app_id: string],
  { success: boolean; error?: string; process?: string }>("table_session");
export const getTableState = callable<[table: string], { success: boolean; error?: string; state?: TableState | null }>("get_table_state");
export const sendTableCommand = callable<[table: string, command: Record<string, unknown>], { success: boolean; error?: string; n?: number }>("send_table_command");

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
