// The trainer database: its status, searching it and downloading from it.
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
  /** Seconds since the epoch. */
  started_at: number;
}

export const getDatabaseStatus = callable<[], DatabaseStatus>("get_database_status");
export const refreshDatabase = callable<[], RefreshResult>("refresh_database");
export const checkDatabaseUpdate = callable<[], RefreshResult>("check_database_update");

export const searchTrainers = callable<[keyword: string, lang: string], SearchResponse>("search_trainers");
export const downloadTrainer = callable<[trainer_id: string, app_id: string, expected_directory: string, expected_version: string, game_name: string], { success: boolean; error?: string; job?: DownloadJob }>(
  "download_trainer",
);
export const getDownloads = callable<[], DownloadJob[]>("get_downloads");
