import { useTranslations, errorMessage } from "../utils/i18n";
import { ConfirmModal, DialogButton, Focusable, showModal, Spinner, Toggle } from "@decky/ui";
import { FaTrashAlt } from "react-icons/fa";
import { useState } from "react";
import { useLibrary, invalidateLibrary } from "../hooks/useLibrary";
import { useDownloads, trackDownload } from "../hooks/useDownloads";
import { LocalTrainer, deleteTrainer, cancelDownload } from "../utils/backend";
import { useSidecar } from "../hooks/useSidecar";
import TrainerRow, { actionButtonStyle, TrainerName } from "./TrainerRow";

export default function Downloaded({ appId, gameName }: { appId: string; gameName: string }) {
  const t = useTranslations();
  const { library, loading, error } = useLibrary(appId, gameName);
  const jobs = useDownloads().filter(job => job.app_ids.includes(appId) && job.state !== "done");
  const sidecar = useSidecar(appId, library?.directory || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(new Set<string>());
  async function action(run: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await run(); }
    catch (error) {
      setMessage(error instanceof Error ? error.message : "unknownError");
      try { await sidecar.refresh(); } catch { /* Keep the original error visible. */ }
    }
    finally { setBusy(false); }
  }
  function toggleSidecar(trainer: LocalTrainer, enabled: boolean) {
    if (!enabled) {
      void action(sidecar.clear);
      return;
    }
    const programs = trainer.files.filter(file => /\.(exe|bat)$/i.test(file));
    if (programs.length === 1) {
      void action(() => sidecar.select(trainer, programs[0]));
      return;
    }
    const modal = showModal(<ConfirmModal strTitle={t.useSidecar} bAlertDialog strOKButtonText={t.cancel}
      strDescription={<Focusable flow-children="column">{programs.map(file =>
        <DialogButton key={file} style={{ marginBottom: 6 }} onClick={() => {
          modal.Close(); void action(() => sidecar.select(trainer, file));
        }}>{file}</DialogButton>)}</Focusable>} />, window);
  }
  function remove(trainer: LocalTrainer) {
    showModal(<ConfirmModal strTitle={t.deleteTitle} strDescription={t.deleteDescription(trainer.name)}
      strOKButtonText={t.delete} strCancelButtonText={t.cancel} onOK={() => { void action(async () => {
        if (sidecar.isSelected(trainer)) await sidecar.clear();
        await deleteTrainer({ appId, directory: library?.directory || "", entryId: trainer.id });
        invalidateLibrary();
      }); }} />, window);
  }
  return <Focusable flow-children="column">
    {(message || error || sidecar.error) && <div role="status" style={{ overflowWrap: "anywhere", marginBottom: 6 }}>{errorMessage(message || error || sidecar.error, t)}</div>}
    {jobs.map(job => {
      const active = ["queued", "downloading", "extracting"].includes(job.state);
      const percent = job.total ? Math.floor(job.downloaded / job.total * 100) : null;
      return <TrainerRow key={job.id}>
        <TrainerName>{job.trainer_name}
        <div role="status" style={{ fontSize: 12, opacity: .7, overflowWrap: "anywhere" }}>
          {job.state === "downloading" ? t.downloading(percent) : job.state === "error" ? t.failed : t[job.state]}
          {job.error && <div>{errorMessage(job.error, t)}</div>}</div>
        {active && job.total > 0 && <progress aria-label={t.downloadProgress} value={job.downloaded} max={job.total} style={{ width: "100%" }} />}
        </TrainerName>
        {active && <DialogButton style={actionButtonStyle} disabled={busy || cancelling.has(job.id)} onClick={() => { void action(async () => {
          const result = await cancelDownload({ appId, jobId: job.id });
          setCancelling(previous => new Set(previous).add(job.id));
          trackDownload(result);
        }); }}>{cancelling.has(job.id) ? t.cancelling : t.cancelDownload}</DialogButton>}
      </TrainerRow>;
    })}
      <h2 style={{ fontSize: 20, fontWeight: 600, margin: "12px 0" }}>{t.sidecarRun}</h2>
      {loading && <Spinner style={{ height: 32 }} />}
      {!loading && !library?.trainers?.length && !jobs.length && !error && <div>{t.noTrainers}</div>}
      {library?.trainers?.map(trainer => {
        const programs = trainer.files.filter(file => /\.(exe|bat)$/i.test(file));
        const current = sidecar.isSelected(trainer);
        return <TrainerRow key={trainer.id}>
          <TrainerName>{trainer.name}</TrainerName>
          <div role="group" aria-label={`${t.useSidecar}: ${trainer.name}`} title={programs.length || current ? t.useSidecar : t.cheatEngineRequired}>
            <Toggle value={current} disabled={busy || !sidecar.ready || (!programs.length && !current)}
              onChange={enabled => toggleSidecar(trainer, enabled)} />
          </div>
          <DialogButton aria-label={`${t.deleteTrainer}: ${trainer.name}`} style={{
            width: 40, minWidth: 40, height: 40, padding: 0, flex: "0 0 40px", background: "#a9323b", color: "#fff",
          }} disabled={busy || !sidecar.ready} onClick={() => remove(trainer)}><FaTrashAlt aria-hidden /></DialogButton>
        </TrainerRow>;
      })}
  </Focusable>;
}
