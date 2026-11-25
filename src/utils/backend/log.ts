// The plugin log, and what the frontend writes into it.
import { callable } from "@decky/api";

export interface LogLine { time: string; level: string; message: string }
/** The newest log entries, oldest first. */
export const getLog = callable<[limit?: number], LogLine[]>("get_log");
export const clearLog = callable<[], void>("clear_log");
/** Writes the whole log to ~/Downloads and returns its path, with ~ for the home directory. */
/** Writes the whole log into `directory` and resolves to the file, with ~ for home. */
export const exportLog = callable<[directory: string], string>("export_log");
/** Where the export folder picker opens: ~/Downloads, or home without it. */
export const getLogExportDirectory = callable<[], string>("get_log_export_directory");
/** Whether the plugin wrote the game's PROTON_LOG, so it may take it out again. */
export const getProtonLogOwned = callable<[appId: string], boolean>("get_proton_log_owned");
export const setProtonLogOwned = callable<[appId: string, owned: boolean], { success: boolean; error?: string }>("set_proton_log_owned");
const logFrontendCall = callable<[level: string, message: string], void>("log_frontend");

// Lines the backend could not take (it crashed, restarts, or is stopping) wait
// in the browser's storage and are sent with the next line that gets through,
// or when the plugin loads again.
const PENDING_KEY = "deckygcm-pending-log";
const PENDING_LIMIT = 200;
interface PendingLine { level: string; message: string; time: string }

function readPending(): PendingLine[] {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function writePending(lines: PendingLine[]) {
  try {
    if (lines.length) localStorage.setItem(PENDING_KEY, JSON.stringify(lines.slice(-PENDING_LIMIT)));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* Storage may be unavailable; the line is lost then. */ }
}

let flushing = false;
/** Sends the lines that waited for the backend. Never throws. */
export async function flushPendingLog(): Promise<void> {
  if (flushing) return;
  const lines = readPending();
  if (!lines.length) return;
  flushing = true;
  writePending([]);
  try {
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      try {
        await logFrontendCall(line.level, `${line.message} (at ${line.time}, kept while the backend did not answer)`);
      } catch {
        writePending([...lines.slice(index), ...readPending()]);
        return;
      }
    }
  } finally { flushing = false; }
}

function send(level: string, message: string): void {
  try {
    void logFrontendCall(level, message).then(() => { void flushPendingLog(); }, () => {
      const time = new Date().toISOString().slice(0, 19).replace("T", " ") + "Z";
      writePending([...readPending(), { level, message, time }]);
    });
  } catch { /* The backend may be gone while the plugin unloads. */ }
}

/**
 * Records a failure the user saw in the plugin log, as `context: detail`.
 * Never throws: logging must not turn into another error.
 */
export function logFrontend(level: "error" | "warning" | "info", context: string, reason?: unknown): void {
  try {
    const detail = reason === undefined ? "" : reason instanceof Error ? reason.message : String(reason);
    send(level, detail ? `${context}: ${detail}` : context);
  } catch { /* The backend may be gone while the plugin unloads. */ }
}

const OWN_SCRIPT = "/plugins/DeckyGCM/";
/**
 * Logs uncaught errors and rejected promises that come from this plugin's own
 * code (other plugins and Steam share the page). Returns the function that stops.
 */
export function logUncaughtErrors(): () => void {
  const ours = (error: unknown) => error instanceof Error && String(error.stack || "").includes(OWN_SCRIPT);
  const describe = (error: Error) => `${error.message}\n${String(error.stack || "").split("\n").slice(0, 8).join("\n")}`;
  const onError = (event: ErrorEvent) => {
    if (ours(event.error) || String(event.filename || "").includes(OWN_SCRIPT)) {
      send("error", `Uncaught error: ${event.error instanceof Error ? describe(event.error) : event.message}`);
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (ours(event.reason)) send("error", `Unhandled rejection: ${describe(event.reason as Error)}`);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/**
 * Records a user action the frontend carried out itself (such as writing launch
 * options) as one `[user] action: done` or `[user] action: failed: reason` line.
 * Never throws.
 */
export function logUserAction(action: string, error?: unknown): void {
  try {
    if (error === undefined) {
      send("info", `[user] ${action}: done`);
      return;
    }
    const reason = (error instanceof Error ? error.message : String(error)) || "unknown error";
    send("warning", `[user] ${action}: failed: ${reason}`);
  } catch { /* The backend may be gone while the plugin unloads. */ }
}
