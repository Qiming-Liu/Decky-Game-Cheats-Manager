import { ConfirmModal, Focusable, ModalRoot, showModal, Spinner, TextField, Toggle } from "@decky/ui";
import { useEffect, useState } from "react";
import { FaCheck, FaLock, FaPen, FaPlus, FaTimes, FaTrashAlt } from "react-icons/fa";
import { COMMON_NAMES } from "../domain/common";
import { CustomOption, isOptionEnabled, optionDefinitions, setOptionEnabled, unrecognized } from "../domain/custom";
import { LaunchOptions, parseLaunchOptionDefinition, renderLaunchOptionDefinition } from "../domain/options";
import { SIDECAR_NAMES } from "../domain/sidecar";
import { saveOptions, useCustomOptions } from "../hooks/useCustomOptions";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, IconButton, iconStyle, mono, PageHeader, Preview, Row, Status } from "./shell";

const presetNames = (t: Translations): Record<string, string> => ({
  lsfg: t.presetLsfg, optiscaler: t.presetOptiscaler, optiscalerRemove: t.presetOptiscalerRemove, mako: t.presetMako,
});
export const optionName = (t: Translations, option: CustomOption) =>
  option.name || (option.preset && presetNames(t)[option.preset]) || (option.detected ? t.detectedName : "");
const newId = () => `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const reserved = new Set([...COMMON_NAMES, ...SIDECAR_NAMES]);
const kindLabel = (t: Translations, kind: string) => kind === "environment" ? t.tagEnvironment : kind === "prefix" ? t.tagPrefix : t.tagArgument;

/** Validates one launch option typed by the user and says where it goes. */
function describe(t: Translations, text: string): { ok: boolean; message: string; value?: string } {
  if (!text.trim()) return { ok: false, message: "" };
  const definition = parseLaunchOptionDefinition(text.trim());
  if (!definition) return { ok: false, message: t.invalidOption };
  if (definition.kind === "environment" && reserved.has(definition.name)) return { ok: false, message: t.reservedOption };
  const message = definition.kind === "environment" ? t.kindEnvironment : definition.kind === "prefix" ? t.kindPrefix : t.kindArgument;
  return { ok: true, message, value: renderLaunchOptionDefinition(definition) };
}

const fieldLabel = { fontSize: 13, color: "#a9b1b8", marginBottom: 6 } as const;

function OptionEditor({ t, option, onSave, closeModal }: {
  t: Translations; option?: CustomOption;
  onSave: (name: string, definitions: string[] | undefined, enable: boolean) => Promise<void>; closeModal?: () => void;
}) {
  const editableContent = !option?.detected && (option?.definitions.length ?? 1) === 1;
  const [content, setContent] = useState(option?.definitions[0] || "");
  const [name, setName] = useState(option ? optionName(t, option) : "");
  const [nameTouched, setNameTouched] = useState(Boolean(option));
  const [enable, setEnable] = useState(!option);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = describe(t, content);
  // The name follows the content until the user types one.
  const shownName = nameTouched ? name : content.trim();
  async function submit() {
    if (!shownName.trim()) { setError(t.nameRequired); return; }
    if (editableContent && !check.ok) { setError(check.message || t.invalidOption); return; }
    setBusy(true);
    try { await onSave(shownName.trim(), editableContent ? [check.value!] : undefined, enable); closeModal?.(); }
    catch (cause) { setError(errorMessage(cause instanceof Error ? cause.message : "unknownError", t)); setBusy(false); }
  }
  return <ModalRoot closeModal={closeModal}>
    <div style={{ fontSize: 22, fontWeight: 700, color: colors.text, marginBottom: 16 }}>{option ? t.editOption : t.newOption}</div>
    {editableContent ? <>
      <div style={fieldLabel}>{t.optionContent}</div>
      <TextField value={content} style={mono} onChange={event => { setContent(event.target.value); setError(""); }} />
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, minHeight: 20, marginTop: 6, color: check.ok ? colors.success : colors.danger }}>
        {check.message && (check.ok ? <FaCheck aria-hidden /> : <FaTimes aria-hidden />)}<span>{check.message}</span></div>
      <div style={{ ...fieldLabel, fontSize: 12, marginTop: 12 }}>{t.examples}</div>
      <Focusable flow-children="row" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["MANGOHUD=1", "gamemoderun", "-windowed", "-dx11", "DXVK_ASYNC=1"].map(example =>
          <Button key={example} style={{ height: 32, padding: "0 12px", borderRadius: 16, fontSize: 13, ...mono }}
            onClick={() => { setContent(example); setError(""); }}>{example}</Button>)}
      </Focusable>
      <div style={{ fontSize: 12, color: colors.dim, marginTop: 8 }}>{t.invalidOption}</div>
    </> : <div style={{ ...mono, color: colors.muted, marginBottom: 12 }}>{option?.definitions.join(" ")}</div>}
    <div style={{ ...fieldLabel, marginTop: 16 }}>{t.optionName} <span style={{ color: colors.dim }}>{!option && t.nameAuto}</span></div>
    <TextField value={shownName} onChange={event => { setName(event.target.value); setNameTouched(true); setError(""); }} />
    {error && <div role="alert" style={{ fontSize: 13, marginTop: 8, color: colors.danger }}>{error}</div>}
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, paddingTop: 12, borderTop: `1px solid ${colors.line}` }}>
      {!option && <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, flex: "1 1 auto" }}>
        <Toggle value={enable} onChange={setEnable} />{t.enableAfterSave}</label>}
      <div style={{ flex: "1 1 auto" }} />
      <Button onClick={closeModal}>{t.cancel}</Button>
      <Button primary disabled={busy} onClick={() => { void submit(); }}>{t.save}</Button>
    </Focusable>
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
    const modal = showModal(<OptionEditor t={t} onSave={async (name, definitions, enable) => {
      const option: CustomOption = { id: newId(), name, definitions: definitions! };
      await saveOptions([...saved!, option]);
      if (enable) await update(current => setOptionEnabled(current, option, true));
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

  return <Focusable flow-children="column">
    <PageHeader title={t.tabCustom} note={t.sharedListHint}>
      <Button primary disabled={busy} onClick={create}><FaPlus aria-hidden style={iconStyle} />{t.newShort}</Button>
    </PageHeader>
    <Status message={!editable ? t.unsafeOptions : undefined} tone="warning" />
    <Status message={message || error ? errorMessage(message || error, t) : undefined} />
    {saved.map(option => {
      const enabled = isOptionEnabled(options, option);
      const definitions = optionDefinitions(option);
      const kind = definitions.length === 1 ? kindLabel(t, definitions[0].kind) : undefined;
      const description = <>
        <span style={{ color: option.detected ? colors.warning : "#a9b1b8" }}>{option.detected ? t.detectedHint : kind} · </span>
        <span style={mono}>{option.definitions.join(" ")}</span></>;
      return <Row key={option.id} icon={option.detected ? <FaLock color={colors.warning} /> : undefined}
        title={optionName(t, option)} description={description} highlight={enabled}>
        {!option.detected && <IconButton label={t.edit} disabled={busy} onClick={() => edit(option)}><FaPen aria-hidden /></IconButton>}
        {!option.detected && <IconButton tone="danger" label={t.delete} disabled={busy} onClick={() => remove(option)}><FaTrashAlt aria-hidden /></IconButton>}
        <Toggle value={enabled} disabled={disabled} onChange={checked => setEnabled(option, checked)} />
      </Row>;
    })}
    <div style={{ borderTop: `1px solid ${colors.line}` }} />
    <Preview t={t} source={options} legend={t.legendCustom}
      ownerOf={(text, name) => text && ours.has(text) ? "page" : name && sidecarNames.has(name) ? "modifier" : "other"} />
  </Focusable>;
}
