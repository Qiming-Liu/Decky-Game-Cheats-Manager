import { useTranslations, errorMessage } from "../utils/i18n";
import { FileSelectionType, openFilePicker } from "@decky/api";
import { Focusable, PanelSection, PanelSectionRow, useQuickAccessVisible } from "@decky/ui";
import { ReactNode, useEffect, useState } from "react";
import { cleanupTrash, getLibrarySettings, refreshDatabase, setLibraryDirectory, DatabaseStatus } from "../utils/backend";
import { invalidateLibrary } from "../hooks/useLibrary";
import { useDownloads } from "../hooks/useDownloads";
import { Button, colors, jobStateLabel, mono } from "./shell";

/** One card of the Quick Access panel: title, current value, hint, one action. */
function Card({ title, children, hint, action }: { title: ReactNode; children: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return <PanelSectionRow>
    <Focusable flow-children="column" style={{
      boxSizing: "border-box", padding: "12px 14px", borderRadius: 4, background: "rgba(0,0,0,.28)", marginBottom: 14,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {typeof title === "string" ? <div style={{ fontSize: 12, color: colors.muted }}>{title}</div> : title}
      <div style={{ fontSize: 13, color: colors.text }}>{children}</div>
      {hint && <div style={{ fontSize: 11, color: colors.dim }}>{hint}</div>}
      {action}
    </Focusable>
  </PanelSectionRow>;
}

const cardButton = { width: "100%", height: 36, fontSize: 13 } as const;
const pad = (value: number) => String(value).padStart(2, "0");
const formatTime = (seconds: number) => {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function Settings() {
  const t = useTranslations();
  const visible = useQuickAccessVisible();
  useEffect(() => {
    if (visible) void cleanupTrash().catch(() => {});
  }, [visible]);
  const [directory, setDirectory] = useState("");
  const [database, setDatabase] = useState<DatabaseStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useDownloads().filter(job => ["queued", "downloading", "extracting"].includes(job.state));
  useEffect(() => {
    let active = true;
    getLibrarySettings().then(value => {
      if (active) { setDirectory(value.directory); setDatabase(value.database); }
    }).catch(() => { if (active) setMessage("settingsFailed"); });
    return () => { active = false; };
  }, []);
  const choose = async () => {
    setBusy(true);
    let path: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FOLDER, directory || "~", false, true);
      path = picked.realpath || picked.path;
    } catch { setBusy(false); return; }
    try {
      const result = await setLibraryDirectory(path);
      if (!result.success) throw new Error(result.error);
      setDirectory(result.directory || path);
      invalidateLibrary();
      setMessage("folderSaved");
    } catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  };
  const update = async () => {
    setBusy(true); setMessage("updatingDatabase");
    try {
      const result = await refreshDatabase();
      setDatabase((await getLibrarySettings()).database);
      setMessage(result.success ? "databaseUpdated" : Object.values(result.errors)[0] || "databaseUpdateFailed");
    } catch { setMessage("databaseUpdateFailed"); }
    finally { setBusy(false); }
  };
  const updatedAt = Math.max(0, ...Object.values(database?.files || {}).filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)));
  const dot = (color: string) => <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: color, marginRight: 8, verticalAlign: 1 }} />;
  return <PanelSection>
    <Card title={t.folder} hint={t.pathMoveHint}
      action={<Button style={cardButton} disabled={busy || !directory} onClick={() => { void choose(); }}>{t.changePath}</Button>}>
      <span style={{ ...mono, fontSize: 13, lineHeight: 1.45 }}>{directory || t.loading}</span>
    </Card>
    <Card title={t.catalog}
      hint={`${t.lastUpdated} ${updatedAt ? formatTime(updatedAt) : t.neverUpdated}`}
      action={<Button style={cardButton} disabled={busy || !database} onClick={() => { void update(); }}>{t.updateNow}</Button>}>
      <span style={{ fontSize: 14 }}>{database === undefined ? t.loading : database.ready ? <>{dot("#59bf40")}{t.catalogReady}</> : <>{dot(colors.warning)}{t.catalogMissing}</>}</span>
    </Card>
    {active.length > 0 && <Card title={<div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: colors.muted }}>
      <span>{t.downloadActivity}</span><span>{t.activeDownloads(active.length)}</span></div>}>
      {active.map(job => {
        const percent = job.state === "extracting" ? 100 : job.total ? Math.floor(job.downloaded / job.total * 100) : 0;
        return <div key={job.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.trainer_name}</span>
            <span style={{ color: colors.accentText, flex: "0 0 auto" }}>{job.state === "downloading" ? `${percent}%` : jobStateLabel(t, job, percent)}</span></div>
          <div role="progressbar" aria-label={job.trainer_name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
            style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
            <div style={{ width: `${percent}%`, height: "100%", background: colors.accent }} /></div>
        </div>;
      })}
    </Card>}
    {message && <PanelSectionRow><div role="status" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{errorMessage(message, t)}</div></PanelSectionRow>}
    <PanelSectionRow><div style={{ fontSize: 11, color: colors.dim, lineHeight: 1.5 }}>{t.openHint}</div></PanelSectionRow>
  </PanelSection>;
}
