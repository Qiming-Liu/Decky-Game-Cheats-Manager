import { ConfirmModal, Focusable, ModalRoot, showModal, Spinner, TextField, Toggle } from "@decky/ui";
import { useEffect, useState } from "react";
import { COMMON_NAMES } from "../domain/common";
import { CustomOption, isOptionEnabled, optionDefinitions, OptionGroup, optionsIn, setOptionEnabled, unrecognized } from "../domain/custom";
import { LaunchOptions, parseLaunchOptionDefinition, renderLaunchOptionDefinition } from "../domain/options";
import { SIDECAR_NAMES } from "../domain/sidecar";
import { saveOptions, useCustomOptions } from "../hooks/useCustomOptions";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, MenuAction, mono, PageHeader, Preview, Row, Status } from "./shell";
import { LockIcon, PlusIcon } from "./icons";

const presetNames = (t: Translations): Record<string, string> => ({
  lsfg: t.presetLsfg, optiscaler: t.presetOptiscaler, optiscalerRemove: t.presetOptiscalerRemove, mako: t.presetMako,
});
export const optionName = (t: Translations, option: CustomOption) =>
  option.name || (option.preset && presetNames(t)[option.preset]) || (option.detected ? t.detectedName : "");
const newId = () => `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const reserved = new Set([...COMMON_NAMES, ...SIDECAR_NAMES]);

/** Validates one launch option typed by the user. */
function describe(t: Translations, text: string): { ok: boolean; message: string; value?: string } {
  if (!text.trim()) return { ok: false, message: "" };
  const definition = parseLaunchOptionDefinition(text.trim());
  if (!definition) return { ok: false, message: t.invalidOption };
  if (definition.kind === "environment" && reserved.has(definition.name)) return { ok: false, message: t.reservedOption };
  return { ok: true, message: "", value: renderLaunchOptionDefinition(definition) };
}

const fieldLabel = { fontSize: 13, color: "#a9b1b8", marginBottom: 8 } as const;
const field = { ...mono, fontSize: 16, lineHeight: "22px", padding: "12px 14px", overflowWrap: "normal", whiteSpace: "pre" } as const;

/** Colours an option like code: variable name blue, "=" grey, value orange. */
function Highlighted({ text }: { text: string }) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(=)(.*)$/s.exec(text);
  if (!match) return <span style={{ color: "#dcdedf" }}>{text}</span>;
  return <><span style={{ color: colors.accentText }}>{match[1]}</span><span style={{ color: colors.muted }}>=</span><span style={{ color: colors.warning }}>{match[3]}</span></>;
}

function OptionEditor({ t, option, group, onSave, closeModal }: {
  t: Translations; option?: CustomOption; group: OptionGroup;
  onSave: (name: string, definitions: string[] | undefined) => Promise<void>; closeModal?: () => void;
}) {
  const editableContent = !option?.detected && (option?.definitions.length ?? 1) === 1;
  const [content, setContent] = useState(option?.definitions[0] || "");
  const [name, setName] = useState(option ? optionName(t, option) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = describe(t, content);
  async function submit() {
    if (editableContent && !check.ok) { setError(check.message || t.invalidOption); return; }
    const shownName = name.trim() || content.trim();
    if (!shownName) { setError(t.nameRequired); return; }
    setBusy(true);
    try { await onSave(shownName, editableContent ? [check.value!] : undefined); closeModal?.(); }
    catch (cause) { setError(errorMessage(cause instanceof Error ? cause.message : "unknownError", t)); setBusy(false); }
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
  const { options, error, update } = useLaunchOptions(appId);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<OptionGroup>("global");

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }

  // Words nothing else accounts for are kept as this game's "user launch
  // options". Only global options and this game's own count as known.
  const visible = saved ? [...optionsIn(saved, "global", appId), ...optionsIn(saved, "game", appId)] : [];
  const leftovers = options !== undefined && saved ? unrecognized(options, visible) : [];
  const leftoverKey = leftovers.join("\n");
  useEffect(() => {
    if (!saved || !leftovers.length) return;
    // Older versions kept detected words without a game; they are replaced per game.
    const kept = saved.filter(option => !option.detected || option.app_id);
    void saveOptions([{ id: newId(), name: "", detected: true, app_id: appId, definitions: leftovers }, ...kept]).catch(() => {});
  }, [leftoverKey, Boolean(saved)]);

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
      await update(current => setOptionEnabled(current, option, true));
    }} closeModal={() => modal.Close()} />, window);
  }
  function edit(option: CustomOption) {
    const modal = showModal(<OptionEditor t={t} option={option} group={group} onSave={async (name, definitions) => {
      const next: CustomOption = { ...option, name, ...(definitions ? { definitions } : {}) };
      await saveOptions(saved!.map(item => item.id === option.id ? next : item));
      if (definitions && isOptionEnabled(options!, option)) {
        await update(current => setOptionEnabled(setOptionEnabled(current, option, false), next, true));
      }
    }} closeModal={() => modal.Close()} />, window);
  }
  function remove(option: CustomOption) {
    showModal(<ConfirmModal strTitle={t.deleteOption} strDescription={t.deleteDescription(optionName(t, option))}
      strOKButtonText={t.delete} strCancelButtonText={t.cancel} onOK={() => { void run(async () => {
        if (isOptionEnabled(options!, option)) await update(current => setOptionEnabled(current, option, false));
        await saveOptions(saved!.filter(item => item.id !== option.id));
      }); }} />, window);
  }
  function setEnabled(option: CustomOption, checked: boolean) {
    const apply = () => run(() => update(current => setOptionEnabled(current, option, checked)));
    // Words another tool wrote are only removed after a warning.
    if (option.detected && !checked) {
      showModal(<ConfirmModal strTitle={t.detectedOffTitle} strDescription={t.detectedOffDescription}
        strOKButtonText={t.turnOff} strCancelButtonText={t.cancel} onOK={() => { void apply(); }} />, window);
      return;
    }
    void apply();
  }

  const globalOptions = optionsIn(saved, "global", appId);
  const gameOptions = optionsIn(saved, "game", appId);
  const wordsOf = (list: CustomOption[]) =>
    new Set(list.filter(option => isOptionEnabled(options, option)).flatMap(option => optionDefinitions(option).map(renderLaunchOptionDefinition)));
  const globalWords = wordsOf(globalOptions), gameWords = wordsOf(gameOptions);
  const sidecarNames = new Set(SIDECAR_NAMES);
  const common = new Set(COMMON_NAMES);
  // The user's own launch options come first in the game group.
  const shown = group === "game"
    ? [...gameOptions.filter(option => option.detected), ...gameOptions.filter(option => !option.detected)]
    : globalOptions;

  const card = (value: OptionGroup, title: string, hint: string, count: number) => {
    const chosen = group === value;
    const tone = value === "game" ? GAME : GLOBAL;
    return <Focusable className="gcm-row" role="radio" aria-checked={chosen} onActivate={() => setGroup(value)} style={{
      boxSizing: "border-box", minHeight: 84, padding: "14px 18px", borderRadius: 6, cursor: "pointer", display: "flex", flexDirection: "column", gap: 6,
      border: `1px solid ${chosen ? tone.border : "rgba(255,255,255,.08)"}`, background: chosen ? tone.surface : "#1b1f26",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden style={{
          display: "inline-flex", width: 22, height: 22, flex: "0 0 22px", boxSizing: "border-box", borderRadius: 11, alignItems: "center", justifyContent: "center",
          border: `2px solid ${chosen ? tone.solid : colors.muted}`, background: chosen ? "transparent" : "#fff",
        }}>{chosen && <span style={{ width: 12, height: 12, borderRadius: 6, background: tone.solid }} />}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: colors.text }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: tone.text }}>{t.itemCount(count)}</span>
      </span>
      <span style={{ fontSize: 13, color: "#a9b1b8" }}>{hint}</span>
    </Focusable>;
  };

  return <Focusable flow-children="column">
    <PageHeader title={t.tabCustom} note={t.switchesThisGame} gap={14}>
      <Button primary style={{ fontWeight: 500 }} disabled={busy} onClick={create}><PlusIcon size={16} />{t.newShort}</Button>
    </PageHeader>
    <Status message={!editable ? t.unsafeOptions : undefined} tone="warning" />
    <Status message={message || error ? errorMessage(message || error, t) : undefined} />
    <Preview t={t} source={options}
      ownerOf={(text, name) => text && gameWords.has(text) ? "game" : text && globalWords.has(text) ? "page"
        : name && common.has(name) ? "common" : name && sidecarNames.has(name) ? "modifier" : "other"} />
    <Focusable flow-children="row" role="radiogroup" aria-label={t.optionGroups}
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
      {card("global", t.globalOptions, t.globalOptionsHint, globalOptions.length)}
      {card("game", t.gameOptions, t.gameOptionsHint, gameOptions.length)}
    </Focusable>
    {shown.map(option => {
      const enabled = isOptionEnabled(options, option);
      const actions: MenuAction[] = [{ label: t.edit, onSelect: () => edit(option), disabled: busy }];
      if (!option.detected) actions.push({ label: t.delete, tone: "danger", onSelect: () => remove(option), disabled: busy });
      return <Row key={option.id} icon={option.detected ? <LockIcon color={colors.warning} /> : undefined}
        title={optionName(t, option)} description={<span style={{ ...mono, color: enabled ? (group === "game" ? GAME.text : GLOBAL.text) : undefined }}>{option.definitions.join(" ")}</span>}
        more={{ label: t.more, actions }}
        trailing={<Toggle value={enabled} disabled={disabled} onChange={checked => setEnabled(option, checked)} />} />;
    })}
    <div style={{ borderTop: `1px solid ${colors.line}` }} />
  </Focusable>;
}

// Global options are blue and game options teal, on the cards, rows and preview.
const GLOBAL = { solid: "#1a9fff", text: "#7cc4ff", border: "rgba(26,159,255,.7)", surface: "#12263b" };
const GAME = { solid: "#22b8a0", text: "#5ee0c8", border: "rgba(34,184,160,.75)", surface: "#0f2b2a" };
