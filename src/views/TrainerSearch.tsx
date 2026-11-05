import { useTranslations, errorMessage, initLanguage, getSearchLanguage } from "../utils/i18n";
import { DialogButton, Focusable, Spinner, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { downloadTrainer, getDatabaseStatus, searchTrainers, TrainerResult } from "../utils/backend";
import { useLibrary, invalidateLibrary } from "../hooks/useLibrary";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import TrainerRow, { actionButtonStyle, TrainerName } from "./TrainerRow";
import { activeVersion, installedVersion } from "../domain/trainer";

export default function TrainerSearch({ appId, initialKeyword }: { appId: string; initialKeyword: string }) {
  const t = useTranslations();
  const { library, error } = useLibrary(appId, initialKeyword);
  const jobs = useDownloads();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [results, setResults] = useState<TrainerResult[]>([]);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
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
    <TrainerRow><div style={{ flex: "1 1 0", minWidth: 0 }}>
      <TextField aria-label={t.gameName} placeholder={t.gameName} value={keyword}
        onChange={event => { initialized.current = true; setKeyword(event.target.value); }} />
    </div><DialogButton style={actionButtonStyle} disabled={searching || !keyword.trim()} onClick={() => { void search(keyword); }}>
      {searching ? t.searching : t.search}</DialogButton></TrainerRow>
    {searching && <Spinner style={{ height: 32 }} />}
    {(message || error) && <div role="status">{errorMessage(message || error, t)}</div>}
    {results.map(trainer => {
      const installed = installedVersion(trainer, library?.trainers || []);
      const otherVersion = library?.trainers?.some(item => item.trainer_id === trainer.id);
      const job = activeVersion(trainer, jobs);
      const fraction = job && job.total > 0 ? job.downloaded / job.total : 0;
      const percent = job?.state === "extracting" ? 100
        : Number.isFinite(fraction) ? Math.max(0, Math.min(100, Math.floor(fraction * 100))) : 0;
      return <TrainerRow key={trainer.id}><TrainerName>{trainer.trainer_name}
        {trainer.version && <div style={{ fontSize: 12, opacity: .65, marginTop: 4 }}>{trainer.version}</div>}
      </TrainerName><DialogButton style={{ ...actionButtonStyle, ...(job && !installed ? {
        background: `linear-gradient(to right, #168bd2 0%, #168bd2 ${percent}%, #353b45 ${percent}%, #353b45 100%)`,
        color: "#fff", opacity: 1,
      } : {}) }}
        disabled={installed || Boolean(job) || starting.has(trainer.id) || !library?.success}
        onClick={() => { void download(trainer); }}>
        {installed ? t.downloaded : job ? <span role="progressbar" aria-label={trainer.trainer_name}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>{t.downloading(percent)}</span>
          : starting.has(trainer.id) ? t.starting : otherVersion ? t.downloadVersion : t.download}
      </DialogButton></TrainerRow>;
    })}
  </Focusable>;
}
