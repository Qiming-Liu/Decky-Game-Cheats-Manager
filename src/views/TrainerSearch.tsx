import { useTranslations, errorMessage, initLanguage, getSearchLanguage } from "../utils/i18n";
import { Focusable, Spinner, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { cancelDownload, DatabaseStatus, DownloadJob, downloadTrainer, getDatabaseStatus, searchTrainers, TrainerResult } from "../utils/backend";
import { useLibrary, invalidateLibrary } from "../hooks/useLibrary";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { activeVersion, installedVersion, originLabel } from "../domain/trainer";
import { Button, colors, jobStateLabel, Progress, Row, Status } from "./shell";
import { CheckIcon, InfoIcon } from "./icons";

/** The newest database file's date as YYYY-MM-DD, or "" when nothing was downloaded. */
function databaseDate(status?: DatabaseStatus) {
  const newest = Math.max(0, ...Object.values(status?.files || {}).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  if (!newest) return "";
  const date = new Date(newest * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function TrainerSearch({ appId, initialKeyword }: { appId: string; initialKeyword: string }) {
  const t = useTranslations();
  const { library, error } = useLibrary(appId, initialKeyword);
  const jobs = useDownloads();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [results, setResults] = useState<TrainerResult[]>([]);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [starting, setStarting] = useState(new Set<string>());
  const [database, setDatabase] = useState<DatabaseStatus>();
  const sequence = useRef(0);
  const initialized = useRef(false);
  async function search(query: string, cachedOnly = false) {
    if (!query.trim()) return;
    const request = ++sequence.current;
    setSearching(true); setMessage(""); setResults([]);
    try {
      const status = await getDatabaseStatus().catch(() => undefined);
      if (request === sequence.current) setDatabase(status);
      if (cachedOnly && !status?.ready) return;
      if (request !== sequence.current) return;
      await initLanguage();
      if (request !== sequence.current) return;
      const response = await searchTrainers(query, getSearchLanguage());
      if (request !== sequence.current) return;
      setSearched(true);
      if (!response.success) setMessage(response.error || "searchFailed");
      else { setResults(response.results); if (!response.results.length) setMessage("noResults"); }
    } catch { if (request === sequence.current) setMessage("searchFailed"); }
    finally { if (request === sequence.current) setSearching(false); }
  }
  useEffect(() => {
    const name = initialKeyword || library?.game_name;
    if (name && !initialized.current) {
      initialized.current = true;
      setKeyword(name);
      void search(name, true);
    }
  }, [initialKeyword, library?.game_name]);
  useEffect(() => () => { sequence.current++; }, []);
  const [cancelling, setCancelling] = useState(new Set<string>());
  async function cancel(job: DownloadJob) {
    const jobId = job.id;
    setCancelling(previous => new Set(previous).add(jobId));
    try { trackDownload(await cancelDownload({ appId: job.app_ids.includes(appId) ? appId : job.app_ids[0] || appId, jobId })); }
    catch (error) {
      setMessage(error instanceof Error ? error.message : "unknownError");
      setCancelling(previous => { const next = new Set(previous); next.delete(jobId); return next; });
    }
  }
  async function download(trainer: TrainerResult) {
    setStarting(previous => new Set(previous).add(trainer.id));
    try {
      const response = await downloadTrainer(trainer.id, appId, library?.directory || "", trainer.version);
      if (!response.success || !response.job) {
        if (response.error === "library_changed") invalidateLibrary();
        throw new Error(response.error || "Could not start download.");
      }
      trackDownload(response.job);
    } catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setStarting(previous => { const next = new Set(previous); next.delete(trainer.id); return next; }); }
  }
  return <Focusable flow-children="column">
    <Focusable flow-children="row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <TextField aria-label={t.gameName} placeholder={t.gameName} value={keyword}
          onChange={event => { initialized.current = true; setKeyword(event.target.value); }} />
      </div>
      <Button primary style={{ height: 44, padding: "0 22px", fontSize: 15, fontWeight: 500 }} disabled={searching || !keyword.trim()} onClick={() => { void search(keyword); }}>
        {searching ? t.searching : t.search}</Button>
    </Focusable>
    {searching && <Spinner style={{ height: 32 }} />}
    <Status message={message || error ? errorMessage(message || error, t) : undefined} tone={message === "noResults" ? "warning" : undefined} />
    {searched && results.length > 0 && <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: colors.muted, padding: "0 4px 16px" }}>
      <span>{t.foundCount(results.length)}{databaseDate(database) && ` · ${t.databaseDate(databaseDate(database))}`}</span><span>{t.autoSelectAfter}</span></div>}
    {results.map(trainer => {
      const installed = installedVersion(trainer, library?.trainers || []);
      const otherVersion = library?.trainers?.some(item => item.trainer_id === trainer.id);
      const job = activeVersion(trainer, jobs);
      const fraction = job && job.total > 0 ? job.downloaded / job.total : 0;
      const percent = job?.state === "extracting" ? 100
        : Number.isFinite(fraction) ? Math.max(0, Math.min(100, Math.floor(fraction * 100))) : 0;
      const description = job ? <span style={{ color: colors.accentText }}>{jobStateLabel(t, job, percent)}</span>
        : [trainer.version, originLabel(trainer.origin), otherVersion && !installed ? t.otherVersionInstalled : ""].filter(Boolean).join(" · ");
      const small = { height: 36, padding: "0 16px", fontSize: 13 } as const;
      return <Row key={trainer.id} tall title={trainer.trainer_name} description={description}
        footer={job ? <Progress percent={percent} label={trainer.trainer_name} /> : undefined}>
        {installed ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, fontSize: 13, color: colors.muted, padding: "0 14px" }}>
          <CheckIcon size={14} />{t.downloaded}</span>
          : job ? <Button ghost style={{ ...small, padding: "0 14px" }}
            disabled={cancelling.has(job.id) || !["queued", "downloading", "extracting"].includes(job.state)}
            onClick={() => { void cancel(job); }}>{cancelling.has(job.id) ? t.cancelling : t.cancel}</Button>
          : <Button style={small} disabled={starting.has(trainer.id) || !library?.success} onClick={() => { void download(trainer); }}>
            {starting.has(trainer.id) ? t.starting : otherVersion ? t.downloadVersion : t.download}</Button>}
      </Row>;
    })}
    {results.length > 0 && <div style={{ borderTop: `1px solid ${colors.line}` }} />}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, padding: "12px 14px", borderRadius: 4, background: colors.surface, fontSize: 13, color: "#a9b1b8" }}>
      <InfoIcon size={16} />{t.searchHint}</div>
  </Focusable>;
}
