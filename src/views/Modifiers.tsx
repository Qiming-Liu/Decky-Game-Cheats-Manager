import { FileSelectionType, openFilePicker } from "@decky/api";
import {
  ConfirmModal, DialogButton, Field, Focusable, Menu, MenuItem, showContextMenu, showModal, Spinner,
} from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import {
  FaArrowLeft, FaCheckCircle, FaEllipsisH, FaExclamationTriangle, FaFolderOpen, FaInfoCircle, FaPlay, FaRegCircle, FaSearch, FaTimes,
} from "react-icons/fa";

const iconStyle = { marginRight: 8, verticalAlign: -2 } as const;
import { invalidateLibrary, useLibrary } from "../hooks/useLibrary";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { useSidecar } from "../hooks/useSidecar";
import { cancelDownload, deleteTrainer, LINKED_ORIGIN, LocalTrainer, linkTrainer } from "../utils/backend";
import { errorMessage, useTranslations } from "../utils/i18n";
import TrainerRow, { actionButtonStyle, TrainerName } from "./TrainerRow";
import TrainerSearch from "./TrainerSearch";

const programsOf = (trainer: LocalTrainer) => trainer.files.filter(file => /\.(exe|bat)$/i.test(file));
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export default function Modifiers({ appId, gameName }: { appId: string; gameName: string }) {
  const t = useTranslations();
  const { library, loading, error } = useLibrary(appId, gameName);
  const jobs = useDownloads().filter(job => job.app_ids.includes(appId));
  const sidecar = useSidecar(appId, library?.directory || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [cancelling, setCancelling] = useState(new Set<string>());
  const autoSelected = useRef(new Set<string>());
  const trainers = library?.trainers || [];
  const activeJobs = jobs.filter(job => job.state !== "done");
  const selected = trainers.find(trainer => sidecar.isSelected(trainer));

  async function action(run: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await run(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }

  function choose(trainer: LocalTrainer) {
    if (trainer.missing) { void pickLocalFile(); return; }
    const programs = programsOf(trainer);
    if (!programs.length) { setMessage("executableRequired"); return; }
    if (programs.length === 1) { void action(() => sidecar.select(trainer, programs[0])); return; }
    const modal = showModal(<ConfirmModal strTitle={t.chooseProgram} bAlertDialog strOKButtonText={t.cancel}
      strDescription={<Focusable flow-children="column">{programs.map(file =>
        <DialogButton key={file} style={{ marginBottom: 6 }} onClick={() => {
          modal.Close(); void action(() => sidecar.select(trainer, file));
        }}>{file}</DialogButton>)}</Focusable>} />, window);
  }

  // A finished download is selected automatically when nothing is selected yet.
  useEffect(() => {
    if (!sidecar.ready || sidecar.selected || busy) return;
    for (const job of jobs) {
      if (job.state !== "done" || !job.path || autoSelected.current.has(job.id)) continue;
      autoSelected.current.add(job.id);
      const trainer = trainers.find(item => item.path === job.path);
      const programs = trainer ? programsOf(trainer) : [];
      if (trainer && programs.length === 1) void action(() => sidecar.select(trainer, programs[0]));
      return;
    }
  }, [jobs, trainers, sidecar.ready, sidecar.selected]);

  async function pickLocalFile() {
    let source: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FILE, "/home", true, true, undefined, ["exe", "bat"]);
      source = picked.realpath || picked.path;
    } catch { return; }
    await action(async () => {
      const path = await linkTrainer({ appId, directory: library?.directory || "", source, gameName });
      invalidateLibrary();
      await sidecar.use(path);
      setSearching(false);
    });
  }

  function remove(trainer: LocalTrainer) {
    const linked = trainer.origin === LINKED_ORIGIN;
    const run = () => action(async () => {
      if (sidecar.isSelected(trainer)) await sidecar.clear();
      await deleteTrainer({ appId, directory: library?.directory || "", entryId: trainer.id });
      invalidateLibrary();
    });
    if (linked) { void run(); return; }
    showModal(<ConfirmModal strTitle={t.deleteTitle} strDescription={t.deleteDescription(trainer.name)}
      strOKButtonText={t.delete} strCancelButtonText={t.cancel} onOK={() => { void run(); }} />, window);
  }

  function openMenu(trainer: LocalTrainer, target?: EventTarget) {
    showContextMenu(<Menu label={trainer.name}>
      <MenuItem onSelected={() => remove(trainer)}>{trainer.origin === LINKED_ORIGIN ? t.removeLink : t.delete}</MenuItem>
    </Menu>, target);
  }

  const status = (message || error || sidecar.error) &&
    <div role="status" style={{ overflowWrap: "anywhere", margin: "6px 0" }}>{errorMessage(message || error || sidecar.error, t)}</div>;
  const empty = !loading && !error && !trainers.length && !activeJobs.length;

  if (searching || empty) {
    return <Focusable flow-children="column">
      {status}
      <TrainerSearch appId={appId} initialKeyword={gameName} />
      <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        {!empty && <DialogButton style={actionButtonStyle} onClick={() => setSearching(false)}><FaArrowLeft aria-hidden style={iconStyle} />{t.back}</DialogButton>}
        <span style={{ flex: "1 1 auto", fontSize: 13, opacity: .6 }}>{t.notFoundQuestion}</span>
        <DialogButton style={{ ...actionButtonStyle, width: "auto", color: "#1a9fff" }} disabled={busy || !library?.success}
          onClick={() => { void pickLocalFile(); }}><FaFolderOpen aria-hidden style={iconStyle} />{t.useLocalFile}</DialogButton>
      </Focusable>
    </Focusable>;
  }

  return <Focusable flow-children="column">
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", marginBottom: 10, borderRadius: 4,
      background: selected || sidecar.selected ? "rgba(89, 191, 64, .18)" : "#23262e",
    }}>
      <div style={{ flex: "1 1 0", minWidth: 0, overflowWrap: "anywhere", color: selected || sidecar.selected ? "#8ee06f" : undefined }}>
        {selected || sidecar.selected ? <FaPlay aria-hidden style={iconStyle} /> : <FaRegCircle aria-hidden style={{ ...iconStyle, opacity: .5 }} />}
        {selected || sidecar.selected ? t.runningWith(selected?.name || baseName(sidecar.selected || "")) : t.noModifierSelected}
      </div>
      {sidecar.selected && <DialogButton style={actionButtonStyle} disabled={busy}
        onClick={() => { void action(sidecar.clear); }}><FaTimes aria-hidden style={iconStyle} />{t.stopUsing}</DialogButton>}
    </div>
    {status}
    {activeJobs.map(job => {
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
    {loading && !trainers.length && <Spinner style={{ height: 32 }} />}
    {trainers.map(trainer => {
      const current = sidecar.isSelected(trainer);
      const linked = trainer.origin === LINKED_ORIGIN;
      const icon = trainer.missing ? <FaExclamationTriangle color="#e3a33b" />
        : current ? <FaCheckCircle color="#1a9fff" /> : <FaRegCircle style={{ opacity: .5 }} />;
      return <Field key={trainer.id} focusable highlightOnFocus icon={icon} label={trainer.name}
        description={trainer.missing ? t.fileMissing : linked ? trainer.path : !programsOf(trainer).length ? t.cheatEngineRequired : t.originOnline}
        disabled={busy || !sidecar.ready} onActivate={() => { if (!current) choose(trainer); }}
        childrenContainerWidth="min">
        <DialogButton aria-label={t.moreActions} style={{ width: 40, minWidth: 40, height: 40, padding: 0 }}
          disabled={busy || !sidecar.ready} onClick={event => openMenu(trainer, event.currentTarget ?? undefined)}>
          <FaEllipsisH aria-hidden /></DialogButton>
      </Field>;
    })}
    <Focusable flow-children="row" style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <DialogButton style={{ flex: "1 1 0" }} onClick={() => setSearching(true)}><FaSearch aria-hidden style={iconStyle} />{t.findModifier}</DialogButton>
      <DialogButton style={{ flex: "1 1 0" }} disabled={busy || !library?.success} onClick={() => { void pickLocalFile(); }}>
        <FaFolderOpen aria-hidden style={iconStyle} />{t.useLocalFile}</DialogButton>
    </Focusable>
    <div style={{ fontSize: 12, opacity: .6, marginTop: 10 }}><FaInfoCircle aria-hidden style={{ marginRight: 6, verticalAlign: -1 }} />{t.switchWindowHint}</div>
  </Focusable>;
}
