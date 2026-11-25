// Several definitions typed as one option.
import { type LaunchOptionDefinition, parseLaunchOptionDefinition } from "./definition";
import { LaunchOptions } from "./options";
import { parseRawWords } from "./parser";
import { isFlagWord } from "./words";

/**
 * Several definitions typed as one option, e.g. `A=1 B=2`, `-novid -console`
 * or `A=1 gamemoderun`: leading assignments, then either game arguments (each
 * flag with the words after it) or one prefix command with its arguments.
 * Text with `%command%` is read as full launch options.
 */
export const parseLaunchOptionDefinitions = (source: string): LaunchOptionDefinition[] | undefined => {
  const raw = source.trim();
  if (!raw) return undefined;
  if (raw.split(/\s+/).includes("%command%")) {
    const options = LaunchOptions.parse(raw);
    const segments = options.segments();
    if (!options.editable || segments.some(segment => !segment.definition && segment.text !== "%command%" && segment.text !== "--")) return undefined;
    return segments.flatMap(segment => segment.definition ? [segment.definition] : []);
  }
  const words = parseRawWords(raw);
  if (!words) return undefined;
  const result: LaunchOptionDefinition[] = [];
  let index = 0;
  for (; index < words.length; index++) {
    const definition = parseLaunchOptionDefinition(words[index]);
    if (definition?.kind !== "environment") break;
    result.push(definition);
  }
  const rest = words.slice(index);
  if (rest.length && isFlagWord(rest[0])) {
    const groups: string[][] = [];
    for (const word of rest) {
      if (isFlagWord(word)) groups.push([word]);
      else groups[groups.length - 1].push(word);
    }
    for (const group of groups) {
      const definition = parseLaunchOptionDefinition(group.join(" "));
      if (!definition) return undefined;
      result.push(definition);
    }
  } else if (rest.length) {
    const definition = parseLaunchOptionDefinition(rest.join(" "));
    if (!definition || definition.kind === "environment") return undefined;
    result.push(definition);
  }
  return result.length ? result : undefined;
};
