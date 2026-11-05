import { FileSelectionType, openFilePicker } from "@decky/api";
import { ConfirmModal, DialogButton, DropdownItem, Field, Focusable, showModal, Spinner, ToggleField } from "@decky/ui";
import { CSSProperties, useState } from "react";
import {
  AUDIO_NAME, AUDIO_VALUES, COMPAT_DATA_NAME, LANGUAGES, readCommon, setEnvironment, setLanguage, setToggle, TOGGLES, ToggleId,
} from "../domain/common";
import { LaunchOptions } from "../domain/options";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";

export const commandStyle: CSSProperties = { fontFamily: "monospace", fontSize: 12, opacity: .65, overflowWrap: "anywhere" };

const toggleLabel = (t: Translations, id: ToggleId) => ({
  desktop: t.desktopMode, wined3d: t.fixGraphics, fsync: t.disableFsync, overlay: t.disableOverlay, sdl: t.fixController, log: t.recordLog,
})[id];
// Each language is shown in its own name, as Steam's own language menu does.
const LANGUAGE_LABELS: Record<string, string> = {
  "en_US.UTF-8": "English", "zh_CN.UTF-8": "简体中文", "zh_TW.UTF-8": "繁體中文", "ja_JP.UTF-8": "日本語",
  "ko_KR.UTF-8": "한국어", "de_DE.UTF-8": "Deutsch", "fr_FR.UTF-8": "Français", "es_ES.UTF-8": "Español",
  "it_IT.UTF-8": "Italiano", "pt_BR.UTF-8": "Português (Brasil)", "ru_RU.UTF-8": "Русский", "pl_PL.UTF-8": "Polski",
};
const command = (name: string, value: string) => `${name}=${value === "" ? '""' : value}`;

export default function CommonSettings({ appId }: { appId: string }) {
  const t = useTranslations();
  const { options, error, update } = useLaunchOptions(appId);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function change(edit: (current: string) => string) {
    setBusy(true); setMessage("");
    try { await update(edit); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }
  async function chooseCompatData() {
    let path: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FOLDER, "/home", false, true);
      path = picked.realpath || picked.path;
    } catch { return; }
    await change(current => setEnvironment(current, { [COMPAT_DATA_NAME]: path }));
  }

  if (options === undefined) {
    return error ? <div role="status">{errorMessage(error, t)}</div> : <Spinner style={{ height: 32 }} />;
  }
  const editable = LaunchOptions.parse(options).editable;
  const state = readCommon(options);
  const disabled = busy || !editable;
  const toggle = (id: ToggleId) => {
    const item = TOGGLES.find(entry => entry.id === id)!;
    const current = LaunchOptions.parse(options).getEnvironment(item.name);
    return <ToggleField key={id} label={toggleLabel(t, id)} checked={state.toggles[id]} disabled={disabled}
      description={<span style={commandStyle}>{state.occupied[id] && current !== undefined ? command(item.name, current) : command(item.name, item.value)}</span>}
      onChange={checked => { void change(currentOptions => setToggle(currentOptions, id, checked)); }} />;
  };
  const languages = [...new Set([...LANGUAGES, ...(state.language ? [state.language] : [])])];
  const audioChoices = [
    { value: "", label: t.off },
    ...AUDIO_VALUES.map((value, index) => ({ value, label: [t.audioLow, t.audioMedium, t.audioHigh][index] })),
  ];
  // A value written elsewhere stays visible and selectable.
  if (state.audio && !(AUDIO_VALUES as readonly string[]).includes(state.audio)) audioChoices.push({ value: state.audio, label: `${state.audio} ms` });

  return <Focusable flow-children="column">
    {!editable && <div role="status" style={{ marginBottom: 8 }}>{t.unsafeOptions}</div>}
    {(message || error) && <div role="status" style={{ overflowWrap: "anywhere", marginBottom: 8 }}>{errorMessage(message || error, t)}</div>}
    <DropdownItem label={t.gameLanguage} disabled={disabled}
      description={<span style={commandStyle}>{state.language ? `LANG=${state.language} HOST_LC_ALL=${state.language}` : "LANG · HOST_LC_ALL"}</span>}
      rgOptions={[{ data: "", label: t.gameDefault }, ...languages.map(code => ({ data: code, label: LANGUAGE_LABELS[code] || code.replace(".UTF-8", "") }))]}
      selectedOption={state.language || ""}
      onChange={option => { void change(current => setLanguage(current, option.data || undefined)); }} />
    {toggle("desktop")}
    <Field label={t.fixAudio} childrenContainerWidth="max"
      description={<span style={commandStyle}>{state.audio ? `${AUDIO_NAME}=${state.audio}` : AUDIO_NAME}</span>}>
      <Focusable flow-children="row" style={{ display: "flex", gap: 4 }}>
        {audioChoices.map(choice => {
          const active = (state.audio || "") === choice.value;
          return <DialogButton key={choice.value || "off"} disabled={disabled} style={{
            width: "auto", minWidth: 48, padding: "4px 12px",
            ...(active ? { background: "#1a9fff", color: "#fff" } : {}),
          }} onClick={() => { if (!active) void change(current => setEnvironment(current, { [AUDIO_NAME]: choice.value || undefined })); }}>
            {choice.label}</DialogButton>;
        })}
      </Focusable>
    </Field>
    <div style={{ fontSize: 13, opacity: .6, margin: "16px 0 4px" }}>{t.troubleshooting}</div>
    {toggle("wined3d")}
    {toggle("fsync")}
    {toggle("overlay")}
    {toggle("sdl")}
    {toggle("log")}
    <Field label={t.compatData} childrenContainerWidth="max"
      description={<span style={commandStyle}>{state.compatData ? `${COMPAT_DATA_NAME}=${state.compatData}` : COMPAT_DATA_NAME}</span>}>
      <Focusable flow-children="row" style={{ display: "flex", gap: 8 }}>
        <DialogButton disabled={disabled} onClick={() => {
          // Existing saves stay in the old location and must be moved by hand.
          showModal(<ConfirmModal strTitle={t.compatData} strDescription={t.compatDataWarning}
            strOKButtonText={t.chooseFolder} strCancelButtonText={t.cancel} onOK={() => { void chooseCompatData(); }} />, window);
        }}>{t.chooseFolder}</DialogButton>
        {state.compatData !== undefined && <DialogButton disabled={disabled}
          onClick={() => { void change(current => setEnvironment(current, { [COMPAT_DATA_NAME]: undefined })); }}>{t.useDefault}</DialogButton>}
      </Focusable>
    </Field>
  </Focusable>;
}
