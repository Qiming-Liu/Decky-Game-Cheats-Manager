import { LaunchOptions } from "./options";

// Common settings keep no state of their own: everything shown is read from,
// and written to, the launch-option text.

export const TOGGLES = [
  { id: "desktop", name: "SteamDeck", value: "0" },
  { id: "wined3d", name: "PROTON_USE_WINED3D", value: "1" },
  { id: "fsync", name: "PROTON_NO_FSYNC", value: "1" },
  { id: "overlay", name: "LD_PRELOAD", value: "" },
  { id: "sdl", name: "PROTON_USE_SDL", value: "1" },
  { id: "log", name: "PROTON_LOG", value: "1" },
] as const;
export type ToggleId = typeof TOGGLES[number]["id"];

export const LANGUAGE_NAMES = ["LANG", "HOST_LC_ALL"] as const;
export const LANGUAGES = ["en_US", "zh_CN", "zh_TW", "ja_JP", "ko_KR", "de_DE", "fr_FR", "es_ES", "it_IT", "pt_BR", "ru_RU", "pl_PL"]
  .map(code => `${code}.UTF-8`);
export const AUDIO_NAME = "PULSE_LATENCY_MSEC";
export const AUDIO_VALUES = ["30", "60", "90"] as const;
export const COMPAT_DATA_NAME = "STEAM_COMPAT_DATA_PATH";

/** Every variable a common setting reads or writes. */
export const COMMON_NAMES: readonly string[] = [...TOGGLES.map(item => item.name), ...LANGUAGE_NAMES, AUDIO_NAME, COMPAT_DATA_NAME];

export interface CommonState {
  toggles: Record<ToggleId, boolean>;
  /** The variable is set to another value, e.g. by another tool. */
  occupied: Record<ToggleId, boolean>;
  language?: string;
  audio?: string;
  compatData?: string;
}

export function readCommon(source: string): CommonState {
  const options = LaunchOptions.parse(source);
  const toggles = {} as Record<ToggleId, boolean>;
  const occupied = {} as Record<ToggleId, boolean>;
  for (const item of TOGGLES) {
    const value = options.getEnvironment(item.name);
    toggles[item.id] = options.hasEnvironment(item.name) && value === item.value;
    occupied[item.id] = options.hasEnvironment(item.name) && value !== item.value;
  }
  return {
    toggles, occupied,
    language: options.getEnvironment("LANG"),
    audio: options.getEnvironment(AUDIO_NAME),
    compatData: options.getEnvironment(COMPAT_DATA_NAME),
  };
}

/** Sets (or, with `undefined`, removes) environment variables. */
export function setEnvironment(source: string, values: Record<string, string | undefined>): string {
  const options = LaunchOptions.parse(source);
  if (!options.editable) throw new Error("These launch options cannot be edited safely. Review them in Steam Properties.");
  const edits = Object.entries(values).flatMap(([name, value]) => [
    { kind: "disable" as const, definition: { kind: "environment" as const, name, value: "" } },
    ...(value === undefined ? [] : [{ kind: "enable" as const, definition: { kind: "environment" as const, name, value } }]),
  ]);
  const result = options.edit(edits);
  if (!result.ok) throw new Error("Could not update launch options safely.");
  return result.value.toString();
}

export const setToggle = (source: string, id: ToggleId, enabled: boolean) => {
  const item = TOGGLES.find(toggle => toggle.id === id)!;
  return setEnvironment(source, { [item.name]: enabled ? item.value : undefined });
};

export const setLanguage = (source: string, locale?: string) =>
  setEnvironment(source, Object.fromEntries(LANGUAGE_NAMES.map(name => [name, locale])));
