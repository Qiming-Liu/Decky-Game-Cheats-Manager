import data from "../data/common-settings.json";
import { LaunchOptions } from "./options";

// Common settings keep no state of their own: everything shown is read from,
// and written to, the launch-option text.

export const TOGGLES: readonly { id: string; name: string; value: string }[] = data.toggles;
export type ToggleId = string;

export const LANGUAGE_NAMES: readonly string[] = data.language_names;
export const LANGUAGES: readonly string[] = data.languages.map(code => `${code}${data.language_encoding}`);
export const AUDIO_NAME = data.audio_name;
export const AUDIO_VALUES: readonly string[] = data.audio_values;
export const COMPAT_DATA_NAME = data.compat_data_name;

/** Every variable a common setting reads or writes. */
export const COMMON_NAMES: readonly string[] = [...TOGGLES.map(item => item.name), ...LANGUAGE_NAMES, AUDIO_NAME, COMPAT_DATA_NAME];

export interface CommonState {
  toggles: Record<ToggleId, boolean>;
  /** The variable is set to another value, e.g. by another tool. */
  occupied: Record<ToggleId, boolean>;
  /** LANG and HOST_LC_ALL as written; either may be missing. */
  language?: string;
  hostLanguage?: string;
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
    language: options.getEnvironment(LANGUAGE_NAMES[0]),
    hostLanguage: options.getEnvironment(LANGUAGE_NAMES[1]),
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

const localeKey = (locale: string) => locale.toLowerCase().replace(/[-_.]/g, "");
/** The listed locale a value means: `zh_CN.utf8` is `zh_CN.UTF-8`. */
export const knownLanguage = (locale: string | undefined) =>
  locale === undefined ? undefined : LANGUAGES.find(code => localeKey(code) === localeKey(locale));

export const setLanguage = (source: string, locale?: string) =>
  setEnvironment(source, Object.fromEntries(LANGUAGE_NAMES.map(name => [name, locale])));
