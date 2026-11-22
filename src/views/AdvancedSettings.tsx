import { FileSelectionType, openFilePicker } from "@decky/api";
import { Dropdown, Focusable, Toggle } from "@decky/ui";
import { ReactNode, useEffect, useState } from "react";
import { changeSettings, useSettings } from "../hooks/useSettings";
import { changeCheatEngine, downloadCheatEngine, useCheatEngine } from "../hooks/useCheatEngine";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { invalidateLibrary } from "../hooks/useLibrary";
import {
  DatabaseState, getLibrarySettings, LAUNCH_DELAYS, logFrontend, refreshDatabase, setLibraryDirectory,
} from "../utils/backend";
import { errorKey, errorMessage, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, IconButton, jobStateLabel, mono, PageHeader, Row, SectionTitle, StandalonePage, Status } from "./shell";
import { TrashIcon } from "./icons";

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
    boxSizing: "border-box", padding: "clamp(8px, 1.5vh, 12px) 14px", borderRadius: 4, background: "rgba(0,0,0,.28)",
    display: "flex", flexDirection: "column", gap: "clamp(4px, 1vh, 8px)", minWidth: 0,
  }}>
    <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
    {children}
    <div style={{ fontSize: 11, color: colors.dim }}>{hint}</div>
    {action}
  </Focusable>;
}

const dot = (color: string) => <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: color }} />;

/** Global settings opened from the Quick Access panel or a game's plugin page. */
export default function AdvancedSettings({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations();
  const settings = useSettings();
  const engine = useCheatEngine();
  // Cheat Engine downloads belong to no game: they are the jobs without one.
  const engineJob = useDownloads().find(job => !job.app_ids.length && ["queued", "downloading", "extracting"].includes(job.state));
  const [directory, setDirectory] = useState("");
  const [database, setDatabase] = useState<DatabaseState>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadStorage = () => getLibrarySettings().then(value => { setDirectory(value.directory); setDatabase(value.database); });
  useEffect(() => {
    void loadStorage().catch(error => { logFrontend("error", "Advanced settings: loading storage failed", error); setMessage("settingsFailed"); });
    // A running database update keeps changing while the page is open.
    const timer = window.setInterval(() => { void loadStorage().catch(() => {}); }, 3000);
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
  const downloadEngine = (reinstall = false) => run(async () => {
    const job = await downloadCheatEngine(reinstall);
    if (job) trackDownload(job);
  });
  const percent = engineJob ? engineJob.state === "extracting" ? 100 : engineJob.total ? Math.floor(engineJob.downloaded / engineJob.total * 100) : 0 : 0;
  const engineDescription = engineJob ? <span style={{ color: colors.accentText }}>{jobStateLabel(t, engineJob, percent)}</span>
    : !engine ? t.loading
    : engine.installed ? <span style={mono}>{engine.folder}</span>
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

  const content = <>
    <Status message={message ? errorMessage(message, t) : undefined} />

    <Focusable flow-children="row" style={{ flex: "1 1 auto", minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "clamp(20px, 3vw, 32px)" }}>
      {/* Scrolls only when even the tight spacing does not fit. */}
      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
        <SectionTitle first>{t.tabModifiers}</SectionTitle>
        <Row dense title={t.allowMultiple} description={t.allowMultipleHint}>
          <Toggle value={Boolean(settings?.allow_multiple)} disabled={busy || !settings} onChange={value => change({ allow_multiple: value })} />
        </Row>
        <Row dense title={t.launchDelay} description={t.launchDelayHint}>
          <div style={{ minWidth: 140 }}><Dropdown disabled={busy || !settings} selectedOption={settings?.launch_delay ?? 0}
            rgOptions={LAUNCH_DELAYS.map(value => ({ data: value, label: t.seconds(value) }))}
            onChange={option => change({ launch_delay: option.data })} /></div>
        </Row>
        <Row dense title={t.skipLauncherCheck} description={t.skipLauncherCheckHint}>
          <Toggle value={Boolean(settings?.skip_launcher_check)} disabled={busy || !settings} onChange={value => change({ skip_launcher_check: value })} />
        </Row>
        <div style={{ borderTop: `1px solid ${colors.line}` }} />

        <SectionTitle>{t.ceTitle}</SectionTitle>
        <Row dense highlight={Boolean(engine?.installed)} description={engineDescription}
          title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {dot(engine?.installed ? "#59bf40" : colors.dim)}{engine?.installed ? t.ceInstalled(engine.version) : t.ceNotInstalled}</span>}>
          {engine?.installed
            ? <>
              <Button style={smallButton} disabled={busy || Boolean(engineJob)} onClick={() => { void downloadEngine(true); }}>{t.ceReinstall}</Button>
              <IconButton tone="danger" label={t.delete} disabled={busy} onClick={() => { void run(() => changeCheatEngine("delete")); }}><TrashIcon /></IconButton>
            </>
            : <Button style={smallButton} disabled={busy || Boolean(engineJob)} onClick={() => { void downloadEngine(); }}>{t.download}</Button>}
        </Row>
        <Row dense title={t.autoAttach} description={t.autoAttachHint}>
          <Toggle value={Boolean(settings?.auto_attach)} disabled={busy || !settings} onChange={value => change({ auto_attach: value })} />
        </Row>
        <div style={{ borderTop: `1px solid ${colors.line}` }} />
      </Focusable>

      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
        <SectionTitle first>{t.storage}</SectionTitle>
        <Focusable flow-children={embedded ? "column" : "row"} style={{ display: "grid", gridTemplateColumns: embedded ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
          <Card label={t.folder} hint={t.pathMoveHint}
            action={<Button style={cardButton} disabled={busy || !directory} onClick={() => { void chooseFolder(); }}>{t.changePath}</Button>}>
            <div style={{ ...mono, fontSize: 13, color: colors.text, lineHeight: 1.45 }}>{directory || t.loading}</div>
          </Card>
          {databaseCard}
        </Focusable>
      </Focusable>
    </Focusable>
  </>;
  return embedded ? <div style={{ padding: "0 8px 16px 0" }}>
    <PageHeader title={t.advancedSettings} />
    {content}
  </div> : <StandalonePage title={t.advancedSettings}>{content}</StandalonePage>;
}

const cardButton = { width: "100%", height: 36, fontSize: 13 } as const;
const smallButton = { height: 36, padding: "0 14px", fontSize: 13 } as const;
const statusLine = { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: colors.text } as const;
