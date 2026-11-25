// Launch options as a document: read what is set, switch definitions on and off.
import type { ParseDiagnostic } from "./parser";
import { type LaunchContext, type Parsed, parseWithContext } from "./commands";
import { isValidLaunchOption, type LaunchOptionDefinition } from "./definition";
import { findDefinitionSpans, insertionEdit, removeDefinitionEdits, replacementDeletionEdits } from "./optionEdits";
import { canonicalText, definitionsOf, type Segment, segmentsOf } from "./optionViews";
import { applyTextEdits } from "./textEdits";

export type { LaunchContext } from "./commands";
export {
  definitionKey, isValidLaunchOption, type LaunchOptionDefinition, parseLaunchOptionDefinition, renderLaunchOptionDefinition,
} from "./definition";
export { commandKey, isFlagWord, renderWord } from "./words";

export type LaunchOptionsEditResult =
  | { ok: true; value: LaunchOptions; changed: boolean }
  | { ok: false; value: LaunchOptions; error: "document-not-editable" | "invalid-definition" | "invalid-result" };

type LaunchOptionsEdit =
  | { kind: "enable"; definition: LaunchOptionDefinition }
  | { kind: "disable"; definition: LaunchOptionDefinition };

export class LaunchOptions {
  private readonly parsed: Parsed;

  private constructor(private readonly source: string, private readonly context: LaunchContext) {
    this.parsed = parseWithContext(source, context);
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
    return this.editable ? canonicalText(this.parsed) : this.source;
  }

  /**
   * The words of the launch options in order, grouped the way definitions()
   * groups them, so each piece can be shown with the option it belongs to.
   */
  segments(): Segment[] {
    if (!this.editable) return this.source ? [{ text: this.source }] : [];
    return segmentsOf(this.parsed);
  }

  /**
   * Splits the launch options into definitions that can be toggled one by one.
   * Assignments with dynamic values and arguments without a flag stay out.
   */
  definitions(): LaunchOptionDefinition[] {
    return this.editable ? definitionsOf(this.parsed) : [];
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
