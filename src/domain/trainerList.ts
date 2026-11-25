// What the trainer list of a game shows: order, pages, download rows and what a finished download does.
import type { DownloadJob, LocalTrainer } from "../utils/backend";
import { fileName, isWithin } from "./paths";
import { ACTIVE_JOB_STATES, launchableFiles } from "./trainer";
import { isTableFile } from "./fileTypes";

/** Always alphabetical in the reader's language: choosing a trainer never moves it. */
export function orderByName<T extends { name: string }>(trainers: readonly T[], locale: string): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return [...trainers].sort((a, b) => collator.compare(a.name, b.name));
}

export interface Page<T> { rows: T[]; index: number; count: number; full: boolean }

/** One page of rows; a page number past the end shows the last page. */
export function pageOf<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const count = Math.max(1, Math.ceil(rows.length / size));
  const index = Math.min(Math.max(0, page), count - 1);
  const shown = rows.slice(index * size, (index + 1) * size);
  return { rows: shown, index, count, full: shown.length === size };
}

/** The pages holding a selected row, so a selection on another page is never hidden. */
export const pagesWith = <T>(rows: readonly T[], selected: (row: T) => boolean, size: number): Set<number> =>
  new Set(rows.flatMap((row, index) => selected(row) ? [Math.floor(index / size)] : []));

export const isActiveJob = (job: Pick<DownloadJob, "state">): boolean => ACTIVE_JOB_STATES.includes(job.state);

/** Running and failed downloads get a row; a finished or cancelled one goes away. */
export const jobsWithRows = <T extends Pick<DownloadJob, "state">>(jobs: readonly T[]): T[] =>
  jobs.filter(job => job.state !== "done" && job.state !== "cancelled");

/**
 * The Cheat Engine download to show: the running one, or else the last that
 * failed. Cheat Engine belongs to no game, so its jobs are those without one.
 */
export function engineDownload<T extends Pick<DownloadJob, "state" | "app_ids" | "started_at">>(jobs: readonly T[]): T | undefined {
  const own = jobs.filter(job => !job.app_ids.length).sort((a, b) => b.started_at - a.started_at);
  return own.find(isActiveJob) || (own[0]?.state === "error" ? own[0] : undefined);
}

/** What a table that needs Cheat Engine shows in its place: the offer to install it, its download, or that the download failed. */
export type EngineOffer = "offer" | "downloading" | "failed";

export const engineOffer = (job: Pick<DownloadJob, "state"> | undefined): EngineOffer =>
  !job ? "offer" : isActiveJob(job) ? "downloading" : job.state === "error" ? "failed" : "offer";

/** Whole percent of a download, 0 to 100; extracting counts as downloaded. */
export function jobPercent(job: Pick<DownloadJob, "state" | "downloaded" | "total"> | undefined): number {
  if (!job) return 0;
  if (job.state === "extracting") return 100;
  const fraction = job.total > 0 ? job.downloaded / job.total : 0;
  return Number.isFinite(fraction) ? Math.max(0, Math.min(100, Math.floor(fraction * 100))) : 0;
}

/** The name shown for a selected program: its trainer, or the file when no trainer holds it. */
export const programLabel = (path: string, trainers: readonly Pick<LocalTrainer, "path" | "name">[]): string =>
  trainers.find(trainer => isWithin(path, trainer.path))?.name || fileName(path);

/** True when the trainer holds a table and Cheat Engine is known to be missing. Unknown status offers nothing. */
export const needsCheatEngine = (trainer: Pick<LocalTrainer, "files">, engine: { installed: boolean } | undefined): boolean =>
  launchableFiles(trainer).some(isTableFile) && engine !== undefined && !engine.installed;

/**
 * The finished download to use next, with its trainer. Downloads started
 * before `loadedAt` or already handled are skipped; a job waits until the
 * library lists it, and a table until Cheat Engine is installed.
 */
export function nextFinishedDownload<J extends Pick<DownloadJob, "id" | "state" | "path" | "started_at">, T extends Pick<LocalTrainer, "path" | "files">>(
  jobs: readonly J[], trainers: readonly T[], state: { loadedAt: number; handled: ReadonlySet<string>; engineInstalled: boolean },
): { job: J; trainer: T } | undefined {
  for (const job of jobs) {
    if (job.state !== "done" || !job.path || job.started_at < state.loadedAt || state.handled.has(job.id)) continue;
    const trainer = trainers.find(item => item.path === job.path);
    if (!trainer || (launchableFiles(trainer).some(isTableFile) && !state.engineInstalled)) continue;
    return { job, trainer };
  }
  return undefined;
}

export type RowAction = "none" | "choose" | "unselect";

/**
 * What activating a trainer row does. Several programs, or a table without
 * Cheat Engine: the row opens to choose. One program: the row selects it, or
 * toggles it out when several trainers may run. A table whose Cheat Engine
 * moved is chosen again to write the new place.
 */
export function rowAction(row: {
  missing: boolean; programs: number; needsEngine: boolean; current: boolean; tables: number; engineMoved: boolean; multiple: boolean;
}): RowAction {
  if (row.missing) return "none";
  if (row.programs > 1 || row.needsEngine) return "choose";
  if (row.current && row.tables > 0 && row.engineMoved && !row.multiple) return "choose";
  if (row.current) return row.multiple ? "unselect" : "none";
  return "choose";
}
