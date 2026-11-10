import {
  definitionKey, LaunchContext, LaunchOptions, LaunchOptionDefinition, parseLaunchOptionDefinition,
} from "./options";
import { COMMON_NAMES } from "./common";
import { TRAINER_NAMES } from "./trainerCommand";

/** A saved launch option: one the user created, a preset, or detected words. */
export interface CustomOption {
  id: string;
  name: string;
  preset?: string;
  detected?: boolean;
  /** Set for an option that belongs to one game; otherwise every game lists it. */
  app_id?: string;
  definitions: string[];
}

export type OptionGroup = "global" | "game";

/** The options a game shows in a group: global ones, or its own. */
export function optionsIn(saved: readonly CustomOption[], group: OptionGroup, appId: string): CustomOption[] {
  return saved.filter(option => group === "game" ? option.app_id === appId : !option.app_id && !option.detected);
}

const RESERVED = new Set([...COMMON_NAMES, ...TRAINER_NAMES]);

export function optionDefinitions(option: CustomOption): LaunchOptionDefinition[] {
  return option.definitions.map(parseLaunchOptionDefinition).filter((item): item is LaunchOptionDefinition => Boolean(item));
}

/** The prefix commands of saved options, which split a chain of wrappers into commands. */
export function knownPrefixesOf(saved: readonly CustomOption[]) {
  return saved.flatMap(optionDefinitions).flatMap(definition => definition.kind === "prefix" ? [definition] : []);
}

/** How launch options are read with the saved options as known commands. */
export function launchContext(saved: readonly CustomOption[], home: string): LaunchContext {
  return { home, known: knownPrefixesOf(saved) };
}

/**
 * This game's words that no saved option accounts for, shown as one
 * "user launch options" row. It is worked out on every render and saved only
 * when the user changes it, so nothing is written just by viewing a page.
 */
export function detectedOption(source: string, saved: readonly CustomOption[], appId: string, home = ""): CustomOption | undefined {
  const words = unrecognized(source, saved, home);
  return words.length ? { id: `detected-${appId}`, name: "", detected: true, app_id: appId, definitions: words } : undefined;
}

export function isOptionEnabled(source: string, option: CustomOption, context: Partial<LaunchContext> = {}): boolean {
  const options = LaunchOptions.parse(source, context);
  const definitions = optionDefinitions(option);
  return definitions.length > 0 && definitions.every(definition => options.isEnabled(definition));
}

export function setOptionEnabled(source: string, option: CustomOption, enabled: boolean, context: Partial<LaunchContext> = {}): string {
  const options = LaunchOptions.parse(source, context);
  if (!options.editable) throw new Error("These launch options cannot be edited safely. Review them in Steam Properties.");
  const result = options.edit(optionDefinitions(option).map(definition => ({ kind: enabled ? "enable" : "disable", definition })));
  if (!result.ok) throw new Error("Could not update launch options safely.");
  return result.value.toString();
}

/**
 * Words in the launch options that no common setting, modifier or saved
 * option accounts for, as written in the launch options.
 */
export function unrecognized(source: string, saved: readonly CustomOption[], home = ""): string[] {
  const key = (definition: LaunchOptionDefinition) => definitionKey(definition, home);
  const known = new Set(saved.flatMap(option => optionDefinitions(option).map(key)));
  // Each word keeps the spelling Steam has, quotes included.
  return LaunchOptions.parse(source, launchContext(saved, home)).segments()
    .flatMap(({ text, definition }) => definition ? [{ text, definition }] : [])
    .filter(({ definition }) => definition.kind !== "environment" || !RESERVED.has(definition.name))
    .filter(({ definition }) => !known.has(key(definition)))
    .map(({ text }) => text);
}
