// Prefix commands: where one wrapper ends and the next begins.
import { type ParsedLaunchOptions, type ParsedPrefix, parseLaunchOptions } from "./parser";
import { commandKey, isFlagWord } from "./words";

export type Word = ParsedPrefix["words"][number];
export type KnownPrefix = { command: string; argv: readonly string[] };

/**
 * What reading launch options depends on besides the text itself.
 * `home` is the user's home directory, so its absolute spelling matches `~`.
 * `known` are the saved options' prefix commands: wrappers are chained
 * without `--` (`a b %command%`), so these tell where one command ends.
 */
export interface LaunchContext { home: string; known: readonly KnownPrefix[] }

/** Parsed launch options with each prefix group split into the commands it chains. */
export type Parsed = ParsedLaunchOptions & { commands: Word[][][]; home: string };

export const sameCommand = (word: Word, command: string, home: string): boolean => commandKey(word.raw, home) === commandKey(command, home);

/**
 * Splits one prefix group into commands. A known command takes exactly its
 * own words; flags right after it stay with it. Other words stay with the
 * command before them, so an unknown chain remains one piece.
 */
const splitCommands = (words: readonly Word[], { known, home }: LaunchContext): Word[][] => {
  const parts: Word[][] = [];
  let exact = false;
  for (let index = 0; index < words.length; ) {
    const length = known.reduce((best, item) => index + item.argv.length < words.length && sameCommand(words[index], item.command, home)
      && item.argv.every((word, offset) => words[index + 1 + offset].raw === word) ? Math.max(best, item.argv.length + 1) : best, 0);
    if (length) {
      parts.push(words.slice(index, index + length));
      exact = true;
      index += length;
      continue;
    }
    if (!parts.length || (exact && !isFlagWord(words[index].raw))) parts.push([words[index]]);
    else parts[parts.length - 1].push(words[index]);
    exact = false;
    index++;
  }
  return parts;
};

/** `source` parsed, with its prefix groups split into commands for `context`. */
export const parseWithContext = (source: string, context: LaunchContext): Parsed => {
  const parsed = parseLaunchOptions(source);
  return { ...parsed, home: context.home, commands: parsed.prefixes.map((prefix) => splitCommands(prefix.words, context)) };
};
