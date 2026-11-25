// A Cheat Engine table as the panel lists it: rows, groups and counts.
import type { TableEntry } from "../utils/backend";

export interface TableRow { entry: TableEntry; depth: number }

export const isGroup = (entry: TableEntry): boolean => entry.displayOnly ? entry.children.length > 0 : entry.group;

/** The entries of a table with their groups, as rows: nested groups are flattened under their parents. */
export function flatten(entries: readonly TableEntry[], filter: string, collapsed: ReadonlySet<number>, depth = 0): TableRow[] {
  const rows: TableRow[] = [];
  const query = filter.trim().toLowerCase();
  for (const entry of entries) {
    const children = flatten(entry.children, filter, collapsed, depth + 1);
    const matches = !query || entry.desc.toLowerCase().includes(query);
    if (isGroup(entry)) {
      // A filter shows every matching entry, with its group kept as a heading.
      if (query ? children.length : true) {
        rows.push({ entry, depth });
        if (query || !collapsed.has(entry.id)) rows.push(...children);
      }
    } else if (matches || children.length) {
      rows.push({ entry, depth }, ...children);
    }
  }
  return rows;
}

/** The switches that are on. */
export const countOn = (entries: readonly TableEntry[]): number => entries.reduce((sum, entry) =>
  sum + (!entry.group && !entry.displayOnly && entry.active ? 1 : 0) + countOn(entry.children), 0);

/** The entries that can be switched or written; groups and plain labels do not count. */
export const countEntries = (entries: readonly TableEntry[]): number => entries.reduce((sum, entry) =>
  sum + (entry.group || entry.displayOnly ? 0 : 1) + countEntries(entry.children), 0);

/** The labels of a table file: entries that only show text, by ID. */
export const displayOnlyLabels = (preview: readonly TableEntry[]): Map<number, string> =>
  new Map(flatten(preview, "", new Set()).filter(({ entry }) => entry.displayOnly).map(({ entry }) => [entry.id, entry.desc]));

/** Entries reported by Cheat Engine, with those the table file shows as labels marked again. */
export function withDisplayOnlyEntries(entries: readonly TableEntry[], labels: ReadonlyMap<number, string>): TableEntry[] {
  return entries.map(entry => ({
    ...entry,
    displayOnly: labels.get(entry.id) === entry.desc,
    children: withDisplayOnlyEntries(entry.children, labels),
  }));
}

/** An entry without a value to show or write: a script, or a value Cheat Engine cannot read. */
export const isScriptEntry = (entry: Pick<TableEntry, "type" | "value">): boolean =>
  entry.type === "script" || entry.value === undefined || entry.value === "" || entry.value === "??";

/**
 * Why the bridge says an entry failed (resources/decky_gcm.lua). "activate"
 * comes from an older bridge and means the same as "rejected".
 */
export type EntryFailure = "detached" | "exited" | "rejected" | "error" | "value";

export function entryFailure(error: string | undefined): EntryFailure | undefined {
  if (!error) return undefined;
  if (error === "detached" || error === "exited" || error === "error" || error === "value") return error;
  return "rejected";
}

/** What the panel says about the bridge to Cheat Engine. */
export type BridgeStatus = "attached" | "notAttached" | "noReply" | "starting";

export function bridgeStatus(state: { pid?: number } | null, waitedSeconds: number, noReplyAfter: number): BridgeStatus {
  if (state?.pid) return "attached";
  if (state) return "notAttached";
  return waitedSeconds >= noReplyAfter ? "noReply" : "starting";
}

export interface DropdownOption { data: string; label: string }
export type DropdownCache = Map<number, { key: string; options: DropdownOption[] }>;

/**
 * An entry's dropdown options, the same array while they stay the same. The
 * panel reads the state every poll; Steam's dropdown closes and rebuilds an
 * open menu whenever it gets a new options array, dropping a pick the player
 * is still making.
 */
export function dropdownOptions(cache: DropdownCache, entry: Pick<TableEntry, "id" | "options">): DropdownOption[] {
  const options = entry.options || [];
  const key = JSON.stringify(options);
  const cached = cache.get(entry.id);
  if (cached && cached.key === key) return cached.options;
  const built = options.map(option => ({ data: option.value, label: option.label }));
  cache.set(entry.id, { key, options: built });
  return built;
}
