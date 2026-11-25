import { ConfirmModal, Focusable, ModalRoot, showModal, Spinner, TextField, Toggle } from "@decky/ui";
import { useState } from "react";
import { COMMON_NAMES } from "../domain/common";
import { CustomOption, detectedOption, isOptionEnabled, optionDefinitions, OptionGroup, optionsIn, setOptionEnabled } from "../domain/custom";
import { parseLaunchOptionDefinitions } from "../domain/definitions";
import { definitionKey, LaunchOptions, renderLaunchOptionDefinition } from "../domain/options";
import { TRAINER_NAMES } from "../domain/trainerCommand";
import { checkPresets, presetInstalled, saveOptions, useCustomOptions, useLaunchContext } from "../hooks/useCustomOptions";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { logFrontend } from "../utils/backend";
import { bumperStep } from "../utils/bumpers";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, MenuAction, mono, PageHeader, Preview, Row, Status } from "./shell";
import { BumperGlyph, PlusIcon } from "./icons";

// Product names; never translated.
const PRESET_NAMES: Record<string, string> = {
  lsfg: "LSFG", optiscaler: "OptiScaler Install", optiscalerRemove: "OptiScaler Uninstall", mako: "MAKO",
};
export const optionName = (t: Translations, option: CustomOption) =>
  option.name || (option.preset && PRESET_NAMES[option.preset]) || (option.detected ? t.detectedName : "");
const newId = () => `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const reserved = new Set([...COMMON_NAMES, ...TRAINER_NAMES]);

/** Validates the launch options typed for one saved option; several words are allowed. */
function describe(t: Translations, text: string): { ok: boolean; message: string; value?: string[] } {
  if (!text.trim()) return { ok: false, message: "" };
  const definitions = parseLaunchOptionDefinitions(text);
  if (!definitions) return { ok: false, message: t.invalidOption };
  if (definitions.some(definition => definition.kind === "environment" && reserved.has(definition.name))) return { ok: false, message: t.reservedOption };
  return { ok: true, message: "", value: definitions.map(renderLaunchOptionDefinition) };
}

const fieldLabel = { fontSize: 13, color: "#a9b1b8", marginBottom: 8 } as const;
const field = { ...mono, fontSize: 16, lineHeight: "22px", padding: "12px 14px", overflowWrap: "normal", whiteSpace: "pre" } as const;

/** Colours options like code: variable name blue, "=" grey, value orange. */
function Highlighted({ text }: { text: string }) {
  // Spaces stay in place so the colours line up with the text field above.
  return <>{text.split(/(\s+)/).map((word, index) => <Word key={index} text={word} />)}</>;
}

function Word({ text }: { text: string }) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(=)(.*)$/s.exec(text);
  if (!match) return <span style={{ color: "#dcdedf" }}>{text}</span>;
  return <><span style={{ color: colors.accentText }}>{match[1]}</span><span style={{ color: colors.muted }}>=</span><span style={{ color: colors.warning }}>{match[3]}</span></>;
}

function OptionEditor({ t, option, group, onSave, closeModal }: {
  t: Translations; option?: CustomOption; group: OptionGroup;
  onSave: (name: string, definitions: string[] | undefined) => Promise<void>; closeModal?: () => void;
}) {
  const editableContent = !option?.detected;
  const [content, setContent] = useState(option?.definitions.join(" ") || "");
  const [name, setName] = useState(option ? optionName(t, option) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = describe(t, content);
  async function submit() {
    if (editableContent && !check.ok) { setError(check.message || t.invalidOption); return; }
    const shownName = name.trim() || content.trim();
    if (!shownName) { setError(t.nameRequired); return; }
    setBusy(true);
    try { await onSave(shownName, editableContent ? check.value! : undefined); closeModal?.(); }
    catch (cause) {
      logFrontend("error", "Saving a custom launch option failed", cause);
      setError(errorMessage(cause instanceof Error ? cause.message : "unknownError", t)); setBusy(false);
    }
  }
  return <ModalRoot closeModal={closeModal} className="gcm-font gcm-dialog">
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>{option ? t.editOption : group === "game" ? t.newGameOption : t.newGlobalOption}</div>
      <div>
        <div style={fieldLabel}>{t.optionName}</div>
        <TextField value={name} style={{ fontSize: 16 }} onChange={event => { setName(event.target.value); setError(""); }} />
      </div>
      <div>
        <div style={fieldLabel}>{t.optionContent}</div>
        {editableContent ? <div className="gcm-code" style={{ position: "relative", borderRadius: 3, background: "#0e141b", border: "1px solid rgba(26,159,255,.6)" }}>
          <div aria-hidden style={{ ...field, position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", border: "1px solid transparent" }}>
            <Highlighted text={content} /></div>
          <TextField value={content} style={{ ...field, color: "transparent", caretColor: "#fff" }}
            onChange={event => { setContent(event.target.value); setError(""); }} />
        </div> : <div style={{ ...field, borderRadius: 3, background: "#0e141b", border: "1px solid rgba(255,255,255,.14)", whiteSpace: "normal", overflowWrap: "anywhere" }}>
          {option?.definitions.map((definition, index) => <span key={index}>{index ? " " : ""}<Highlighted text={definition} /></span>)}</div>}
      </div>
      {error && <div role="alert" style={{ fontSize: 13, color: colors.danger }}>{error}</div>}
      <Focusable flow-children="row" style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 6 }}>
        <Button style={{ padding: "0 18px" }} onClick={closeModal}>{t.cancel}</Button>
        <Button primary style={{ padding: "0 22px", fontWeight: 500 }} disabled={busy} onClick={() => { void submit(); }}>{t.save}</Button>
      </Focusable>
    </div>
  </ModalRoot>;
}

export default function CustomOptions({ appId }: { appId: string }) {
  const t = useTranslations();
  const saved = useCustomOptions();
  const context = useLaunchContext();
  const { options, error, update } = useLaunchOptions(appId);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<OptionGroup>("global");

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await work(); }
    catch (error) {
      logFrontend("error", "Custom launch options", error);
      setMessage(error instanceof Error ? error.message : "unknownError");
    }
    finally { setBusy(false); }
  }

  // Words nothing else accounts for show as this game's "user launch
  // options". Only global options and this game's own count as known.
  const visible = saved ? [...optionsIn(saved, "global", appId), ...optionsIn(saved, "game", appId)] : [];
  const live = options !== undefined && saved ? detectedOption(options, visible, appId, context.home) : undefined;
  /** The saved list with `option` in it: the live row is added when the user first changes it. */
  const withOption = (option: CustomOption) => saved!.some(item => item.id === option.id) ? saved! : [...saved!, option];

  if (options === undefined || !saved) {
    return error ? <Status message={errorMessage(error, t)} /> : <Spinner style={{ height: 32 }} />;
  }
  const editable = LaunchOptions.parse(options).editable;
  const disabled = busy || !editable;

  function create() {
    const modal = showModal(<OptionEditor t={t} group={group} onSave={async (name, definitions) => {
      const option: CustomOption = { id: newId(), name, definitions: definitions!, ...(group === "game" ? { app_id: appId } : {}) };
      await saveOptions([...saved!, option]);
      // A new option is made for the game it was created on.
      await update(current => setOptionEnabled(current, option, true, context), `Turn on new custom option "${name}"`);
    }} closeModal={() => modal.Close()} />, window);
  }
  function edit(option: CustomOption) {
    const modal = showModal(<OptionEditor t={t} option={option} group={group} onSave={async (name, definitions) => {
      // The live "user launch options" row is saved under a new ID when first changed.
      const next: CustomOption = { ...option, id: option.id === live?.id ? newId() : option.id, name, ...(definitions ? { definitions } : {}) };
      await saveOptions([...saved!.filter(item => item.id !== option.id), next]);
      if (definitions && isOptionEnabled(options!, option, context)) {
        await update(current => setOptionEnabled(setOptionEnabled(current, option, false, context), next, true, context), `Apply edited custom option "${name}"`);
      }
    }} closeModal={() => modal.Close()} />, window);
  }
  function remove(option: CustomOption) {
    showModal(<ConfirmModal strTitle={t.deleteOption} strDescription={t.deleteDescription(optionName(t, option))}
      strOKButtonText={t.delete} strCancelButtonText={t.cancel} onOK={() => { void run(async () => {
        if (isOptionEnabled(options!, option, context)) await update(current => setOptionEnabled(current, option, false, context), `Turn off deleted custom option "${optionName(t, option)}"`);
        await saveOptions(saved!.filter(item => item.id !== option.id));
      }); }} />, window);
  }
  function setEnabled(option: CustomOption, checked: boolean) {
    const apply = () => run(async () => {
      // The live row is saved before its words go, so it can be turned back on.
      if (option.id === live?.id) await saveOptions(withOption({ ...option, id: newId() }));
      await update(current => setOptionEnabled(current, option, checked, context), `Turn custom option "${optionName(t, option)}" ${checked ? "on" : "off"}`);
      // A preset's tool is looked for only when it is turned on.
      if (checked && option.preset) await checkPresets();
    });
    // Words another tool wrote are only removed after a warning.
    if (option.detected && !checked) {
      showModal(<ConfirmModal strTitle={t.detectedOffTitle} strDescription={t.detectedOffDescription}
        strOKButtonText={t.turnOff} strCancelButtonText={t.cancel} onOK={() => { void apply(); }} />, window);
      return;
    }
    void apply();
  }

  const globalOptions = optionsIn(saved, "global", appId);
  const gameOptions = [...(live ? [live] : []), ...optionsIn(saved, "game", appId)];
  const wordsOf = (list: CustomOption[]) =>
    new Set(list.filter(option => isOptionEnabled(options, option, context)).flatMap(option => optionDefinitions(option).map(definition => definitionKey(definition, context.home))));
  const globalWords = wordsOf(globalOptions), gameWords = wordsOf(gameOptions);
  const trainerNames = new Set(TRAINER_NAMES);
  const common = new Set(COMMON_NAMES);
  // The user's own launch options come first in the game group.
  const shown = group === "game"
    ? [...gameOptions.filter(option => option.detected), ...gameOptions.filter(option => !option.detected)]
    : globalOptions;

  const card = (value: OptionGroup, title: string, count: number) => {
    const chosen = group === value;
    const tone = value === "game" ? GAME : GLOBAL;
    return <Focusable className="gcm-card" role="radio" aria-checked={chosen} onActivate={() => setGroup(value)} style={{
      boxSizing: "border-box", padding: "clamp(8px, 1.6vh, 14px) 18px", borderRadius: 6, cursor: "pointer", display: "flex", flexDirection: "column", gap: 6,
      border: `1px solid ${chosen ? tone.border : "rgba(255,255,255,.08)"}`, background: chosen ? tone.surface : "#1b1f26",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden style={{
          display: "inline-flex", width: 22, height: 22, flex: "0 0 22px", boxSizing: "border-box", borderRadius: 11, alignItems: "center", justifyContent: "center",
          border: `2px solid ${chosen ? tone.solid : colors.muted}`, background: chosen ? "transparent" : "#fff",
        }}>{chosen && <span style={{ width: 12, height: 12, borderRadius: 6, background: tone.solid }} />}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: colors.text }}>{title}</span>
        {/* The bumper that picks this card: L1 for the left one, R1 for the right one. */}
        <BumperGlyph side={value === "global" ? "L" : "R"} color={colors.muted} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: tone.text }}>{t.itemCount(count)}</span>
      </span>
    </Focusable>;
  };

  // L1/R1 pick the global or the game group from anywhere on the page.
  return <Focusable flow-children="column" onButtonDown={bumperStep(direction => setGroup(direction < 0 ? "global" : "game"))}>
    <PageHeader title={t.tabCustom} gap={14}>
      <Button primary style={{ fontWeight: 500 }} disabled={busy} onClick={create}><PlusIcon size={16} />{t.newShort}</Button>
    </PageHeader>
    <Status message={!editable ? t.unsafeOptions : undefined} tone="warning" />
    <Status message={message || error ? errorMessage(message || error, t) : undefined} />
    <Preview t={t} source={options} context={context}
      ownerOf={(text, name) => text && gameWords.has(text) ? "game" : text && globalWords.has(text) ? "page"
        : name && common.has(name) ? "common" : name && trainerNames.has(name) ? "modifier" : "other"} />
    <Focusable flow-children="row" role="radiogroup" aria-label={t.optionGroups}
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
      {card("global", t.globalOptions, globalOptions.length)}
      {card("game", t.gameOptions, gameOptions.length)}
    </Focusable>
    {shown.map(option => {
      const enabled = isOptionEnabled(options, option, context);
      const actions: MenuAction[] = [{ label: t.edit, onSelect: () => edit(option), disabled: busy }];
      if (option.id !== live?.id) actions.push({ label: t.delete, tone: "danger", onSelect: () => remove(option), disabled: busy });
      // Shown only while on, and not enforced: the user may install the tool later.
      const missing = enabled && option.preset && !presetInstalled(option.preset);
      return <Row dense key={option.id}
        title={<>{optionName(t, option)}{missing && <span style={{
          // Shorter than the title's line, which clips anything taller.
          display: "inline-block", marginLeft: 10, padding: "0 6px", border: `1px solid ${colors.danger}`, borderRadius: 3,
          fontSize: 12, lineHeight: "16px", color: colors.danger, verticalAlign: "2px",
        }}>{t.presetMissing}</span>}</>}
        description={<span style={{ ...mono, color: enabled ? (group === "game" ? GAME.text : GLOBAL.text) : undefined }}>{option.definitions.join(" ")}</span>}
        more={{ label: t.more, actions }}
        trailing={<Toggle value={enabled} disabled={disabled} onChange={checked => setEnabled(option, checked)} />} />;
    })}
    <div style={{ borderTop: `1px solid ${colors.line}` }} />
  </Focusable>;
}

// Global options are blue and game options teal, on the cards, rows and preview.
const GLOBAL = { solid: "#1a9fff", text: "#7cc4ff", border: "rgba(26,159,255,.7)", surface: "#12263b" };
const GAME = { solid: "#22b8a0", text: "#5ee0c8", border: "rgba(34,184,160,.75)", surface: "#0f2b2a" };
