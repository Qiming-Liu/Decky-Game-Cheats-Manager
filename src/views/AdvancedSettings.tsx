import { FileSelectionType, openFilePicker } from "@decky/api";
import { Dropdown, Focusable, Navigation, Toggle } from "@decky/ui";
import { ReactNode, useEffect, useState } from "react";
import { changeSettings, useSettings } from "../hooks/useSettings";
import { changeCheatEngine, useCheatEngine } from "../hooks/useCheatEngine";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { invalidateLibrary } from "../hooks/useLibrary";
import {
  clearLog, DatabaseState, getLibrarySettings, getLog, LAUNCH_DELAYS, LogLine, manageCheatEngine, refreshDatabase, setLibraryDirectory,
} from "../utils/backend";
import { errorKey, errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, IconButton, jobStateLabel, mono, PageStyle, Row, SectionTitle, Status } from "./shell";
import { BackIcon, CopyIcon, TrashIcon } from "./icons";

const LOG_LINES = 200;
const pad = (value: number) => String(value).padStart(2, "0");
const formatTime = (seconds: number) => {
  const date = new Date(seconds * 1000);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** One short word for why a database update failed. */
function failureReason(t: Translations, error: string) {
  const key = errorKey(error);
  if (key === "connectionFailed") return t.failConnection;
  if (key === "authenticationFailed" || key === "dataSourceMissing" || key === "dataSourceInvalid") return t.failAuth;
  if (key === "rateLimited") return t.failRate;
  if (key === "invalidDatabase") return t.failCorrupt;
  return t.failServer;
}

/** A small card of the storage section: label, value, hint and one button. */
function Card({ label, children, hint, action }: { label: string; children: ReactNode; hint: ReactNode; action: ReactNode }) {
  return <Focusable flow-children="column" aria-label={label} style={{
    boxSizing: "border-box", padding: "12px 14px", borderRadius: 4, background: "rgba(0,0,0,.28)",
    display: "flex", flexDirection: "column", gap: 8, minWidth: 0,
  }}>
    <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
    {children}
    <div style={{ fontSize: 11, color: colors.dim }}>{hint}</div>
    {action}
  </Focusable>;
}

const dot = (color: string) => <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: color }} />;

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* Steam may not allow it; fall back below. */ }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

/** The full-page settings shared by every game, opened from the Quick Access panel. */
export default function AdvancedSettings() {
  const t = useTranslations();
  const settings = useSettings();
  const engine = useCheatEngine();
  // Cheat Engine downloads belong to no game: they are the jobs without one.
  const engineJob = useDownloads().find(job => !job.app_ids.length && ["queued", "downloading", "extracting"].includes(job.state));
  const [directory, setDirectory] = useState("");
  const [database, setDatabase] = useState<DatabaseState>();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadStorage = () => getLibrarySettings().then(value => { setDirectory(value.directory); setDatabase(value.database); });
  const loadLog = () => getLog().then(value => setLines(value.lines.slice(-LOG_LINES)));
  useEffect(() => {
    void loadStorage().catch(() => setMessage("settingsFailed"));
    void loadLog().catch(() => {});
    // The log and a running database update keep changing while the page is open.
    const timer = window.setInterval(() => { void loadLog().catch(() => {}); void loadStorage().catch(() => {}); }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }
  async function chooseFolder() {
    let path: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FOLDER, directory || "~", false, true);
      path = picked.realpath || picked.path;
    } catch { return; }
    await run(async () => {
      const result = await setLibraryDirectory(path);
      if (!result.success) throw new Error(result.error);
      setDirectory(result.directory || path);
      invalidateLibrary();
    });
  }
  function updateDatabase() {
    setDatabase(previous => previous && { ...previous, updating: true, progress: { done: 0, total: 0 }, error: "" });
    void run(async () => { await refreshDatabase(); await loadStorage(); });
  }
  const change = (changes: Parameters<typeof changeSettings>[0]) => { void run(() => changeSettings(changes)); };
  const downloadEngine = () => run(async () => {
    const result = await manageCheatEngine("download");
    if (result.job) trackDownload(result.job);
  });
  async function linkEngine() {
    let folder: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FOLDER, "/home", false, true);
      folder = picked.realpath || picked.path;
    } catch { return; }
    await run(() => changeCheatEngine("link", folder));
  }
  const percent = engineJob ? engineJob.state === "extracting" ? 100 : engineJob.total ? Math.floor(engineJob.downloaded / engineJob.total * 100) : 0 : 0;
  const engineDescription = engineJob ? <span style={{ color: colors.accentText }}>{jobStateLabel(t, engineJob, percent)}</span>
    : !engine ? t.loading
    : engine.installed ? <span style={mono}>{engine.linked ? `${t.ceLinked} · ` : ""}{engine.folder}</span>
    : t.ceSharedHint;

  const updatedAt = Math.max(0, ...Object.values(database?.files || {}).filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)));
  const progress = database?.progress;
  const databaseCard = !database ? <Card label={t.catalog} hint="" action={null}>{t.loading}</Card>
    : database.updating ? <Card label={t.catalog} hint={progress?.total ? t.catalogProgress(Math.min(progress.done + 1, progress.total), progress.total) : ""}
      action={<Button style={cardButton} disabled>{t.catalogUpdatingButton}</Button>}>
      <div style={statusLine}>{dot(colors.accent)}{t.catalogUpdating}</div></Card>
    : database.error ? <Card label={t.catalog} hint={<span style={{ color: "#ff9b9b" }}>
        {failureReason(t, database.error)}{database.ready && ` · ${t.oldCatalogInUse}`}</span>}
      action={<Button style={cardButton} disabled={busy} onClick={updateDatabase}>{t.retry}</Button>}>
      <div style={statusLine}>{dot(colors.danger)}{t.catalogFailed}</div></Card>
    : <Card label={t.catalog} hint={database.ready && updatedAt ? t.updatedAt(formatTime(updatedAt)) : ""}
      action={<Button style={cardButton} disabled={busy} onClick={updateDatabase}>{t.updateNow}</Button>}>
      <div style={statusLine}>{dot(database.ready ? "#59bf40" : colors.warning)}{database.ready ? t.catalogReady : t.catalogMissing}</div></Card>;

  return <div className="gcm-font" style={{
    position: "absolute", inset: 0, boxSizing: "border-box", padding: "68px 48px 64px", overflow: "hidden",
    background: "linear-gradient(180deg, #0e141b 0%, #151c24 100%)", color: "#dcdedf", display: "flex", flexDirection: "column", gap: 18,
  }}>
    <PageStyle />
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <IconButton label={t.back} style={{ background: colors.button, color: colors.text }} onClick={() => Navigation.NavigateBack()}><BackIcon /></IconButton>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text }}>{t.advancedSettings}</h1>
      <span style={{ fontSize: 12, color: colors.muted }}>{t.allGames}</span>
    </Focusable>
    <Status message={message ? errorMessage(message, t) : undefined} />

    <Focusable flow-children="row" style={{ flex: "1 1 auto", minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 32 }}>
      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <SectionTitle first>{t.tabModifiers}</SectionTitle>
        <Row title={t.allowMultiple} description={t.allowMultipleHint}>
          <Toggle value={Boolean(settings?.allow_multiple)} disabled={busy || !settings} onChange={value => change({ allow_multiple: value })} />
        </Row>
        <Row title={t.autoSelect} description={t.autoSelectHint}>
          <Toggle value={Boolean(settings?.auto_select)} disabled={busy || !settings} onChange={value => change({ auto_select: value })} />
        </Row>
        <Row title={t.launchDelay} description={t.launchDelayHint}>
          <div style={{ minWidth: 140 }}><Dropdown disabled={busy || !settings} selectedOption={settings?.launch_delay ?? 0}
            rgOptions={LAUNCH_DELAYS.map(value => ({ data: value, label: t.seconds(value) }))}
            onChange={option => change({ launch_delay: option.data })} /></div>
        </Row>
        <div style={{ borderTop: `1px solid ${colors.line}` }} />

        <SectionTitle>{t.ceTitle}</SectionTitle>
        <Row highlight={Boolean(engine?.installed)} description={engineDescription}
          title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {dot(engine?.installed ? "#59bf40" : colors.dim)}{engine?.installed ? t.ceInstalled(engine.version) : t.ceNotInstalled}</span>}>
          {engine?.installed
            ? <>
              <Button style={smallButton} disabled={busy || Boolean(engineJob)} onClick={() => { void downloadEngine(); }}>{t.ceReinstall}</Button>
              <IconButton tone="danger" label={t.delete} disabled={busy} onClick={() => { void run(() => changeCheatEngine("delete")); }}><TrashIcon /></IconButton>
            </>
            : <>
              <Button style={smallButton} disabled={busy} onClick={() => { void linkEngine(); }}>{t.ceHaveIt}</Button>
              <Button style={smallButton} disabled={busy || Boolean(engineJob)} onClick={() => { void downloadEngine(); }}>{t.download}</Button>
            </>}
        </Row>
        <Row title={t.ceLanguage} description={t.ceLanguageHint}>
          <Toggle value={Boolean(engine?.zh_cn)} disabled={busy || !engine?.installed}
            onChange={value => { void run(() => changeCheatEngine("language", value ? "zh_CN" : "")); }} />
        </Row>
        <div style={{ borderTop: `1px solid ${colors.line}` }} />
        <div style={{ fontSize: 11, color: colors.dim, padding: "6px 4px 0" }}>{t.ceUnderProton}</div>

        <SectionTitle>{t.storage}</SectionTitle>
        <Focusable flow-children="row" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
          <Card label={t.folder} hint={t.pathMoveHint}
            action={<Button style={cardButton} disabled={busy || !directory} onClick={() => { void chooseFolder(); }}>{t.changePath}</Button>}>
            <div style={{ ...mono, fontSize: 13, color: colors.text, lineHeight: 1.45 }}>{directory || t.loading}</div>
          </Card>
          {databaseCard}
        </Focusable>
      </Focusable>

      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: 10 }}>
        <SectionTitle first>{t.log}</SectionTitle>
        <section aria-label={t.log} style={{
          flex: "1 1 auto", minHeight: 0, boxSizing: "border-box", padding: "12px 14px", borderRadius: 4, background: "rgba(0,0,0,.4)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: colors.muted }}>
            <span>{t.recentLines(LOG_LINES)}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <IconButton label={t.copy} style={logButton} disabled={!lines.length}
                onClick={() => { void copyText(lines.map(line => `${line.time} ${line.level} ${line.message}`).join("\n")); }}><CopyIcon size={16} /></IconButton>
              <IconButton label={t.clear} style={logButton} disabled={!lines.length}
                onClick={() => { void run(async () => { await clearLog(); setLines([]); }); }}><TrashIcon size={16} /></IconButton>
            </div>
          </Focusable>
          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", fontSize: 12, lineHeight: 1.7, ...mono, color: "#a9b1b8" }}>
            {lines.length ? lines.map((line, index) => <div key={index}>
              <span style={{ color: colors.dim }}>{line.time}</span>{" "}
              <span style={{ color: line.level === "ERROR" ? "#ff9b9b" : line.level === "WARNING" ? colors.warning : undefined }}>
                {line.level === "WARNING" ? "WARN" : line.level} {line.message}</span>
            </div>) : <span style={{ color: colors.dim }}>{t.logEmpty}</span>}
          </div>
        </section>
      </Focusable>
    </Focusable>
  </div>;
}

const cardButton = { width: "100%", height: 36, fontSize: 13 } as const;
const smallButton = { height: 36, padding: "0 14px", fontSize: 13 } as const;
const statusLine = { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: colors.text } as const;
const logButton = { width: 32, minWidth: 32, height: 30, background: colors.button, color: colors.text } as const;
