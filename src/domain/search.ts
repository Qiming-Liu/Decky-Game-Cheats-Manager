// Trainer search results: their order, and the date of the database they came from.
import type { DatabaseStatus, TrainerResult } from "../utils/backend";

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Results whose game name matches the searched or Steam name exactly come
 * first, then by prefix, then by substring. Ties keep the database's order.
 */
export function rankResults<T extends Pick<TrainerResult, "game_name" | "trainer_name">>(
  results: readonly T[], names: readonly (string | undefined)[]): T[] {
  const targets = names.map(name => normalize(name || "")).filter(Boolean);
  const closeness = (name: string) => !name ? 3 : Math.min(3, ...targets.map(target => name === target ? 0
    : name.startsWith(target) || target.startsWith(name) ? 1 : name.includes(target) || target.includes(name) ? 2 : 3));
  // The database names games in English; the trainer name holds the
  // localized title in 《》, which is what a localized search matches.
  const match = (result: T) => Math.min(
    closeness(normalize(result.game_name)), closeness(normalize(/《(.+?)》/.exec(result.trainer_name)?.[1] || "")));
  return results.map((result, index) => ({ result, index, score: match(result) }))
    .sort((a, b) => a.score - b.score || a.index - b.index).map(item => item.result);
}

/** The newest database file's date as MM-DD, or "" when nothing was downloaded. */
export function databaseDate(status?: Pick<DatabaseStatus, "files">): string {
  const newest = Math.max(0, ...Object.values(status?.files || {})
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  if (!newest) return "";
  const date = new Date(newest * 1000);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
