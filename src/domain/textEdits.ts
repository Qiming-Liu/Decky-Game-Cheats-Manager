// Replacements in the launch-option text, by source position.
import type { SourceSpan } from "./parser";

export interface TextEdit {
  span: SourceSpan;
  replacement: string;
}

export const findWordSequenceSpans = (
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

export const leadingOwnedSpan = (source: string, target: SourceSpan): SourceSpan => {
  let start = target.start;
  while (start > 0 && /[\t ]/.test(source[start - 1])) start--;
  return { start, end: target.end };
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

export const applyTextEdits = (source: string, edits: readonly TextEdit[]): string =>
  mergeDeletions(edits)
    .sort((left, right) => right.span.start - left.span.start || right.span.end - left.span.end)
    .reduce(
      (current, edit) => current.slice(0, edit.span.start) + edit.replacement + current.slice(edit.span.end),
      source,
    );
