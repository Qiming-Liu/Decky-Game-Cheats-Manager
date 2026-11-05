import {
  ConfirmModal, DialogButton, Field, Focusable, Menu, MenuItem, ModalRoot, showContextMenu, showModal, Spinner, TextField, Toggle,
} from "@decky/ui";
import { useEffect, useState } from "react";
import { FaCheck, FaEllipsisH, FaPlus, FaTimes } from "react-icons/fa";
import { COMMON_NAMES } from "../domain/common";
import { CustomOption, isOptionEnabled, optionDefinitions, setOptionEnabled, unrecognized } from "../domain/custom";
import { LaunchOptions, parseLaunchOptionDefinition, renderLaunchOptionDefinition } from "../domain/options";
import { SIDECAR_NAMES } from "../domain/sidecar";
import { saveOptions, useCustomOptions } from "../hooks/useCustomOptions";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { commandStyle } from "./CommonSettings";

const presetNames = (t: Translations): Record<string, string> => ({
  lsfg: t.presetLsfg, optiscaler: t.presetOptiscaler, optiscalerRemove: t.presetOptiscalerRemove, mako: t.presetMako,
});
export const optionName = (t: Translations, option: CustomOption) =>
  option.name || (option.preset && presetNames(t)[option.preset]) || (option.detected ? t.userDefined : "");
const newId = () => `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const reserved = new Set([...COMMON_NAMES, ...SIDECAR_NAMES]);

/** Validates one launch option typed by the user and says where it goes. */
function describe(t: Translations, text: string): { ok: boolean; message: string; value?: string } {
  if (!text.trim()) return { ok: false, message: "" };
  const definition = parseLaunchOptionDefinition(text.trim());
  if (!definition) return { ok: false, message: t.invalidOption };
  if (definition.kind === "environment" && reserved.has(definition.name)) return { ok: false, message: t.reservedOption };
  const message = definition.kind === "environment" ? t.kindEnvironment : definition.kind === "prefix" ? t.kindPrefix : t.kindArgument;
  return { ok: true, message, value: renderLaunchOptionDefinition(definition) };
}

function OptionEditor({ t, option, onSave, closeModal }: {
  t: Translations; option?: CustomOption; onSave: (name: string, definitions?: string[]) => Promise<void>; closeModal?: () => void;
}) {
  const [name, setName] = useState(option ? optionName(t, option) : "");
  const editableContent = !option?.detected && (option?.definitions.length ?? 1) === 1;
  const [content, setContent] = useState(option?.definitions[0] || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = describe(t, content);
  async function submit() {
    if (!name.trim()) { setError(t.nameRequired); return; }
    if (editableContent && !check.ok) { setError(check.message || t.invalidOption); return; }
    setBusy(true);
    try { await onSave(name.trim(), editableContent ? [check.value!] : undefined); closeModal?.(); }
    catch (cause) { setError(errorMessage(cause instanceof Error ? cause.message : "unknownError", t)); setBusy(false); }
  }
  return <ModalRoot closeModal={closeModal}>
    <div style={{ fontSize: 20, marginBottom: 12 }}>{option ? t.editOption : t.newOption}</div>
    <TextField label={t.optionName} value={name} onChange={event => { setName(event.target.value); setError(""); }} />
    {editableContent ? <>
      <TextField label={t.optionContent} value={content} onChange={event => { setContent(event.target.value); setError(""); }} />
      {check.message && <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 6, color: check.ok ? "#59bf40" : "#e35b5b" }}>
        {check.ok ? <FaCheck aria-hidden /> : <FaTimes aria-hidden />}<span>{check.message}</span></div>}
      {!option && <div style={{ fontSize: 13, opacity: .6, marginTop: 12 }}>{t.examples}</div>}
      {!option && <Focusable flow-children="row" style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        {["MANGOHUD=1", "gamemoderun", "-windowed", "-dx11"].map(example =>
          <DialogButton key={example} style={{ width: "auto", minWidth: 0, padding: "4px 10px", fontFamily: "monospace" }}
            onClick={() => { setContent(example); setError(""); }}>{example}</DialogButton>)}
      </Focusable>}
    </> : <div style={{ ...commandStyle, marginTop: 10 }}>{option?.definitions.join(" ")}</div>}
    {error && <div role="alert" style={{ fontSize: 13, marginTop: 8, color: "#e35b5b" }}>{error}</div>}
    <Focusable flow-children="row" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
      <DialogButton style={{ width: "auto" }} onClick={closeModal}>{t.cancel}</DialogButton>
      <DialogButton style={{ width: "auto" }} disabled={busy} onClick={() => { void submit(); }}>{option ? t.save : t.saveAndEnable}</DialogButton>
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

  // Words nothing else accounts for are kept as one "user defined" option.
  const leftovers = options !== undefined && saved ? unrecognized(options, saved) : [];
  const leftoverKey = leftovers.join("\n");
  useEffect(() => {
    if (!saved || !leftovers.length) return;
    void saveOptions([{ id: newId(), name: "", detected: true, definitions: leftovers }, ...saved]).catch(() => {});
  }, [leftoverKey, Boolean(saved)]);

  if (options === undefined || !saved) {
    return error ? <div role="status">{errorMessage(error, t)}</div> : <Spinner style={{ height: 32 }} />;
  }
  const editable = LaunchOptions.parse(options).editable;
  const disabled = busy || !editable;
  const preview = LaunchOptions.parse(options).canonical();

  function create() {
    const modal = showModal(<OptionEditor t={t} onSave={async (name, definitions) => {
      const option: CustomOption = { id: newId(), name, definitions: definitions! };
      await saveOptions([...saved!, option]);
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
  function openMenu(option: CustomOption, target?: EventTarget) {
    showContextMenu(<Menu label={optionName(t, option)}>
      <MenuItem onSelected={() => edit(option)}>{t.edit}</MenuItem>
      <MenuItem tone="destructive" onSelected={() => remove(option)}>{t.delete}</MenuItem>
    </Menu>, target);
  }

  const enabledOptions = saved.filter(option => isOptionEnabled(options, option));
  const ours = new Set(enabledOptions.flatMap(option => optionDefinitions(option).map(renderLaunchOptionDefinition)));
  const segments = LaunchOptions.parse(preview).segments();

  return <Focusable flow-children="column">
    {!editable && <div role="status" style={{ marginBottom: 8 }}>{t.unsafeOptions}</div>}
    {(message || error) && <div role="status" style={{ overflowWrap: "anywhere", marginBottom: 8 }}>{errorMessage(message || error, t)}</div>}
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ flex: "1 1 auto", fontSize: 13, opacity: .6 }}>{t.enabledCount(enabledOptions.length)}</span>
      <DialogButton style={{ width: "auto", minWidth: 0, padding: "4px 14px" }} disabled={busy} onClick={create}>
        <FaPlus aria-hidden /> {t.newShort}</DialogButton>
    </Focusable>
    {saved.map(option => {
      const enabled = isOptionEnabled(options, option);
      const definitions = optionDefinitions(option);
      const kind = definitions.length === 1 ? definitions[0].kind : undefined;
      return <Field key={option.id} label={optionName(t, option)} childrenContainerWidth="min"
        description={<span style={commandStyle}>{option.definitions.join(" ")}</span>}>
        <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {kind && <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "rgba(127, 119, 221, .25)", color: "#b9b4f0", whiteSpace: "nowrap" }}>
            {kind === "environment" ? t.tagEnvironment : kind === "prefix" ? t.tagPrefix : t.tagArgument}</span>}
          <DialogButton aria-label={t.moreActions} style={{ width: 40, minWidth: 40, height: 40, padding: 0 }}
            disabled={busy} onClick={event => openMenu(option, event.currentTarget ?? undefined)}><FaEllipsisH aria-hidden /></DialogButton>
          <Toggle value={enabled} disabled={disabled}
            onChange={checked => { void run(() => update(current => setOptionEnabled(current, option, checked))); }} />
        </Focusable>
      </Field>;
    })}
    <div style={{ fontSize: 13, opacity: .6, margin: "16px 0 4px" }}>{t.steamReceives}</div>
    <div style={{ ...commandStyle, opacity: 1, background: "#23262e", padding: 10, borderRadius: 4, lineHeight: 1.6 }}>
      {segments.length ? segments.map((segment, index) => <span key={index} style={{
        color: segment.definition && ours.has(renderLaunchOptionDefinition(segment.definition)) ? "#1a9fff"
          : "#8b929a",
      }}>{index ? " " : ""}{segment.text}</span>) : t.noLaunchOptions}
    </div>
    <div style={{ fontSize: 12, opacity: .5, marginTop: 4 }}>{t.previewLegend}</div>
  </Focusable>;
}
