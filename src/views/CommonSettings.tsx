import { FileSelectionType, openFilePicker } from "@decky/api";
import { ConfirmModal, Dropdown, Focusable, showModal, Spinner, Toggle } from "@decky/ui";
import { useState } from "react";
import {
  AUDIO_NAME, AUDIO_VALUES, COMPAT_DATA_NAME, knownLanguage, LANGUAGES, readCommon, setEnvironment, setLanguage, setToggle, TOGGLES, ToggleId,
} from "../domain/common";
import { LaunchOptions, renderWord } from "../domain/options";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, mono, PageHeader, Row, Status } from "./shell";

const SWITCHES: ToggleId[] = ["desktop", "wined3d", "sdl", "fsync", "log", "overlay"];

const toggleLabel = (t: Translations, id: ToggleId) => ({
  desktop: t.desktopMode, wined3d: t.fixGraphics, fsync: t.disableFsync, overlay: t.disableOverlay, sdl: t.fixController, log: t.recordLog,
})[id];
// Each language is shown in its own name, as Steam's own language menu does.
const LANGUAGE_LABELS: Record<string, string> = {
  "en_US.UTF-8": "English", "zh_CN.UTF-8": "简体中文", "zh_TW.UTF-8": "繁體中文", "ja_JP.UTF-8": "日本語",
  "ko_KR.UTF-8": "한국어", "de_DE.UTF-8": "Deutsch", "fr_FR.UTF-8": "Français", "es_ES.UTF-8": "Español",
  "it_IT.UTF-8": "Italiano", "pt_BR.UTF-8": "Português (Brasil)", "ru_RU.UTF-8": "Русский", "pl_PL.UTF-8": "Polski",
};
const command = (name: string, value: string) => `${name}=${renderWord(value)}`;
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

  async function change(edit: (current: string) => string, action: string) {
    setBusy(true); setMessage("");
    try { await update(edit, action); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }
  async function chooseCompatData() {
    let path: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FOLDER, "/home", false, true);
      path = picked.realpath || picked.path;
    } catch { return; }
    await change(current => setEnvironment(current, { [COMPAT_DATA_NAME]: path }), `Set ${COMPAT_DATA_NAME} to a chosen folder`);
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
  const toggle = (id: ToggleId) => {
    const item = TOGGLES.find(entry => entry.id === id)!;
    const occupied = state.occupied[id];
    const current = parsed.getEnvironment(item.name);
    const description = occupied ? <Command tone="taken">{current === undefined ? item.name : command(item.name, current)}</Command>
      : <Command tone={state.toggles[id] ? "on" : "off"}>{command(item.name, item.value)}</Command>;
    return <Row key={id} title={toggleLabel(t, id)} description={description} dense lineBelow>
      <Toggle value={state.toggles[id]} disabled={disabled || occupied}
        onChange={checked => { void change(currentOptions => setToggle(currentOptions, id, checked), `Turn ${item.name} ${checked ? "on" : "off"}`); }} />
    </Row>;
  };
  // A value spelled differently (zh_CN.utf8) selects the listed language it means.
  const selectedLanguage = knownLanguage(state.language) ?? state.language;
  const languages = [...new Set([...LANGUAGES, ...(selectedLanguage ? [selectedLanguage] : [])])];
  const languageWords = [["LANG", state.language], ["HOST_LC_ALL", state.hostLanguage]] as const;
  const languageSet = languageWords.some(([, value]) => value !== undefined);
  const audioChoices = [{ data: "", label: t.audioOff }, ...AUDIO_VALUES.map(value => ({ data: value, label: `${value} ms` }))];
  // A value written elsewhere stays visible and selectable.
  if (state.audio && !(AUDIO_VALUES as readonly string[]).includes(state.audio)) audioChoices.push({ data: state.audio, label: `${state.audio} ms` });
  const dropdownStyle = { minWidth: 170 } as const;
  const small = { height: 38 } as const;

  return <Focusable flow-children="column">
    <PageHeader title={t.tabCommon} gap={14} />
    <Status message={!editable ? t.unsafeOptions : undefined} tone="warning" />
    <Status message={message || error ? errorMessage(message || error, t) : undefined} />

    <Row dense lineBelow title={t.gameLanguage} description={<Command tone={languageSet ? "on" : "off"}>
      {languageSet ? languageWords.filter(([, value]) => value !== undefined).map(([name, value]) => command(name, value!)).join(" ")
        : "LANG HOST_LC_ALL"}</Command>}>
      <div style={dropdownStyle}><Dropdown disabled={disabled} selectedOption={selectedLanguage || ""}
        rgOptions={[{ data: "", label: t.gameDefault }, ...languages.map(code => ({ data: code, label: LANGUAGE_LABELS[code] || code.replace(".UTF-8", "") }))]}
        onChange={option => { void change(current => setLanguage(current, option.data || undefined), `Set the game language to ${option.data || "the game default"}`); }} /></div>
    </Row>
    <Row dense lineBelow title={t.fixAudio} description={<Command tone={state.audio ? "on" : "off"}>{state.audio ? `${AUDIO_NAME}=${state.audio}` : AUDIO_NAME}</Command>}>
      <div style={dropdownStyle}><Dropdown disabled={disabled} selectedOption={state.audio || ""} rgOptions={audioChoices}
        onChange={option => { void change(current => setEnvironment(current, { [AUDIO_NAME]: option.data || undefined }), option.data ? `Set ${AUDIO_NAME} to ${option.data}` : `Remove ${AUDIO_NAME}`); }} /></div>
    </Row>
    <Row dense lineBelow title={t.compatData} description={<Command tone={state.compatData ? "on" : "off"}>
      {state.compatData ? `${COMPAT_DATA_NAME}=${state.compatData}` : COMPAT_DATA_NAME}</Command>}>
      <Button style={small} disabled={disabled} onClick={() => {
        // Existing saves stay in the old location and must be moved by hand.
        showModal(<ConfirmModal strTitle={t.compatData} strDescription={t.compatDataWarning}
          strOKButtonText={t.chooseFolder} strCancelButtonText={t.cancel} onOK={() => { void chooseCompatData(); }} />, window);
      }}>{t.chooseFolder}</Button>
      <Button style={small} disabled={disabled || state.compatData === undefined}
        onClick={() => { void change(current => setEnvironment(current, { [COMPAT_DATA_NAME]: undefined }), `Reset ${COMPAT_DATA_NAME} to the default`); }}>{t.useDefault}</Button>
    </Row>
    <Focusable style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 24 }}>
      {SWITCHES.map(toggle)}
    </Focusable>
  </Focusable>;
}
