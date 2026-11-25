// Shell words of launch options: how they are written and compared.
import { parseLiteralWord } from "./parser";

export const unquotedWord = /^[A-Za-z0-9_.,:@%+/-]+$/;
export const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const reservedWords = new Set(["%command%", "--"]);

// Inside double quotes only $ ` " and a backslash before one of them (or the
// closing quote) need escaping, so Windows paths keep single backslashes.
const doubleQuote = (value: string): string =>
  `"${value.replace(/[$`"]|\\(?=[$`"\\]|$)/g, match => `\\${match}`)}"`;
const plain = (value: string): boolean => unquotedWord.test(value) && !reservedWords.has(value);
/**
 * One shell word: plain when safe, otherwise single-quoted (nothing inside is
 * special to the shell, or to the shlex split Proton applies to
 * PROTON_REMOTE_DEBUG_CMD), or double-quoted when it holds a single quote.
 * Reading accepts any shell quoting, including the `'"'"'` form earlier
 * versions wrote.
 */
export const renderWord = (value: string): string =>
  plain(value) ? value : value.includes("'") ? doubleQuote(value) : `'${value}'`;

const homeSpelling = /^(?:~|\$HOME|\$\{HOME\}|"\$HOME"|"\$\{HOME\}")(?=\/|$)/;
/**
 * One spelling for a command path: `~/x`, `$HOME/x`, `${HOME}/x` and the home
 * directory's absolute path (also under `/var/home`) name the same file and
 * all read as `~/x`. Other words are compared as their literal value.
 */
export const commandKey = (raw: string, home = ""): string => {
  const symbolic = homeSpelling.exec(raw);
  if (symbolic) {
    const rest = raw.slice(symbolic[0].length);
    const literal = rest ? parseLiteralWord(rest) : "";
    return literal === undefined ? raw : `~${literal}`;
  }
  const literal = parseLiteralWord(raw);
  if (literal === undefined) return raw;
  if (home) {
    const alternate = home.startsWith("/var/home/") ? home.slice(4) : home.startsWith("/home/") ? `/var${home}` : home;
    for (const root of [home, alternate]) {
      if (literal === root || literal.startsWith(`${root}/`)) return `~${literal.slice(root.length)}`;
    }
  }
  return literal;
};

// Game arguments start with "-" or, for some engines, "+" (e.g. "+fps_max 60").
export const isFlagWord = (word: string): boolean => /^[-+]/.test(word) && !["-", "--", "+"].includes(word);
export const isValidFlag = (flag: string): boolean => isFlagWord(flag) && unquotedWord.test(flag);
export const compareNames = (left: string, right: string): number => {
  const a = left.toUpperCase(), b = right.toUpperCase();
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
};
