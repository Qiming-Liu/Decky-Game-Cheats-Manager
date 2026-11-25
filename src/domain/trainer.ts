import type { DownloadJob, LocalTrainer, TrainerResult } from "../utils/backend";
import data from "../data/trainers.json";
import { isLaunchableFile, isTableFile } from "./fileTypes";

export { isTableFile } from "./fileTypes";

/** The states of a download that is still running. */
export const ACTIVE_JOB_STATES: readonly string[] = ["queued", "downloading", "extracting"];

/** True when the library holds this download. A catalog entry without a version
 *  counts as installed once a copy without a version is there. */
export function installedVersion(trainer: TrainerResult, library: LocalTrainer[]): boolean {
  return library.some(item => item.trainer_id === trainer.id && (item.version || "") === (trainer.version || ""));
}

export function activeVersion(trainer: TrainerResult, jobs: DownloadJob[]): DownloadJob | undefined {
  return jobs.find(item => item.trainer_id === trainer.id && item.version === trainer.version
    && ACTIVE_JOB_STATES.includes(item.state));
}

/**
 * This game's finished downloads the library has not been read for yet: `read`
 * holds the tasks that were finished when a read of the library completed.
 */
export function unreadDownloads(jobs: DownloadJob[], appId: string, read: ReadonlySet<string>): DownloadJob[] {
  return jobs.filter(item => item.state === "done" && item.app_ids.includes(appId) && !read.has(item.id));
}

/**
 * Whether the displayed version counts as downloaded: it is in the library, or
 * its download finished and the library is still being read again (`unread`,
 * empty once it has been). Without the second case the download button came
 * back for a moment after each download.
 */
export function downloadedVersion(trainer: TrainerResult, library: LocalTrainer[], unread: DownloadJob[]): boolean {
  return installedVersion(trainer, library) || unread.some(item =>
    item.trainer_id === trainer.id && (item.version || "") === (trainer.version || ""));
}

// Display names of the upstream catalog sources; unknown sources are not shown.
const ORIGIN_LABELS: Record<string, string> = data.origin_labels;

export const originLabel = (origin: string) => ORIGIN_LABELS[origin] || "";

/** The files of a trainer that can start beside the game: programs, scripts and tables. */
export const launchableFiles = (trainer: Pick<LocalTrainer, "files">) => trainer.files.filter(isLaunchableFile);
/** True when the trainer holds a table and nothing else to start. */
export const tableOnly = (trainer: Pick<LocalTrainer, "files">) => {
  const files = launchableFiles(trainer);
  return files.length > 0 && files.every(isTableFile);
};
