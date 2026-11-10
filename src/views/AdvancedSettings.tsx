import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import { Dropdown, Focusable, Navigation, Toggle } from "@decky/ui";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { changeSettings, useSettings } from "../hooks/useSettings";
import { invalidateLibrary } from "../hooks/useLibrary";
import {
  clearLog, DatabaseState, exportLog, getLibrarySettings, getLog, getLogExportDirectory, LAUNCH_DELAYS, LogLine, logFrontend, refreshDatabase,
  setLibraryDirectory,
} from "../utils/backend";
import { errorKey, errorMessage, PLUGIN_NAME, useTranslations } from "../utils/i18n";
import { Translations } from "../utils/locales";
import { Button, colors, IconButton, mono, PageStyle, Row, SectionTitle, Status } from "./shell";
import { BackIcon, DownloadIcon, TrashIcon } from "./icons";

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

const levelColor = (level: string) => level === "ERROR" || level === "CRITICAL" ? colors.danger
  : level === "WARNING" ? colors.warning : undefined;

/** The full-page settings shared by every game, opened from the Quick Access panel. */
export default function AdvancedSettings() {
  const t = useTranslations();
  const settings = useSettings();
  const [directory, setDirectory] = useState("");
  const [database, setDatabase] = useState<DatabaseState>();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadStorage = () => getLibrarySettings().then(value => { setDirectory(value.directory); setDatabase(value.database); });
  const loadLog = () => getLog(LOG_LINES).then(setLines);
  useEffect(() => {
    void loadStorage().catch(error => { logFrontend("error", "Advanced settings: loading storage failed", error); setMessage("settingsFailed"); });
    void loadLog().catch(() => {});
    // The log and a running database update keep changing while the page is open.
    const timer = window.setInterval(() => { void loadLog().catch(() => {}); void loadStorage().catch(() => {}); }, 3000);
    return () => window.clearInterval(timer);
  }, []);
  // Keep the newest lines in view while the log grows, unless the user scrolled up.
  const logBox = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const box = logBox.current;
    if (box && atBottom.current) box.scrollTop = box.scrollHeight;
  }, [lines]);

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }
  async function exportFile() {
    let folder: string;
    try {
      const start = await getLogExportDirectory().catch(() => "/home");
      const picked = await openFilePicker(FileSelectionType.FOLDER, start, false, true);
      folder = picked.realpath || picked.path;
    } catch { return; }
    try {
      toaster.toast({ title: PLUGIN_NAME, body: t.exportedTo(await exportLog(folder)) });
    } catch (error) {
      toaster.toast({ title: PLUGIN_NAME, body: error instanceof Error && error.message ? error.message : t.unknownError, critical: true });
    }
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
    // Clear of Steam's status bar on top and button hints below; the rest of
    // the spacing shrinks with the screen so everything stays visible.
    position: "absolute", inset: 0, boxSizing: "border-box", overflow: "hidden",
    padding: "clamp(48px, 8.5vh, 68px) clamp(24px, 4vw, 48px) clamp(52px, 8vh, 64px)",
    background: "linear-gradient(180deg, #0e141b 0%, #151c24 100%)", color: "#dcdedf", display: "flex", flexDirection: "column", gap: "clamp(8px, 2.2vh, 18px)",
  }}>
    <PageStyle />
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <IconButton label={t.back} style={{ background: colors.button, color: colors.text }} onClick={() => Navigation.NavigateBack()}><BackIcon /></IconButton>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text }}>{t.advancedSettings}</h1>
    </Focusable>
    <Status message={message ? errorMessage(message, t) : undefined} />

    <Focusable flow-children="row" style={{ flex: "1 1 auto", minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "clamp(20px, 3vw, 32px)" }}>
      {/* Scrolls only when even the tight spacing does not fit. */}
      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
        <SectionTitle first>{t.tabModifiers}</SectionTitle>
        <Row dense title={t.allowMultiple} description={t.allowMultipleHint}>
          <Toggle value={Boolean(settings?.allow_multiple)} disabled={busy || !settings} onChange={value => change({ allow_multiple: value })} />
        </Row>
        <Row dense title={t.autoSelect} description={t.autoSelectHint}>
          <Toggle value={Boolean(settings?.auto_select)} disabled={busy || !settings} onChange={value => change({ auto_select: value })} />
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
              <IconButton label={t.exportLog} style={logButton} disabled={!lines.length}
                onClick={() => { void exportFile(); }}><DownloadIcon size={16} /></IconButton>
              <IconButton label={t.clear} style={logButton} disabled={!lines.length}
                onClick={() => { void run(async () => { await clearLog(); setLines([]); }); }}><TrashIcon size={16} /></IconButton>
            </div>
          </Focusable>
          <div ref={logBox} onScroll={() => {
            const box = logBox.current;
            if (box) atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
          }} style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", fontSize: 12, lineHeight: 1.7, ...mono, whiteSpace: "pre-wrap", color: "#a9b1b8" }}>
            {lines.length ? lines.map((line, index) => <div key={index}>
              <span style={{ color: colors.dim }}>{line.time}</span>{" "}
              <span style={{ color: levelColor(line.level) }}>
                {line.level === "WARNING" ? "WARN" : line.level} {line.message}</span>
            </div>) : <span style={{ color: colors.dim }}>{t.logEmpty}</span>}
          </div>
        </section>
      </Focusable>
    </Focusable>
  </div>;
}

const cardButton = { width: "100%", height: 36, fontSize: 13 } as const;
const statusLine = { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: colors.text } as const;
const logButton = { width: 32, minWidth: 32, height: 30, background: colors.button, color: colors.text } as const;
