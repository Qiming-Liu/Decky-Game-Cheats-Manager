import { FileSelectionType, openFilePicker } from "@decky/api";
import { ConfirmModal, Dropdown, Focusable, showModal, Spinner, Toggle } from "@decky/ui";
import { useState } from "react";
import {
  AUDIO_NAME, AUDIO_VALUES, COMPAT_DATA_NAME, LANGUAGES, readCommon, setEnvironment, setLanguage, setToggle, TOGGLES, ToggleId,
} from "../domain/common";
import { LaunchOptions } from "../domain/options";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, mono, PageHeader, Row, SectionTitle, Status } from "./shell";

const TROUBLESHOOTING: ToggleId[] = ["wined3d", "sdl", "fsync", "log", "overlay"];

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
type Tone = "on" | "off" | "taken";
const toneColor: Record<Tone, string> = { on: colors.accentText, off: colors.muted, taken: colors.warning };
/** The words a setting writes: blue when on, grey when off, orange when another tool set them. */
const Command = ({ tone, children }: { tone: Tone; children: string }) =>
  <span style={{ ...mono, overflowWrap: "normal", color: toneColor[tone] }}>{children}</span>;

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
    return error ? <Status message={errorMessage(error, t)} /> : <Spinner style={{ height: 32 }} />;
  }
  const parsed = LaunchOptions.parse(options);
  const editable = parsed.editable;
  const state = readCommon(options);
  const disabled = busy || !editable;

  // On: the words written. Off: the words a switch would write. Taken by
  // another tool: that tool's value, and the switch is locked.
  const toggle = (id: ToggleId, lineBelow = false) => {
    const item = TOGGLES.find(entry => entry.id === id)!;
    const occupied = state.occupied[id];
    const current = parsed.getEnvironment(item.name);
    const description = occupied ? <Command tone="taken">{current === undefined ? item.name : command(item.name, current)}</Command>
      : <Command tone={state.toggles[id] ? "on" : "off"}>{command(item.name, item.value)}</Command>;
    return <Row key={id} title={toggleLabel(t, id)} description={description} lineBelow={lineBelow}>
      <Toggle value={state.toggles[id]} disabled={disabled || occupied}
        onChange={checked => { void change(currentOptions => setToggle(currentOptions, id, checked)); }} />
    </Row>;
  };
  const languages = [...new Set([...LANGUAGES, ...(state.language ? [state.language] : [])])];
  const audioChoices = [{ data: "", label: t.audioOff }, ...AUDIO_VALUES.map(value => ({ data: value, label: `${value} ms` }))];
  // A value written elsewhere stays visible and selectable.
  if (state.audio && !(AUDIO_VALUES as readonly string[]).includes(state.audio)) audioChoices.push({ data: state.audio, label: `${state.audio} ms` });
  const dropdownStyle = { minWidth: 170 } as const;
  const small = { height: 38 } as const;

  return <Focusable flow-children="column">
    <PageHeader title={t.tabCommon} note={t.effectNextLaunch} noteEnd gap={14} />
    <Status message={!editable ? t.unsafeOptions : undefined} tone="warning" />
    <Status message={message || error ? errorMessage(message || error, t) : undefined} />

    <SectionTitle first>{t.basic}</SectionTitle>
    <Row title={t.gameLanguage} description={<Command tone={state.language ? "on" : "off"}>
      {state.language ? `LANG=${state.language} HOST_LC_ALL=${state.language}` : "LANG HOST_LC_ALL"}</Command>}>
      <div style={dropdownStyle}><Dropdown disabled={disabled} selectedOption={state.language || ""}
        rgOptions={[{ data: "", label: t.gameDefault }, ...languages.map(code => ({ data: code, label: LANGUAGE_LABELS[code] || code.replace(".UTF-8", "") }))]}
        onChange={option => { void change(current => setLanguage(current, option.data || undefined)); }} /></div>
    </Row>
    {toggle("desktop")}
    <Row title={t.fixAudio} description={<Command tone={state.audio ? "on" : "off"}>{state.audio ? `${AUDIO_NAME}=${state.audio}` : AUDIO_NAME}</Command>}>
      <div style={dropdownStyle}><Dropdown disabled={disabled} selectedOption={state.audio || ""} rgOptions={audioChoices}
        onChange={option => { void change(current => setEnvironment(current, { [AUDIO_NAME]: option.data || undefined })); }} /></div>
    </Row>
    <Row title={t.compatData} description={<Command tone={state.compatData ? "on" : "off"}>
      {state.compatData ? `${COMPAT_DATA_NAME}=${state.compatData}` : COMPAT_DATA_NAME}</Command>}>
      <Button style={small} disabled={disabled} onClick={() => {
        // Existing saves stay in the old location and must be moved by hand.
        showModal(<ConfirmModal strTitle={t.compatData} strDescription={t.compatDataWarning}
          strOKButtonText={t.chooseFolder} strCancelButtonText={t.cancel} onOK={() => { void chooseCompatData(); }} />, window);
      }}>{t.chooseFolder}</Button>
      <Button style={small} disabled={disabled || state.compatData === undefined}
        onClick={() => { void change(current => setEnvironment(current, { [COMPAT_DATA_NAME]: undefined })); }}>{t.useDefault}</Button>
    </Row>
    <div style={{ borderTop: `1px solid ${colors.line}` }} />

    <SectionTitle>{t.troubleshooting}</SectionTitle>
    <Focusable style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 24, borderTop: `1px solid ${colors.line}` }}>
      {TROUBLESHOOTING.map(id => toggle(id, true))}
    </Focusable>
  </Focusable>;
}
