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
}

export interface LibraryResponse {
  success: boolean;
  directory?: string;
  game_name?: string;
  trainers?: LocalTrainer[];
  error?: string;
}

export const getLibrary = callable<[app_id: string, game_name: string], LibraryResponse>("get_library");
export const setLibraryDirectory = callable<[path: string], LibraryResponse>("set_library_directory");

export const getLibrarySettings = callable<[], { directory: string; database: DatabaseStatus }>("get_library_settings");
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

export async function importTrainer(context: LibraryContext & { source: string; gameName: string }): Promise<void> {
  await runTrainerAction("import", context, "", "", context.source, context.gameName);
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
