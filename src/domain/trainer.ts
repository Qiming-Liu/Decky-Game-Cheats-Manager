import type { DownloadJob, LocalTrainer, TrainerResult } from "../utils/backend";

export function installedVersion(trainer: TrainerResult, library: LocalTrainer[]): boolean {
  return Boolean(trainer.version) && library.some(item =>
    item.trainer_id === trainer.id && item.version === trainer.version);
}

export function activeVersion(trainer: TrainerResult, jobs: DownloadJob[]): DownloadJob | undefined {
  return jobs.find(item => item.trainer_id === trainer.id && item.version === trainer.version
    && ["queued", "downloading", "extracting"].includes(item.state));
}
