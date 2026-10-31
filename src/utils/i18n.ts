import { useEffect, useSyncExternalStore } from "react";
import { en, zhCN, zhTW, Translations } from "./locales";

export const PLUGIN_NAME = "DeckyGCM";
export type Locale = "en" | "zh-CN" | "zh-TW";
let currentLocale: Locale = "en";
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function steamLocale(language: unknown): Locale {
  if (typeof language !== "string") return "en";
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  if (["schinese", "zh-cn", "zh-sg", "zh-hans", "zh-hans-cn", "zh"].includes(normalized)) return "zh-CN";
  if (["tchinese", "zh-tw", "zh-hk", "zh-mo", "zh-hant", "zh-hant-tw", "zh-hant-hk"].includes(normalized)) return "zh-TW";
  return "en";
}

export function initLanguage(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const next = steamLocale(await SteamClient.Settings.GetCurrentLanguage());
      if (next !== currentLocale) {
        currentLocale = next;
        listeners.forEach(listener => listener());
      }
    } catch {
      // Keep the last detected language if Steam is temporarily unavailable.
    }
  })().finally(() => { pending = undefined; });
  return pending;
}

export function getLanguage(): Locale { return currentLocale; }
// GCM's catalog worker supports English and Chinese, independent of UI script.
export function getSearchLanguage(): "en" | "zh" { return currentLocale === "en" ? "en" : "zh"; }
export function translations(locale: Locale = currentLocale): Translations {
  return locale === "zh-CN" ? zhCN : locale === "zh-TW" ? zhTW : en;
}
export function useTranslations(): Translations {
  const locale = useSyncExternalStore(subscribe, getLanguage);
  useEffect(() => { void initLanguage(); }, []);
  return translations(locale);
}
export const menuItemLabel = () => PLUGIN_NAME;

// Older backend errors remain English or machine codes. Translate known values
// at the presentation boundary without changing identifiers or diagnostic logs.
const errorKeys: Record<string, keyof Translations> = {
  library_unavailable: "libraryUnavailable", library_changed: "libraryChanged",
  library_conflict: "libraryConflict", library_nested: "libraryNested",
  invalid_app_id: "invalidAppId", unknown_trainer: "trainerMissing",
  plugin_stopping: "stopping", keyword_too_short: "keywordTooShort", database_missing: "databaseMissing",
  "Trainer no longer exists. Refresh the library.": "trainerMissing",
  "Unknown trainer file.": "unknownFile",
  "Choose an .exe or .bat program. Cheat Tables require Cheat Engine.": "executableRequired",
  "Choose an .exe, .bat or .CT file.": "selectFile",
  "Choose an .exe file.": "selectFile",
  "This trainer is shared with another game and cannot be deleted here.": "sharedTrainer",
  "Trainer is outside the current library.": "outsideLibrary",
  "Only trainers downloaded or imported by this plugin can be deleted.": "unmanagedTrainer",
  "Unknown download for this game.": "unknownDownload",
  "Choose an existing folder.": "invalidFolder", "Choose a folder, not a file.": "folderRequired",
  "No .exe or .CT trainer files found in the download.": "noTrainerFiles",
  "No GCM data source configured": "dataSourceMissing",
  "Could not load GCM authentication configuration": "dataSourceInvalid",
  "GCM device authentication failed": "authenticationFailed",
  "Could not connect to GCM server": "connectionFailed",
  "Could not connect to server": "connectionFailed",
  "Server request timed out": "connectionFailed",
  "Download stream interrupted": "connectionFailed",
  "GCM server request failed": "serverError",
  "GCM request rate limited": "rateLimited",
  "GCM server rate limit reached": "rateLimited",
  "GCM enrollment is waiting before retrying": "connectionFailed",
  unconfigured: "dataSourceMissing", invalid_config: "dataSourceInvalid", auth_failed: "authenticationFailed",
  connection_failed: "connectionFailed", rate_limited: "rateLimited", server_error: "serverError",
  "Invalid trainer database format": "invalidDatabase",
  "7z/RAR extraction requires libarchive on this device.": "missingDependency",
  "Unsafe path in trainer archive.": "invalidArchive",
  "Trainer archive contains too many files.": "invalidArchive",
  "Trainer archive is too large.": "invalidArchive",
  "Links and special files are not allowed in trainer archives.": "invalidArchive",
  "Trainer archive has no file content.": "invalidArchive",
};

export function errorMessage(error: unknown, t: Translations = translations()): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const key = (Object.prototype.hasOwnProperty.call(en, message) ? message as keyof Translations : undefined)
    || errorKeys[message] || (Object.keys(en) as (keyof Translations)[]).find(key => en[key] === message);
  const value = key && t[key];
  return typeof value === "string" ? value : t.unknownError;
}
