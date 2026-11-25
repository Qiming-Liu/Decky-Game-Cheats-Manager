// The trainer library: its folder, its trainers and what can be done with one.
import { callable } from "@decky/api";
import type { DatabaseStatus, DownloadJob } from "./catalog";

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
  /** `directory` with symbolic links resolved, as trainer paths are. */
  real_directory?: string;
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

export const cleanupTrash = callable<[], void>("cleanup_trash");

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
