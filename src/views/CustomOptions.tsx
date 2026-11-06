import { ConfirmModal, Focusable, ModalRoot, showModal, Spinner, TextField, Toggle } from "@decky/ui";
import { useEffect, useState } from "react";
import { COMMON_NAMES } from "../domain/common";
import { CustomOption, isOptionEnabled, optionDefinitions, setOptionEnabled, unrecognized } from "../domain/custom";
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

function OptionEditor({ t, option, onSave, closeModal }: {
  t: Translations; option?: CustomOption;
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
      <div style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>{option ? t.editOption : t.newOption}</div>
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

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }

  // Words nothing else accounts for are kept as one "already in Steam" option.
  const leftovers = options !== undefined && saved ? unrecognized(options, saved) : [];
  const leftoverKey = leftovers.join("\n");
  useEffect(() => {
    if (!saved || !leftovers.length) return;
    void saveOptions([{ id: newId(), name: "", detected: true, definitions: leftovers }, ...saved]).catch(() => {});
  }, [leftoverKey, Boolean(saved)]);

  if (options === undefined || !saved) {
    return error ? <Status message={errorMessage(error, t)} /> : <Spinner style={{ height: 32 }} />;
  }
  const editable = LaunchOptions.parse(options).editable;
  const disabled = busy || !editable;

  function create() {
    const modal = showModal(<OptionEditor t={t} onSave={async (name, definitions) => {
      const option: CustomOption = { id: newId(), name, definitions: definitions! };
      await saveOptions([...saved!, option]);
      // A new option is made for the game it was created on.
      await update(current => setOptionEnabled(current, option, true));
    }} closeModal={() => modal.Close()} />, window);
  }
  function edit(option: CustomOption) {
    const modal = showModal(<OptionEditor t={t} option={option} onSave={async (name, definitions) => {
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

  const enabledOptions = saved.filter(option => isOptionEnabled(options, option));
  const ours = new Set(enabledOptions.flatMap(option => optionDefinitions(option).map(renderLaunchOptionDefinition)));
  const sidecarNames = new Set(SIDECAR_NAMES);

  const common = new Set(COMMON_NAMES);
  // The words other tools wrote come first: they are this game's own launch options.
  const ordered = [...saved.filter(option => option.detected), ...saved.filter(option => !option.detected)];

  return <Focusable flow-children="column">
    <PageHeader title={t.tabCustom} note={t.sharedListHint} gap={14}>
      <Button primary style={{ fontWeight: 500 }} disabled={busy} onClick={create}><PlusIcon size={16} />{t.newShort}</Button>
    </PageHeader>
    <Status message={!editable ? t.unsafeOptions : undefined} tone="warning" />
    <Status message={message || error ? errorMessage(message || error, t) : undefined} />
    <Preview t={t} source={options}
      ownerOf={(text, name) => text && ours.has(text) ? "page" : name && common.has(name) ? "common" : name && sidecarNames.has(name) ? "modifier" : "other"} />
    {ordered.map(option => {
      const enabled = isOptionEnabled(options, option);
      const actions: MenuAction[] = [{ label: t.edit, onSelect: () => edit(option), disabled: busy }];
      if (!option.detected) actions.push({ label: t.delete, tone: "danger", onSelect: () => remove(option), disabled: busy });
      return <Row key={option.id} icon={option.detected ? <LockIcon color={colors.warning} /> : undefined}
        title={optionName(t, option)} description={<span style={mono}>{option.definitions.join(" ")}</span>} more={{ label: t.more, actions }}
        trailing={<Toggle value={enabled} disabled={disabled} onChange={checked => setEnabled(option, checked)} />} />;
    })}
    <div style={{ borderTop: `1px solid ${colors.line}` }} />
  </Focusable>;
}
