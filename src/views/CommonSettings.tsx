import { FileSelectionType, openFilePicker } from "@decky/api";
import { ConfirmModal, Dropdown, Focusable, showModal, Spinner, Toggle } from "@decky/ui";
import { ReactNode, useState } from "react";
import {
  AUDIO_NAME, AUDIO_VALUES, COMMON_NAMES, COMPAT_DATA_NAME, LANGUAGES, readCommon, setEnvironment, setLanguage, setToggle, TOGGLES, ToggleId,
} from "../domain/common";
import { LaunchOptions } from "../domain/options";
import { SIDECAR_NAMES } from "../domain/sidecar";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, mono, PageHeader, Preview, Row, SectionTitle, Status } from "./shell";

const toggleText = (t: Translations, id: ToggleId): { label: string; hint: string } => ({
  desktop: { label: t.desktopMode, hint: t.desktopHint },
  wined3d: { label: t.fixGraphics, hint: t.wined3dHint },
  fsync: { label: t.disableFsync, hint: t.fsyncHint },
  overlay: { label: t.disableOverlay, hint: t.overlayHint },
  sdl: { label: t.fixController, hint: t.sdlHint },
  log: { label: t.recordLog, hint: t.logHint },
})[id];
// Each language is shown in its own name, as Steam's own language menu does.
const LANGUAGE_LABELS: Record<string, string> = {
  "en_US.UTF-8": "English", "zh_CN.UTF-8": "简体中文", "zh_TW.UTF-8": "繁體中文", "ja_JP.UTF-8": "日本語",
  "ko_KR.UTF-8": "한국어", "de_DE.UTF-8": "Deutsch", "fr_FR.UTF-8": "Français", "es_ES.UTF-8": "Español",
  "it_IT.UTF-8": "Italiano", "pt_BR.UTF-8": "Português (Brasil)", "ru_RU.UTF-8": "Русский", "pl_PL.UTF-8": "Polski",
};
const command = (name: string, value: string) => `${name}=${value === "" ? '""' : value}`;
const Command = ({ children }: { children: ReactNode }) => <span style={{ ...mono, color: colors.accentText }}>{children}</span>;

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

  // Off: a plain-language hint. On: the exact words written. Taken by another
  // tool: that tool's value, and the switch stays off.
  const toggle = (id: ToggleId) => {
    const item = TOGGLES.find(entry => entry.id === id)!;
    const { label, hint } = toggleText(t, id);
    const occupied = state.occupied[id];
    const current = parsed.getEnvironment(item.name);
    const description = occupied ? <span style={{ color: colors.warning }}>{t.occupiedBy(current === undefined ? item.name : command(item.name, current))}</span>
      : state.toggles[id] ? <Command>{command(item.name, item.value)}</Command> : hint;
    return <Row key={id} title={label} description={description} disabled={occupied}>
      <Toggle value={state.toggles[id]} disabled={disabled || occupied}
        onChange={checked => { void change(currentOptions => setToggle(currentOptions, id, checked)); }} />
    </Row>;
  };
  const languages = [...new Set([...LANGUAGES, ...(state.language ? [state.language] : [])])];
  const audioChoices = [
    { data: "", label: t.off },
    ...AUDIO_VALUES.map((value, index) => ({ data: value, label: `${[t.audioLow, t.audioMedium, t.audioHigh][index]} · ${value} ms` })),
  ];
  // A value written elsewhere stays visible and selectable.
  if (state.audio && !(AUDIO_VALUES as readonly string[]).includes(state.audio)) audioChoices.push({ data: state.audio, label: `${state.audio} ms` });
  const dropdownStyle = { minWidth: 180 } as const;
  const common = new Set(COMMON_NAMES);
  const sidecarNames = new Set(SIDECAR_NAMES);

  return <Focusable flow-children="column">
    <PageHeader title={t.tabCommon} note={t.effectNextLaunch} />
    <Status message={!editable ? t.unsafeOptions : undefined} tone="warning" />
    <Status message={message || error ? errorMessage(message || error, t) : undefined} />

    <SectionTitle first>{t.basic}</SectionTitle>
    <Row title={t.gameLanguage} description={state.language ? <Command>{`LANG=${state.language} HOST_LC_ALL=${state.language}`}</Command> : t.languageHint}>
      <div style={dropdownStyle}><Dropdown disabled={disabled} selectedOption={state.language || ""}
        rgOptions={[{ data: "", label: t.gameDefault }, ...languages.map(code => ({ data: code, label: LANGUAGE_LABELS[code] || code.replace(".UTF-8", "") }))]}
        onChange={option => { void change(current => setLanguage(current, option.data || undefined)); }} /></div>
    </Row>
    {toggle("desktop")}
    <Row title={t.fixAudio} description={state.audio ? <Command>{`${AUDIO_NAME}=${state.audio}`}</Command> : t.audioHint}>
      <div style={dropdownStyle}><Dropdown disabled={disabled} selectedOption={state.audio || ""} rgOptions={audioChoices}
        onChange={option => { void change(current => setEnvironment(current, { [AUDIO_NAME]: option.data || undefined })); }} /></div>
    </Row>
    <Row title={t.compatData} description={state.compatData ? <Command>{`${COMPAT_DATA_NAME}=${state.compatData}`}</Command> : t.compatDefault}>
      <Button style={{ height: 38 }} disabled={disabled} onClick={() => {
        // Existing saves stay in the old location and must be moved by hand.
        showModal(<ConfirmModal strTitle={t.compatData} strDescription={t.compatDataWarning}
          strOKButtonText={t.chooseFolder} strCancelButtonText={t.cancel} onOK={() => { void chooseCompatData(); }} />, window);
      }}>{t.chooseFolder}</Button>
      <Button style={{ height: 38 }} disabled={disabled || state.compatData === undefined}
        onClick={() => { void change(current => setEnvironment(current, { [COMPAT_DATA_NAME]: undefined })); }}>{t.useDefault}</Button>
    </Row>
    <div style={{ borderTop: `1px solid ${colors.line}` }} />

    <SectionTitle>{t.troubleshooting}</SectionTitle>
    {toggle("wined3d")}
    {toggle("sdl")}
    {toggle("fsync")}
    {toggle("log")}
    {toggle("overlay")}
    <div style={{ borderTop: `1px solid ${colors.line}` }} />

    <Preview t={t} source={options} legend={t.legendCommon}
      ownerOf={(_, name) => name && common.has(name) ? "page" : name && sidecarNames.has(name) ? "modifier" : "other"} />
  </Focusable>;
}
