import {
  type ParseDiagnostic,
  type ParsedLaunchOptions,
  type ParsedPrefix,
  parseLaunchOptions,
  parseLiteralWord,
  parseRawWords,
  type SourceSpan,
} from "./parser";

export type LaunchOptionDefinition =
  // `raw`, when given, is written instead of the quoted value (e.g. a `~/` path).
  | { kind: "environment"; name: string; value: string; raw?: string }
  | { kind: "prefix"; command: string; argv: readonly string[] }
  | { kind: "argument"; flag: string; argv: readonly string[] };

export type LaunchOptionsEditResult =
  | { ok: true; value: LaunchOptions; changed: boolean }
  | { ok: false; value: LaunchOptions; error: "document-not-editable" | "invalid-definition" | "invalid-result" };

interface TextEdit {
  span: SourceSpan;
  replacement: string;
}

type LaunchOptionsEdit =
  | { kind: "enable"; definition: LaunchOptionDefinition }
  | { kind: "disable"; definition: LaunchOptionDefinition };

const unquotedWord = /^[A-Za-z0-9_.,:@%+/-]+$/;
const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const reservedWords = new Set(["%command%", "--"]);

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

const areValidRawWords = (words: readonly string[]): boolean => {
  if (words.length === 0) return true;
  const parsed = parseRawWords(words.join(" "));
  return parsed !== undefined && parsed.length === words.length && parsed.every((word, index) => word === words[index]);
};

// Game arguments start with "-" or, for some engines, "+" (e.g. "+fps_max 60").
export const isFlagWord = (word: string): boolean => /^[-+]/.test(word) && !["-", "--", "+"].includes(word);
const isValidFlag = (flag: string): boolean => isFlagWord(flag) && unquotedWord.test(flag);
const compareNames = (left: string, right: string): number => {
  const a = left.toUpperCase(), b = right.toUpperCase();
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
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

type Word = ParsedPrefix["words"][number];
type KnownPrefix = { command: string; argv: readonly string[] };

/**
 * What reading launch options depends on besides the text itself.
 * `home` is the user's home directory, so its absolute spelling matches `~`.
 * `known` are the saved options' prefix commands: wrappers are chained
 * without `--` (`a b %command%`), so these tell where one command ends.
 */
export interface LaunchContext { home: string; known: readonly KnownPrefix[] }

/** Parsed launch options with each prefix group split into the commands it chains. */
type Parsed = ParsedLaunchOptions & { commands: Word[][][]; home: string };

const sameCommand = (word: Word, command: string, home: string): boolean => commandKey(word.raw, home) === commandKey(command, home);

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

/** Compares definitions the way matching does: prefix commands by commandKey. */
export const definitionKey = (definition: LaunchOptionDefinition, home = ""): string =>
  definition.kind === "prefix" ? [commandKey(definition.command, home), ...definition.argv].join(" ") : renderLaunchOptionDefinition(definition);

const findWordSequenceSpans = (
  words: readonly { raw: string; span: SourceSpan }[],
  sequence: readonly string[],
  start = 0,
): SourceSpan[] => {
  if (sequence.length === 0) return [];
  const spans: SourceSpan[] = [];
  for (let index = start; index <= words.length - sequence.length; ) {
    if (!sequence.every((expected, offset) => words[index + offset].raw === expected)) {
      index++;
      continue;
    }
    spans.push({ start: words[index].span.start, end: words[index + sequence.length - 1].span.end });
    index += sequence.length;
  }
  return spans;
};

const findDefinitionSpans = (parsed: Parsed, definition: LaunchOptionDefinition): SourceSpan[] => {
  switch (definition.kind) {
    case "environment":
      return parsed.assignments
        .filter((assignment) => assignment.name === definition.name && assignment.value === definition.value)
        .map((assignment) => assignment.span);
    case "prefix":
      return parsed.commands.flat().flatMap((part) => {
        if (!sameCommand(part[0], definition.command, parsed.home)) return [];
        return definition.argv.length === 0 ? [part[0].span] : findWordSequenceSpans(part, definition.argv, 1);
      });
    case "argument":
      return findWordSequenceSpans(parsed.arguments, [definition.flag, ...definition.argv]);
  }
};

const leadingOwnedSpan = (source: string, target: SourceSpan): SourceSpan => {
  let start = target.start;
  while (start > 0 && /[\t ]/.test(source[start - 1])) start--;
  return { start, end: target.end };
};

const prefixDeletionSpan = (parsed: Parsed, index: number): SourceSpan => {
  const prefix = parsed.prefixes[index];
  if (prefix.separatorBefore) {
    return leadingOwnedSpan(parsed.source, { start: prefix.separatorBefore.start, end: prefix.span.end });
  }
  const next = parsed.prefixes[index + 1];
  if (next?.separatorBefore) return { start: prefix.span.start, end: next.separatorBefore.end };
  if (prefix.separatorAfter)
    return leadingOwnedSpan(parsed.source, { start: prefix.span.start, end: prefix.separatorAfter.end });
  return leadingOwnedSpan(parsed.source, prefix.span);
};

const mergeDeletions = (edits: readonly TextEdit[]): TextEdit[] => {
  const sorted = [...edits].sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
  const merged: TextEdit[] = [];
  for (const edit of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.replacement === "" && edit.replacement === "" && edit.span.start <= previous.span.end) {
      previous.span.end = Math.max(previous.span.end, edit.span.end);
    } else merged.push({ span: { ...edit.span }, replacement: edit.replacement });
  }
  return merged;
};

const applyTextEdits = (source: string, edits: readonly TextEdit[]): string =>
  mergeDeletions(edits)
    .sort((left, right) => right.span.start - left.span.start || right.span.end - left.span.end)
    .reduce(
      (current, edit) => current.slice(0, edit.span.start) + edit.replacement + current.slice(edit.span.end),
      source,
    );

const argumentSlotEdits = (
  parsed: Parsed,
  definition: Extract<LaunchOptionDefinition, { kind: "argument" }>,
): TextEdit[] => {
  const edits: TextEdit[] = [];
  for (let index = 0; index < parsed.arguments.length; index++) {
    const word = parsed.arguments[index];
    if (word.raw !== definition.flag) continue;
    let end = word.span.end;
    let consumed = 0;
    while (consumed < definition.argv.length) {
      const next = parsed.arguments[index + consumed + 1];
      if (!next || isFlagWord(next.raw)) break;
      end = next.span.end;
      consumed++;
    }
    edits.push({ span: leadingOwnedSpan(parsed.source, { start: word.span.start, end }), replacement: "" });
    index += consumed;
  }
  return edits;
};

const environmentDeletionEdits = (parsed: Parsed, name: string): TextEdit[] =>
  parsed.assignments
    .filter((assignment) => assignment.name === name)
    .map((assignment) => ({ span: leadingOwnedSpan(parsed.source, assignment.span), replacement: "" }));

const prefixDefinitionDeletionEdits = (
  parsed: Parsed,
  definition: Extract<LaunchOptionDefinition, { kind: "prefix" }>,
): TextEdit[] => {
  const edits: TextEdit[] = [];
  parsed.commands.forEach((parts, index) => parts.forEach((part) => {
    if (!sameCommand(part[0], definition.command, parsed.home)) return;
    // A whole group goes with its `--`; one command of a chain goes alone.
    const whole = parts.length === 1 ? prefixDeletionSpan(parsed, index)
      : leadingOwnedSpan(parsed.source, { start: part[0].span.start, end: part[part.length - 1].span.end });
    if (definition.argv.length === 0) {
      edits.push({ span: whole, replacement: "" });
      return;
    }
    const matches = findWordSequenceSpans(part, definition.argv, 1);
    if (matches.length === 0) return;
    if (part.length - matches.length * definition.argv.length === 1) edits.push({ span: whole, replacement: "" });
    else edits.push(...matches.map((span) => ({ span: leadingOwnedSpan(parsed.source, span), replacement: "" })));
  }));
  return edits;
};

const removeDefinitionEdits = (parsed: Parsed, definition: LaunchOptionDefinition): TextEdit[] => {
  switch (definition.kind) {
    case "environment":
      return environmentDeletionEdits(parsed, definition.name);
    case "prefix":
      return prefixDefinitionDeletionEdits(parsed, definition);
    case "argument":
      return findDefinitionSpans(parsed, definition).map((span) => ({
        span: leadingOwnedSpan(parsed.source, span),
        replacement: "",
      }));
  }
};

const replacementDeletionEdits = (parsed: Parsed, definition: LaunchOptionDefinition): TextEdit[] => {
  switch (definition.kind) {
    case "environment":
      return environmentDeletionEdits(parsed, definition.name);
    case "argument":
      return argumentSlotEdits(parsed, definition);
    case "prefix":
      return [];
  }
};

const insertionEdit = (parsed: Parsed, definition: LaunchOptionDefinition): TextEdit => {
  const rendered = renderLaunchOptionDefinition(definition);
  if (parsed.implicitMarker) {
    // Words without a marker are the game's arguments; keep them after it.
    const args = parsed.arguments.map((word) => word.raw).join(" ");
    const replacement = definition.kind === "argument"
      ? (args ? `${args} ${rendered}` : `%command% ${rendered}`)
      : `${rendered} %command%${args ? ` ${args}` : ""}`;
    return { span: { start: 0, end: parsed.source.length }, replacement };
  }
  if (!parsed.marker) throw new Error("editable launch options must have a marker");
  if (definition.kind === "environment") {
    const position = parsed.prefixes[0]?.span.start ?? parsed.marker.span.start;
    return { span: { start: position, end: position }, replacement: `${rendered} ` };
  }
  if (definition.kind === "prefix") {
    const existing = parsed.commands.flat().find((part) => sameCommand(part[0], definition.command, parsed.home));
    if (existing && definition.argv.length > 0) {
      const end = existing[existing.length - 1].span.end;
      return { span: { start: end, end }, replacement: ` ${definition.argv.join(" ")}` };
    }
    // Chained in front without `--`: Steam passes `--` on to the next wrapper,
    // which may try to run it as the command.
    if (parsed.prefixes.length > 0) {
      const position = parsed.prefixes[0].span.start;
      return { span: { start: position, end: position }, replacement: `${rendered} ` };
    }
    return {
      span: { start: parsed.marker.span.start, end: parsed.marker.span.start },
      replacement: `${rendered} `,
    };
  }
  const position = parsed.arguments[parsed.arguments.length - 1]?.span.end ?? parsed.marker.span.end;
  return { span: { start: position, end: position }, replacement: ` ${rendered}` };
};

export class LaunchOptions {
  private readonly parsed: Parsed;

  private constructor(private readonly source: string, private readonly context: LaunchContext) {
    const parsed = parseLaunchOptions(source);
    this.parsed = { ...parsed, home: context.home, commands: parsed.prefixes.map((prefix) => splitCommands(prefix.words, context)) };
  }

  /** Environment variables and arguments read the same in any context; prefix commands need it. */
  static parse(source: string, context: Partial<LaunchContext> = {}): LaunchOptions {
    return new LaunchOptions(source, { home: (context.home ?? "").replace(/\/+$/, ""), known: context.known ?? [] });
  }

  /** The same text read with `definition` as a known command too, so it is matched exactly. */
  private knowing(definition: LaunchOptionDefinition): LaunchOptions {
    if (definition.kind !== "prefix" || this.context.known.some((item) => item.command === definition.command
      && item.argv.length === definition.argv.length && item.argv.every((word, index) => word === definition.argv[index]))) return this;
    return new LaunchOptions(this.source, { ...this.context, known: [...this.context.known, definition] });
  }

  get editable(): boolean {
    return this.parsed.diagnostics.length === 0;
  }

  get diagnostics(): readonly ParseDiagnostic[] {
    return this.parsed.diagnostics;
  }

  toString(): string {
    return this.source;
  }

  isEnabled(definition: LaunchOptionDefinition): boolean {
    if (!this.editable) return false;
    if (definition.kind === "environment") return this.getEnvironment(definition.name) === definition.value;
    return findDefinitionSpans(this.knowing(definition).parsed, definition).length > 0;
  }

  setEnabled(definition: LaunchOptionDefinition, enabled: boolean): LaunchOptionsEditResult {
    return this.edit([{ kind: enabled ? "enable" : "disable", definition }]);
  }

  replaceDefinition(previous: LaunchOptionDefinition, next: LaunchOptionDefinition): LaunchOptionsEditResult {
    if (!this.editable) return { ok: false, value: this, error: "document-not-editable" };
    if (!this.isEnabled(previous)) return { ok: true, value: this, changed: false };
    return this.edit([
      { kind: "disable", definition: previous },
      { kind: "enable", definition: next },
    ]);
  }

  getEnvironment(name: string): string | undefined {
    return this.parsed.assignments.filter((assignment) => assignment.name === name).slice(-1)[0]?.value;
  }

  /** The last assignment's value as written, quotes and all. */
  getEnvironmentSource(name: string): string | undefined {
    const assignment = this.parsed.assignments.filter((item) => item.name === name).slice(-1)[0];
    return assignment && this.source.slice(assignment.span.start, assignment.span.end).slice(name.length + 1);
  }

  hasEnvironment(name: string): boolean {
    return this.parsed.assignments.some((assignment) => assignment.name === name);
  }

  /**
   * The same launch options with environment assignments deduplicated (the
   * last one wins, as in the shell) and sorted alphabetically. Prefix commands
   * and game arguments keep their order because it changes their meaning.
   */
  canonical(): string {
    if (!this.editable) return this.source;
    const { source, assignments, prefixes, arguments: args } = this.parsed;
    const latest = new Map<string, string>();
    for (const assignment of assignments) {
      latest.delete(assignment.name);
      latest.set(assignment.name, source.slice(assignment.span.start, assignment.span.end));
    }
    const environment = [...latest.entries()].sort(([left], [right]) => compareNames(left, right)).map(([, raw]) => raw);
    const commands = prefixes.map((prefix) => prefix.words.map((word) => word.raw).join(" ")).join(" -- ");
    const trailing = prefixes[prefixes.length - 1]?.separatorAfter ? " --" : "";
    const argv = args.map((word) => word.raw);
    // Nothing before the marker means the words are plain game arguments.
    if (environment.length === 0 && !commands) return argv.join(" ");
    return [...environment, ...(commands ? [commands + trailing] : []), "%command%", ...argv].join(" ");
  }

  /**
   * The words of the launch options in order, grouped the way definitions()
   * groups them, so each piece can be shown with the option it belongs to.
   */
  segments(): { text: string; name?: string; definition?: LaunchOptionDefinition }[] {
    if (!this.editable) return this.source ? [{ text: this.source }] : [];
    const { source, assignments, prefixes, marker, arguments: args } = this.parsed;
    // `name` is kept even for a value read only by the shell, such as `~/"x"`.
    const pieces: { text: string; name?: string; definition?: LaunchOptionDefinition }[] = assignments.map((assignment) => ({
      text: source.slice(assignment.span.start, assignment.span.end), name: assignment.name,
      ...(assignment.value === undefined ? {} : { definition: { kind: "environment" as const, name: assignment.name, value: assignment.value } }),
    }));
    this.parsed.commands.forEach((parts, index) => {
      if (index > 0) pieces.push({ text: "--" });
      for (const part of parts) {
        const [command, ...argv] = part.map((word) => word.raw);
        pieces.push({ text: [command, ...argv].join(" "), definition: { kind: "prefix", command, argv } });
      }
    });
    if (prefixes[prefixes.length - 1]?.separatorAfter) pieces.push({ text: "--" });
    if (marker) pieces.push({ text: marker.raw });
    for (const word of args) {
      const last = pieces[pieces.length - 1];
      if (!isFlagWord(word.raw) && last?.definition?.kind === "argument") {
        last.text += ` ${word.raw}`;
        last.definition = { ...last.definition, argv: [...last.definition.argv, word.raw] };
      } else pieces.push(isFlagWord(word.raw) ? { text: word.raw, definition: { kind: "argument", flag: word.raw, argv: [] } } : { text: word.raw });
    }
    return pieces.map((piece) => piece.definition && !isValidLaunchOption(piece.definition) ? { text: piece.text, name: piece.name } : piece);
  }

  /**
   * Splits the launch options into definitions that can be toggled one by one.
   * Assignments with dynamic values and arguments without a flag stay out.
   */
  definitions(): LaunchOptionDefinition[] {
    if (!this.editable) return [];
    const result: LaunchOptionDefinition[] = [];
    for (const assignment of this.parsed.assignments) {
      if (assignment.value !== undefined) result.push({ kind: "environment", name: assignment.name, value: assignment.value });
    }
    for (const part of this.parsed.commands.flat()) {
      const [command, ...argv] = part.map((word) => word.raw);
      result.push({ kind: "prefix", command, argv });
    }
    let current: { flag: string; argv: string[] } | undefined;
    for (const word of this.parsed.arguments) {
      if (isFlagWord(word.raw)) {
        current = { flag: word.raw, argv: [] };
        result.push({ kind: "argument", ...current });
      } else current?.argv.push(word.raw);
    }
    return result.filter(isValidLaunchOption);
  }

  edit(edits: readonly LaunchOptionsEdit[]): LaunchOptionsEditResult {
    if (!this.editable) return { ok: false, value: this, error: "document-not-editable" };
    let current: LaunchOptions = this;
    let changed = false;
    for (const edit of edits) {
      const result = current.applyOne(edit);
      if (!result.ok) return { ...result, value: this };
      current = result.value;
      changed ||= result.changed;
    }
    return { ok: true, value: current, changed };
  }

  private applyOne(edit: LaunchOptionsEdit): LaunchOptionsEditResult {
    if (!isValidLaunchOption(edit.definition)) {
      return { ok: false, value: this, error: "invalid-definition" };
    }
    const self = this.knowing(edit.definition);
    if (self !== this) return self.applyOne(edit);
    if (edit.kind === "disable") {
      const deletions = removeDefinitionEdits(this.parsed, edit.definition);
      if (deletions.length === 0) return { ok: true, value: this, changed: false };
      return this.finish(applyTextEdits(this.source, deletions));
    }
    const matches = findDefinitionSpans(this.parsed, edit.definition);
    if (this.isCanonical(edit.definition, matches.length)) return { ok: true, value: this, changed: false };
    const withoutSlot = applyTextEdits(this.source, replacementDeletionEdits(this.parsed, edit.definition));
    const intermediate = LaunchOptions.parse(withoutSlot, this.context);
    if (!intermediate.editable) return { ok: false, value: this, error: "invalid-result" };
    return this.finish(applyTextEdits(withoutSlot, [insertionEdit(intermediate.parsed, edit.definition)]));
  }

  private isCanonical(definition: LaunchOptionDefinition, matchCount: number): boolean {
    if (definition.kind === "prefix") return matchCount > 0;
    if (matchCount !== 1) return false;
    if (definition.kind === "environment") {
      return this.parsed.assignments.filter((assignment) => assignment.name === definition.name).length === 1;
    }
    return this.parsed.arguments.filter((word) => word.raw === definition.flag).length === 1;
  }

  private finish(source: string): LaunchOptionsEditResult {
    const normalized = source.trim() === "%command%" ? "" : source;
    const value = LaunchOptions.parse(normalized, this.context);
    if (!value.editable) return { ok: false, value: this, error: "invalid-result" };
    return { ok: true, value, changed: normalized !== this.source };
  }
}
