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
