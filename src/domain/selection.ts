// The programs a game starts, as a list of paths: which trainer holds which, and what a change makes of it.
import { isTableFile } from "./fileTypes";
import { folderOf, isWithin } from "./paths";

type Located = { path: string };

/** Only the first program counts unless several may run. */
export const effectiveSelection = (selected: readonly string[], multiple: boolean): string[] =>
  multiple ? [...selected] : selected.slice(0, 1);

/** Where the trainer first appears in the selection, or -1. With one program allowed, only the first place counts. */
export function selectionIndex(trainer: Located, selected: readonly string[], multiple: boolean): number {
  const index = selected.findIndex(item => isWithin(item, trainer.path));
  return multiple || index === 0 ? index : -1;
}

/** The selected path of one program inside a trainer, if it is selected. */
export function selectedProgram(trainer: Located, filename: string, selected: readonly string[], multiple: boolean): string | undefined {
  const target = `${trainer.path.replace(/\/$/, "")}/${filename}`;
  return effectiveSelection(selected, multiple)
    .find(item => item === target || (item === trainer.path && trainer.path.endsWith(`/${filename}`)));
}

/** Adds a program at the end, or replaces the selection when only one may run. */
export const withProgram = (selected: readonly string[], path: string, multiple: boolean): string[] =>
  multiple ? [...selected.filter(item => item !== path), path] : [path];

export const withoutProgram = (selected: readonly string[], path: string): string[] => selected.filter(item => item !== path);

/** Drops every program of one trainer. */
export const withoutTrainer = (selected: readonly string[], trainer: Located): string[] =>
  selected.filter(item => !isWithin(item, trainer.path));

/** The folders the game must see: the launcher, Cheat Engine when used, and each program. */
export const sharedFolders = (script: string, cheatEngine: string, programs: readonly string[]): string[] =>
  [...new Set([folderOf(script), ...(cheatEngine ? [folderOf(cheatEngine)] : []), ...programs.map(folderOf)])];

export type EngineState = "" | "missing" | "moved";

/**
 * Why a selected table will not open: its Cheat Engine is gone ("missing"),
 * or is not the one the launch options name any more ("moved"). `sameEngine`
 * says whether the installed one is the one written.
 */
export function engineState(selected: readonly string[] | undefined, engine: { installed: boolean } | undefined,
  sameEngine: boolean): EngineState {
  if (!selected?.some(isTableFile) || engine === undefined) return "";
  return !engine.installed ? "missing" : sameEngine ? "" : "moved";
}
