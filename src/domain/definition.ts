// One launch option the plugin can switch: a variable, a prefix command or a game argument.
import { parseLaunchOptions, parseLiteralWord, parseRawWords } from "./parser";
import { commandKey, environmentName, isFlagWord, isValidFlag, renderWord, reservedWords } from "./words";

export type LaunchOptionDefinition =
  // `raw`, when given, is written instead of the quoted value (e.g. a `~/` path).
  | { kind: "environment"; name: string; value: string; raw?: string }
  | { kind: "prefix"; command: string; argv: readonly string[] }
  | { kind: "argument"; flag: string; argv: readonly string[] };

const areValidRawWords = (words: readonly string[]): boolean => {
  if (words.length === 0) return true;
  const parsed = parseRawWords(words.join(" "));
  return parsed !== undefined && parsed.length === words.length && parsed.every((word, index) => word === words[index]);
};

export const isValidLaunchOption = (definition: LaunchOptionDefinition): boolean => {
  switch (definition.kind) {
    case "environment":
      return environmentName.test(definition.name);
    case "prefix": {
      const words = [definition.command, ...definition.argv];
      return (
        parseLiteralWord(definition.command) !== "" &&
        !definition.command.startsWith("-") &&
        !definition.command.includes("=") &&
        areValidRawWords(words) &&
        words.every((word) => !reservedWords.has(word))
      );
    }
    case "argument":
      return (
        isValidFlag(definition.flag) &&
        areValidRawWords(definition.argv) &&
        definition.argv.every((word) => !isFlagWord(word) && word !== "%command%")
      );
  }
};

export const renderLaunchOptionDefinition = (definition: LaunchOptionDefinition): string => {
  switch (definition.kind) {
    case "environment":
      return `${definition.name}=${definition.raw ?? renderWord(definition.value)}`;
    case "prefix":
      return [definition.command, ...definition.argv].join(" ");
    case "argument":
      return [definition.flag, ...definition.argv].join(" ");
  }
};

export const parseLaunchOptionDefinition = (source: string): LaunchOptionDefinition | undefined => {
  const raw = source.trim();
  const words = parseRawWords(raw);
  if (!words) return undefined;

  const parsed = parseLaunchOptions(`${raw} %command%`);
  if (parsed.diagnostics.length > 0) return undefined;
  if (parsed.assignments.length > 0) {
    if (parsed.assignments.length !== 1 || parsed.prefixes.length > 0) return undefined;
    const { name, value } = parsed.assignments[0];
    if (value === undefined) return undefined;
    const definition = { kind: "environment" as const, name, value };
    return isValidLaunchOption(definition) ? definition : undefined;
  }

  const [first, ...argv] = words;
  if (first.includes("=")) return undefined;
  const definition: LaunchOptionDefinition = isFlagWord(first)
    ? { kind: "argument", flag: first, argv }
    : { kind: "prefix", command: first, argv };
  return isValidLaunchOption(definition) ? definition : undefined;
};

/** Compares definitions the way matching does: prefix commands by commandKey. */
export const definitionKey = (definition: LaunchOptionDefinition, home = ""): string =>
  definition.kind === "prefix" ? [commandKey(definition.command, home), ...definition.argv].join(" ") : renderLaunchOptionDefinition(definition);
