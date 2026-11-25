// A running game: how its trainers started, and its Cheat Engine table.
import { callable } from "@decky/api";

/** The game's own window and whether a trainer's window is on screen instead (X window IDs, 0 for none).
 *  `dialog_in_front`: a trainer's dialog (a question) is on screen; it is not reported as a trainer in front. */
export const getGameWindow = callable<[app_id: string, programs: string[]],
  { success: boolean; error?: string; game?: number; focused?: number; trainer_in_front?: boolean;
    dialog_in_front?: boolean; hidden_dialog?: number; trainer_windows?: number[] }>("get_game_window");

/** Records in the log how the game's trainers started, once the starter has followed them. */
export const checkTrainerLaunch = callable<[app_id: string, programs: string[], compat_tool: string], { success: boolean; error?: string }>(
  "check_trainer_launch");

/** One thing a started program did, as the starter saw it (py_modules/trainer_events.py). */
export interface TrainerEvent {
  /** Unix seconds. */
  time: number;
  /** Wine's process ID. */
  pid: number;
  kind: "started" | "failed" | "unwatched" | "window" | "nowindow" | "dialog" | "exit" | "handoff" | "hold";
  /** The program's file name. */
  program: string;
  /** dialog: title, line break, text; exit: "0x<code> <seconds>"; failed: the Windows error code. */
  text: string;
}

export interface TrainerStatus {
  /** The game the status belongs to; for an empty request, the latest game whose trainers still run. */
  app_id: string;
  /** False until the game's start was reported in this plugin run. */
  known: boolean;
  events: TrainerEvent[];
  /** File names (lower case) of the game's programs that run now. */
  running: string[];
  programs?: string[];
  /** For an unknown game: the app IDs Steam's reapers run now (a game may report another Steam ID than its shortcut's). */
  reapers?: string[];
}

/** Facts about what a game runs on (py_modules/game_environment.py); the panel words what they mean as hints. */
export interface GamePrelaunch {
  /** A program in the game's folder is a .NET Framework program. */
  managed: boolean;
  /** The game has a Proton prefix yet. */
  prefix: boolean;
  /** The prefix has Microsoft's .NET Framework 4 runtime. */
  ms_dotnet: boolean;
}
export interface GameRuntime {
  /** Wine Mono version whose mscorlib the game has loaded, "" for none. */
  wine_mono: string;
  /** The game has Microsoft's clr.dll loaded. */
  ms_clr: boolean;
  /** The game is a 32-bit Linux process (old WoW64 on x86). */
  elf32: boolean;
  /** Wine Mono version of the Proton the game runs with, "" when unknown. */
  tool_mono: string;
  /** File names of trainers that are .NET Framework programs. */
  managed_trainers: string[];
}
export const getGameEnvironment = callable<[app_id: string, programs: string[], exe: string],
  { success: boolean; error?: string; prelaunch?: GamePrelaunch; runtime?: GameRuntime | null }>("get_game_environment");

/** What the game's trainers did since it started. An empty app ID asks for the latest game whose trainers run. */
export const getTrainerStatus = callable<[app_id: string], { success: boolean; error?: string } & Partial<TrainerStatus>>(
  "get_trainer_status");

export interface TableEntry {
  id: number;
  desc: string;
  group: boolean;
  /** Set by the table reader for notes and headings with no writable value. */
  displayOnly?: boolean;
  active: boolean;
  /** "script" for Auto Assembler entries, else the value type. */
  type: string;
  value?: string;
  options?: { value: string; label: string }[];
  error: string;
  /** Why Cheat Engine refused the entry: its activation-failure code name (afAOBNotFound, ...) or "lua". */
  reason?: string;
  /** Cheat Engine's own description of that failure. */
  reason_text?: string;
  children: TableEntry[];
}
export interface TableState {
  table: string;
  attached: string;
  pid: number;
  last_n: number;
  entries: TableEntry[];
  /** Seconds since Cheat Engine last wrote the state. */
  age: number;
  /**
   * The newest error the table's own Lua raised: its message and first frames,
   * the whole error with its traceback (newer bridges only), and when (Unix seconds).
   */
  script_error?: { text: string; full?: string; ts: number };
  /** Cheat Engine could not inject a DLL into the game, e.g. its Mono/IL2CPP helper under FEX on ARM (newer bridges only). */
  injection_error?: { text: string; ts: number };
}
/** What in a table file can run code when Cheat Engine opens it or an entry is switched on. */
export type TableCode = "lua" | "forms" | "files" | "assembler";
/** Whether an entry's byte patterns are in the game's files; only "missing" is a claim (py_modules/table_scan.py). */
export type EntryScan = "found" | "missing" | "unchecked";
export const scanTable = callable<[path: string, app_id: string],
  {
    success: boolean; error?: string; entries?: Record<string, EntryScan>; folder?: string;
    /** IDs of entries of an IL2CPP game that use Cheat Engine's injected data collector, and whether Decky runs on ARM. */
    injection?: string[]; arm?: boolean;
    /** IDs of entries (any game) that use Cheat Engine's Mono/.NET data collector. */
    collector?: string[];
  }>("scan_table");
/** "unconfirmed": a local table that can run code whose file name was never confirmed. */
export type TableTrustState = "ok" | "unconfirmed";
export const getTableTrust = callable<[path: string],
  { success: boolean; error?: string; state?: TableTrustState; code?: TableCode[] | null }>("get_table_trust");
/** Records the table as it is now as the one the player agreed to run. */
export const confirmTableFile = callable<[path: string], { success: boolean; error?: string }>("confirm_table");
export const getTable = callable<[path: string],
  { success: boolean; error?: string; table?: string; entries?: TableEntry[]; code?: TableCode[] }>("get_table");
export const tableSession = callable<[action: "start" | "stop", table: string, app_id: string],
  { success: boolean; error?: string }>("table_session");
/** A process in Cheat Engine's own list (inside Proton): Windows process ID and name. */
export interface GameProcess { pid: number; name: string; window: boolean; launched: boolean; memory: number }
export const getGameProcesses = callable<[app_id: string, programs: string[], table: string],
  { success: boolean; error?: string; processes?: GameProcess[] }>("get_game_processes");
export const attachTable = callable<[table: string, pid: number, name: string, appId: string], { success: boolean; error?: string; n?: number }>("attach_table");
export const getTableState = callable<[table: string], { success: boolean; error?: string; state?: TableState | null }>("get_table_state");
export const sendTableCommand = callable<[table: string, command: Record<string, unknown>], { success: boolean; error?: string; n?: number }>("send_table_command");
