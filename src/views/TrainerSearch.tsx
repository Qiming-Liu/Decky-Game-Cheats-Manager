import { useTranslations, errorMessage, initLanguage, getSearchLanguage } from "../utils/i18n";
import { Focusable, Spinner, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaCheck, FaInfoCircle } from "react-icons/fa";
import { downloadTrainer, getDatabaseStatus, searchTrainers, TrainerResult } from "../utils/backend";
import { useLibrary, invalidateLibrary } from "../hooks/useLibrary";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { activeVersion, installedVersion } from "../domain/trainer";
import { Button, colors, jobStateLabel, Progress, Row, Status } from "./shell";

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
  const sequence = useRef(0);
  const initialized = useRef(false);
  async function search(query: string, cachedOnly = false) {
    if (!query.trim()) return;
    const request = ++sequence.current;
    setSearching(true); setMessage(""); setResults([]);
    try {
      if (cachedOnly && !(await getDatabaseStatus()).ready) return;
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
    <Focusable flow-children="row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <TextField aria-label={t.gameName} placeholder={t.gameName} value={keyword}
          onChange={event => { initialized.current = true; setKeyword(event.target.value); }} />
      </div>
      <Button primary style={{ height: 44 }} disabled={searching || !keyword.trim()} onClick={() => { void search(keyword); }}>
        {searching ? t.searching : t.search}</Button>
    </Focusable>
    {searching && <Spinner style={{ height: 32 }} />}
    <Status message={message || error ? errorMessage(message || error, t) : undefined} tone={message === "noResults" ? "warning" : undefined} />
    {searched && results.length > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: colors.muted, padding: "2px 4px 8px" }}>
      <span>{t.foundCount(results.length)}</span><span>{t.autoSelectAfter}</span></div>}
    {results.map(trainer => {
      const installed = installedVersion(trainer, library?.trainers || []);
      const otherVersion = library?.trainers?.some(item => item.trainer_id === trainer.id);
      const job = activeVersion(trainer, jobs);
      const fraction = job && job.total > 0 ? job.downloaded / job.total : 0;
      const percent = job?.state === "extracting" ? 100
        : Number.isFinite(fraction) ? Math.max(0, Math.min(100, Math.floor(fraction * 100))) : 0;
      const description = job ? <span style={{ color: colors.accentText }}>{jobStateLabel(t, job, percent)}</span>
        : [trainer.version, otherVersion && !installed ? t.otherVersionInstalled : ""].filter(Boolean).join(" · ");
      return <Row key={trainer.id} title={trainer.trainer_name} description={description}
        footer={job ? <Progress percent={percent} label={trainer.trainer_name} /> : undefined}>
        {installed ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: colors.muted, padding: "0 14px" }}>
          <FaCheck aria-hidden />{t.downloaded}</span>
          : job ? <Button style={{ height: 36, background: "transparent", color: "#a9b1b8" }} disabled>{t.downloadingPending}</Button>
          : <Button style={{ height: 36 }} disabled={starting.has(trainer.id) || !library?.success} onClick={() => { void download(trainer); }}>
            {starting.has(trainer.id) ? t.starting : otherVersion ? t.downloadVersion : t.download}</Button>}
      </Row>;
    })}
    {results.length > 0 && <div style={{ borderTop: `1px solid ${colors.line}` }} />}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "12px 14px", borderRadius: 4, background: colors.surface, fontSize: 13, color: "#a9b1b8" }}>
      <FaInfoCircle aria-hidden />{t.searchHint}</div>
  </Focusable>;
}
