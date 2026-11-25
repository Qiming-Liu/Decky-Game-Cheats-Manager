// The text edits that switch one definition on or off in parsed launch options.
import type { SourceSpan } from "./parser";
import { type Parsed, sameCommand } from "./commands";
import { type LaunchOptionDefinition, renderLaunchOptionDefinition } from "./definition";
import { findWordSequenceSpans, leadingOwnedSpan, type TextEdit } from "./textEdits";
import { isFlagWord } from "./words";

export const findDefinitionSpans = (parsed: Parsed, definition: LaunchOptionDefinition): SourceSpan[] => {
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

export const removeDefinitionEdits = (parsed: Parsed, definition: LaunchOptionDefinition): TextEdit[] => {
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

export const replacementDeletionEdits = (parsed: Parsed, definition: LaunchOptionDefinition): TextEdit[] => {
  switch (definition.kind) {
    case "environment":
      return environmentDeletionEdits(parsed, definition.name);
    case "argument":
      return argumentSlotEdits(parsed, definition);
    case "prefix":
      return [];
  }
};

export const insertionEdit = (parsed: Parsed, definition: LaunchOptionDefinition): TextEdit => {
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
