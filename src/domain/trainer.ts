import type { DownloadJob, LocalTrainer, TrainerResult } from "../utils/backend";

export function installedVersion(trainer: TrainerResult, library: LocalTrainer[]): boolean {
  return Boolean(trainer.version) && library.some(item =>
    item.trainer_id === trainer.id && item.version === trainer.version);
}

export function activeVersion(trainer: TrainerResult, jobs: DownloadJob[]): DownloadJob | undefined {
  return jobs.find(item => item.trainer_id === trainer.id && item.version === trainer.version
    && ["queued", "downloading", "extracting"].includes(item.state));
}

// Display names of the upstream catalog sources; unknown sources are not shown.
const ORIGIN_LABELS: Record<string, string> = {
  fling_main: "FLiNG", fling_archive: "FLiNG", xiaoxing: "XiaoXing", gcm: "GCM",
  the_cheat_script: "Cheat Table", ct_other: "Cheat Table",
};

export const originLabel = (origin: string) => ORIGIN_LABELS[origin] || "";

const TABLE_FILE = /\.(ct|cetrainer)$/i;
const PROGRAM_FILE = /\.(exe|bat|ct|cetrainer)$/i;
/** The files of a trainer that can start beside the game: programs, scripts and tables. */
export const launchableFiles = (trainer: Pick<LocalTrainer, "files">) => trainer.files.filter(file => PROGRAM_FILE.test(file));
export const isTableFile = (file: string) => TABLE_FILE.test(file);
/** True when the trainer holds a table and nothing else to start. */
export const tableOnly = (trainer: Pick<LocalTrainer, "files">) => {
  const files = launchableFiles(trainer);
  return files.length > 0 && files.every(isTableFile);
};
