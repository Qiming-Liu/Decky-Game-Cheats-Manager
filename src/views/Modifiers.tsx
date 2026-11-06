import { FileSelectionType, openFilePicker } from "@decky/api";
import { ConfirmModal, DialogButton, Focusable, showModal, Spinner } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invalidateLibrary, useLibrary } from "../hooks/useLibrary";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { useSidecar } from "../hooks/useSidecar";
import { cancelDownload, deleteTrainer, LINKED_ORIGIN, LocalTrainer, linkTrainer } from "../utils/backend";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Button, chip, colors, IconButton, jobStateLabel, PageHeader, Progress, Row, Status } from "./shell";
import {
  BackIcon, CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, CircleIcon, DownloadIcon, FolderIcon, PlayFilledIcon, SearchIcon, StopIcon,
  TrashIcon, WarningIcon,
} from "./icons";

const PAGE_SIZE = 5;
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
  const [page, setPage] = useState(0);
  // A short last page keeps the height of a full one so the pager never moves.
  const listRef = useRef<HTMLDivElement>(null);
  const [fullHeight, setFullHeight] = useState(0);
  const showingFullPage = useRef(false);
  useLayoutEffect(() => {
    const height = listRef.current?.offsetHeight || 0;
    if (showingFullPage.current && height > fullHeight) setFullHeight(height);
  }, [page, library?.trainers?.length, jobs.length, searching, fullHeight]);
  const autoSelected = useRef(new Set<string>());
  const trainers = library?.trainers || [];
  const activeJobs = jobs.filter(job => job.state !== "done");
  const selected = trainers.find(trainer => sidecar.isSelected(trainer));
  const selectedName = selected?.name || (sidecar.selected ? baseName(sidecar.selected) : "");

  async function action(run: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await run(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }

  function choose(trainer: LocalTrainer) {
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
    const run = () => action(async () => {
      if (sidecar.isSelected(trainer)) await sidecar.clear();
      await deleteTrainer({ appId, directory: library?.directory || "", entryId: trainer.id });
      invalidateLibrary();
    });
    // A linked file is only forgotten, never deleted, so no confirmation is needed.
    if (trainer.origin === LINKED_ORIGIN) { void run(); return; }
    showModal(<ConfirmModal strTitle={t.deleteTitle} strDescription={t.deleteDescription(trainer.name)}
      strOKButtonText={t.delete} strCancelButtonText={t.cancel} onOK={() => { void run(); }} />, window);
  }

  const status = <Status message={message || error || sidecar.error ? errorMessage(message || error || sidecar.error, t) : undefined} />;
  const localFileButton = <Button disabled={busy || !library?.success} onClick={() => { void pickLocalFile(); }}>
    <FolderIcon size={16} width={2.2} />{t.localFile}</Button>;
  const empty = !loading && !error && !trainers.length && !activeJobs.length;

  if (searching || empty) {
    showingFullPage.current = false;
    return <Focusable flow-children="column">
      <PageHeader title={t.searchTitle} before={!empty && <IconButton label={t.back} style={{ background: colors.button, color: colors.text }}
        onClick={() => setSearching(false)}><BackIcon /></IconButton>}>
        {localFileButton}
      </PageHeader>
      {status}
      <TrainerSearch appId={appId} initialKeyword={gameName} />
    </Focusable>;
  }

  const rows = [
    ...trainers.map(trainer => {
      const current = sidecar.isSelected(trainer);
      const linked = trainer.origin === LINKED_ORIGIN;
      const programs = programsOf(trainer);
      const icon = trainer.missing ? <WarningIcon size={20} color={colors.warning} />
        : current ? <CheckCircleIcon size={20} color={colors.accent} /> : linked ? <FolderIcon size={20} color={colors.dim} /> : <CircleIcon size={20} color={colors.dim} />;
      const description = trainer.missing ? <span style={{ color: colors.warning }}>{t.fileMissingDetail}</span>
        : linked ? `${t.localFile} · ${trainer.path}`
        : !programs.length ? t.cheatEngineRequired
        : `${t.originOnline}${trainer.version ? ` · ${trainer.version}` : ""}`;
      return <Row key={trainer.id} tall icon={icon} title={trainer.name} description={description} highlight={current}
        titleColor={current ? colors.text : "#dcdedf"}
        disabled={busy || !sidecar.ready} onActivate={!current && !trainer.missing ? () => choose(trainer) : undefined}>
        {current && chip(t.inUse)}
        {trainer.missing && <Button style={{ height: 36, padding: "0 14px", fontSize: 13 }} disabled={busy} onClick={() => { void pickLocalFile(); }}>{t.reselectFile}</Button>}
        <IconButton tone="danger" label={linked ? t.removeLink : t.delete} disabled={busy || !sidecar.ready}
          onClick={() => remove(trainer)}><TrashIcon /></IconButton>
      </Row>;
    }),
    ...activeJobs.map(job => {
      const active = ["queued", "downloading", "extracting"].includes(job.state);
      const percent = job.state === "extracting" ? 100 : job.total ? Math.floor(job.downloaded / job.total * 100) : 0;
      const state = jobStateLabel(t, job, percent);
      return <Row key={job.id} tall icon={<DownloadIcon size={20} color={colors.accent} />} title={job.trainer_name} titleColor="#dcdedf"
        description={<span style={{ color: job.state === "error" ? colors.warning : colors.accentText }}>
          {state}{active && ` · ${t.autoSelectShort}`}{job.error && ` · ${errorMessage(job.error, t)}`}</span>}
        footer={active ? <Progress percent={percent} label={t.downloadProgress} indent={48} /> : undefined}>
        {active && <Button ghost style={{ height: 36, padding: "0 14px", fontSize: 13 }} disabled={busy || cancelling.has(job.id)}
          onClick={() => { void action(async () => {
            const result = await cancelDownload({ appId, jobId: job.id });
            setCancelling(previous => new Set(previous).add(job.id));
            trackDownload(result);
          }); }}>{cancelling.has(job.id) ? t.cancelling : t.cancel}</Button>}
      </Row>;
    }),
  ];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shownPage = Math.min(page, pages - 1);
  const pageRows = rows.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE);
  showingFullPage.current = pageRows.length === PAGE_SIZE;

  return <Focusable flow-children="column">
    <PageHeader title={t.tabModifiers}>
      <Button onClick={() => setSearching(true)}><SearchIcon size={16} />{t.search}</Button>
      {localFileButton}
    </PageHeader>
    {status}

    {sidecar.selected && <Focusable flow-children="row" style={{
      display: "flex", alignItems: "center", gap: 16, padding: "16px 18px", marginBottom: 16, borderRadius: 4,
      background: "rgba(26,159,255,.12)", border: "1px solid rgba(26,159,255,.45)",
    }}>
      <span aria-hidden style={{ display: "inline-flex", width: 36, height: 36, borderRadius: 18, background: colors.accent, color: "#fff", alignItems: "center", justifyContent: "center", flex: "0 0 36px" }}><PlayFilledIcon size={16} /></span>
      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontSize: 12, color: colors.accentText, fontWeight: 500 }}>{t.runsWithGame}</div>
        <div style={{ fontSize: 17, color: colors.text, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedName}</div>
        <div style={{ fontSize: 12, color: colors.muted }}>{t.switchWindowHint}</div>
      </div>
      <Button disabled={busy} onClick={() => { void action(sidecar.clear); }}><StopIcon size={16} />{t.stopUsing}</Button>
    </Focusable>}

    <div style={{ fontSize: 12, color: colors.muted, padding: "2px 4px 8px" }}>{t.downloadedTitle(trainers.length)}</div>
    {loading && !trainers.length && <Spinner style={{ height: 32 }} />}

    <div ref={listRef} style={{ minHeight: pages > 1 ? fullHeight : undefined }}>
      {pageRows}
      <div style={{ borderTop: `1px solid ${colors.line}` }} />
    </div>
    {pages > 1 && <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 10 }}>
      <IconButton label={t.previousPage} disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}><ChevronLeftIcon /></IconButton>
      <span style={{ fontSize: 13, color: colors.muted, minWidth: 48, textAlign: "center" }}>{shownPage + 1} / {pages}</span>
      <IconButton label={t.nextPage} disabled={shownPage === pages - 1} onClick={() => setPage(shownPage + 1)}><ChevronRightIcon /></IconButton>
    </Focusable>}
  </Focusable>;
}
