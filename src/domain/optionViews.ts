// Read-outs of parsed, editable launch options.
import type { Parsed } from "./commands";
import { isValidLaunchOption, type LaunchOptionDefinition } from "./definition";
import { compareNames, isFlagWord } from "./words";

export interface Segment { text: string; name?: string; definition?: LaunchOptionDefinition }

/**
 * The same launch options with environment assignments deduplicated (the
 * last one wins, as in the shell) and sorted alphabetically. Prefix commands
 * and game arguments keep their order because it changes their meaning.
 */
export function canonicalText(parsed: Parsed): string {
  const { source, assignments, prefixes, arguments: args } = parsed;
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
export function segmentsOf(parsed: Parsed): Segment[] {
  const { source, assignments, prefixes, marker, arguments: args } = parsed;
  // `name` is kept even for a value read only by the shell, such as `~/"x"`.
  const pieces: Segment[] = assignments.map((assignment) => ({
    text: source.slice(assignment.span.start, assignment.span.end), name: assignment.name,
    ...(assignment.value === undefined ? {} : { definition: { kind: "environment" as const, name: assignment.name, value: assignment.value } }),
  }));
  parsed.commands.forEach((parts, index) => {
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
export function definitionsOf(parsed: Parsed): LaunchOptionDefinition[] {
  const result: LaunchOptionDefinition[] = [];
  for (const assignment of parsed.assignments) {
    if (assignment.value !== undefined) result.push({ kind: "environment", name: assignment.name, value: assignment.value });
  }
  for (const part of parsed.commands.flat()) {
    const [command, ...argv] = part.map((word) => word.raw);
    result.push({ kind: "prefix", command, argv });
  }
  let current: { flag: string; argv: string[] } | undefined;
  for (const word of parsed.arguments) {
    if (isFlagWord(word.raw)) {
      current = { flag: word.raw, argv: [] };
      result.push({ kind: "argument", ...current });
    } else current?.argv.push(word.raw);
  }
  return result.filter(isValidLaunchOption);
}
