import {
  LaunchOptions, LaunchOptionDefinition, parseLaunchOptionDefinition, renderLaunchOptionDefinition,
} from "./options";
import { COMMON_NAMES } from "./common";
import { SIDECAR_NAMES } from "./sidecar";

/** A saved launch option: one the user created, a preset, or detected words. */
export interface CustomOption {
  id: string;
  name: string;
  preset?: string;
  detected?: boolean;
  definitions: string[];
}

const RESERVED = new Set([...COMMON_NAMES, ...SIDECAR_NAMES]);

export function optionDefinitions(option: CustomOption): LaunchOptionDefinition[] {
  return option.definitions.map(parseLaunchOptionDefinition).filter((item): item is LaunchOptionDefinition => Boolean(item));
}

export function isOptionEnabled(source: string, option: CustomOption): boolean {
  const options = LaunchOptions.parse(source);
  const definitions = optionDefinitions(option);
  return definitions.length > 0 && definitions.every(definition => options.isEnabled(definition));
}

export function setOptionEnabled(source: string, option: CustomOption, enabled: boolean): string {
  const options = LaunchOptions.parse(source);
  if (!options.editable) throw new Error("These launch options cannot be edited safely. Review them in Steam Properties.");
  const result = options.edit(optionDefinitions(option).map(definition => ({ kind: enabled ? "enable" : "disable", definition })));
  if (!result.ok) throw new Error("Could not update launch options safely.");
  return result.value.toString();
}

/**
 * Words in the launch options that no common setting, modifier or saved
 * option accounts for, rendered as option definitions.
 */
export function unrecognized(source: string, saved: readonly CustomOption[]): string[] {
  const known = new Set(saved.flatMap(option => optionDefinitions(option).map(renderLaunchOptionDefinition)));
  return LaunchOptions.parse(source).definitions()
    .filter(definition => definition.kind !== "environment" || !RESERVED.has(definition.name))
    .map(renderLaunchOptionDefinition)
    .filter(text => !known.has(text));
}
