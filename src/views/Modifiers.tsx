import { FileSelectionType, openFilePicker } from "@decky/api";
import { ConfirmModal, DialogButton, Focusable, showModal, Spinner } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invalidateLibrary, useLibrary } from "../hooks/useLibrary";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { useSettings } from "../hooks/useSettings";
import { useSidecar } from "../hooks/useSidecar";
import { cancelDownload, deleteTrainer, LINKED_ORIGIN, LocalTrainer, linkTrainer } from "../utils/backend";
import { errorMessage, getLanguage, useTranslations } from "../utils/i18n";
import { Button, colors, IconButton, jobStateLabel, PageHeader, Progress, Row, Status } from "./shell";
import {
  BackIcon, CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, CircleIcon, DownloadIcon, FolderIcon, LinkIcon, SearchIcon, SquareIcon,
  StopIcon, TrashIcon, WarningIcon,
} from "./icons";
import TrainerSearch from "./TrainerSearch";

const PAGE_SIZE = 5;
const programsOf = (trainer: LocalTrainer) => trainer.files.filter(file => /\.(exe|bat)$/i.test(file));
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const small = { height: 36, padding: "0 14px", fontSize: 13 } as const;

/** Marks a trainer in use: a solid blue disc with the "starts with the game" link. */
const InUseBadge = ({ label }: { label: string }) =>
  <span role="img" aria-label={label} title={label} style={{
    display: "inline-flex", width: 30, height: 30, flex: "0 0 30px", borderRadius: 15, background: colors.accent, color: "#fff",
    alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 3px rgba(26,159,255,.25)",
  }}><LinkIcon size={16} width={2.6} /></span>;

/** The order badge of a selected trainer when several may run. */
const OrderBadge = ({ number, label }: { number: number; label: string }) =>
  <span aria-label={label} style={{
    display: "inline-flex", width: 20, height: 20, flex: "0 0 20px", borderRadius: 5, background: colors.accent, color: "#fff",
    fontSize: 12, fontWeight: 700, alignItems: "center", justifyContent: "center",
  }}>{number}</span>;

export default function Modifiers({ appId, gameName }: { appId: string; gameName: string }) {
  const t = useTranslations();
  const { library, loading, error } = useLibrary(appId, gameName);
  const jobs = useDownloads().filter(job => job.app_ids.includes(appId));
  const settings = useSettings();
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
  const nameOf = (path: string) => trainers.find(trainer => {
    const prefix = trainer.path.endsWith("/") ? trainer.path : `${trainer.path}/`;
    return path === trainer.path || path.startsWith(prefix);
  })?.name || baseName(path);

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

  // A finished download is used automatically when the setting is on and
  // nothing is in use yet.
  useEffect(() => {
    if (!settings?.auto_select || !sidecar.ready || sidecar.selected.length || busy) return;
    for (const job of jobs) {
      if (job.state !== "done" || !job.path || autoSelected.current.has(job.id)) continue;
      autoSelected.current.add(job.id);
      const trainer = trainers.find(item => item.path === job.path);
      const programs = trainer ? programsOf(trainer) : [];
      if (trainer && programs.length === 1) void action(() => sidecar.select(trainer, programs[0]));
      return;
    }
  }, [jobs, trainers, sidecar.ready, sidecar.selected.length, settings?.auto_select]);

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
      if (sidecar.isSelected(trainer)) await sidecar.unselect(trainer);
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

  if (searching) {
    showingFullPage.current = false;
    return <Focusable flow-children="column">
      <PageHeader title={t.searchTitle} before={<IconButton label={t.back} style={{ background: colors.button, color: colors.text }}
        onClick={() => setSearching(false)}><BackIcon /></IconButton>}>
        {localFileButton}
      </PageHeader>
      {status}
      <TrainerSearch appId={appId} initialKeyword={gameName} />
    </Focusable>;
  }

  const multiple = sidecar.multiple;
  // Always alphabetical: choosing a trainer never moves it.
  const collator = new Intl.Collator(getLanguage(), { numeric: true, sensitivity: "base" });
  const ordered = [...trainers].sort((a, b) => collator.compare(a.name, b.name));
  const rows = [
    ...ordered.map(trainer => {
      const order = sidecar.indexOf(trainer);
      const current = order >= 0;
      const linked = trainer.origin === LINKED_ORIGIN;
      const programs = programsOf(trainer);
      const icon = trainer.missing ? <WarningIcon size={20} color={colors.warning} />
        : multiple ? current ? <OrderBadge number={order + 1} label={t.orderLabel(order + 1)} /> : <SquareIcon size={20} color={colors.dim} />
        : current ? <CheckCircleIcon size={20} color={colors.accent} /> : linked ? <FolderIcon size={20} color={colors.dim} /> : <CircleIcon size={20} color={colors.dim} />;
      const description = trainer.missing ? <span style={{ color: colors.warning }}>{t.fileMissingDetail}</span>
        : linked ? `${t.localSource} · ${trainer.path}`
        : !programs.length ? t.cheatEngineRequired
        : `${t.originOnline}${trainer.version ? ` · ${trainer.version}` : ""}`;
      // One trainer: a row selects itself. Several: a row toggles in and out.
      const activate = trainer.missing ? undefined
        : current ? multiple ? () => { void action(() => sidecar.unselect(trainer)); } : undefined
        : () => choose(trainer);
      return <Row key={trainer.id} tall icon={icon} title={trainer.name} description={description} highlight={current}
        titleColor={current ? colors.text : "#dcdedf"} disabled={busy || !sidecar.ready} onActivate={activate}>
        {current && <InUseBadge label={t.inUse} />}
        {trainer.missing && <Button style={small} disabled={busy} onClick={() => { void pickLocalFile(); }}>{t.reselectFile}</Button>}
        <IconButton tone="danger" label={linked ? t.removeLink : t.delete} disabled={busy || !sidecar.ready}
          onClick={() => remove(trainer)}><TrashIcon /></IconButton>
      </Row>;
    }),
    ...activeJobs.map(job => {
      const active = ["queued", "downloading", "extracting"].includes(job.state);
      const percent = job.state === "extracting" ? 100 : job.total ? Math.floor(job.downloaded / job.total * 100) : 0;
      return <Row key={job.id} tall icon={<DownloadIcon size={20} color={colors.accent} />} title={job.trainer_name} titleColor="#dcdedf"
        description={<span style={{ color: job.state === "error" ? colors.warning : colors.accentText }}>
          {jobStateLabel(t, job, percent)}{job.error && ` · ${errorMessage(job.error, t)}`}</span>}
        footer={active ? <Progress percent={percent} label={t.downloadProgress} indent={48} /> : undefined}>
        {active && <Button ghost style={small} disabled={busy || cancelling.has(job.id)}
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
  // Pages holding a trainer in use are marked, so a selection on another page is never hidden.
  const selectedPages = new Set(ordered.flatMap((trainer, index) => sidecar.indexOf(trainer) >= 0 ? [Math.floor(index / PAGE_SIZE)] : []));
  showingFullPage.current = pageRows.length === PAGE_SIZE;
  const count = sidecar.selected.length;
  const separator = getLanguage().startsWith("zh") ? "，" : ", ";

  return <Focusable flow-children="column">
    <PageHeader title={t.tabModifiers}>
      <Button onClick={() => setSearching(true)}><SearchIcon size={16} />{t.search}</Button>
      {localFileButton}
    </PageHeader>
    {status}

    {count > 0 && <Focusable flow-children="row" aria-label={t.runsWithGame} style={{
      display: "flex", alignItems: "center", gap: 14, padding: "12px 12px 12px 14px", marginBottom: 16, borderRadius: 6,
      background: "#1b2838", border: "1px solid rgba(124,196,255,.25)",
    }}>
      <span aria-hidden style={{
        display: "inline-flex", width: 40, height: 40, flex: "0 0 40px", borderRadius: 8, background: "rgba(26,159,255,.18)",
        color: colors.accentText, alignItems: "center", justifyContent: "center",
      }}><LinkIcon size={20} /></span>
      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, fontSize: 16, fontWeight: 500, color: colors.text }}>
          <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sidecar.selected.map(nameOf).join(separator)}</span>
          {count > 1 && <span style={{ flex: "0 0 auto", fontSize: 14, fontWeight: 400, color: colors.accentText }}>{t.moreCount(count)}</span>}
        </div>
        <div style={{ fontSize: 12, color: colors.muted }}>
          <span style={{ color: colors.accentText }}>{t.runsWithGame}</span>{count > 1 && ` · ${t.openInOrder}`} · {t.switchWindowHint}</div>
      </div>
      <Button disabled={busy} onClick={() => { void action(sidecar.clear); }}><StopIcon size={14} />{count > 1 ? t.stopAll : t.stopUsing}</Button>
    </Focusable>}

    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: colors.muted, padding: "2px 4px 8px" }}>
      <span>{t.downloadedTitle(trainers.length)}</span>
      {multiple && <span style={{ color: colors.accentText }}>{t.selectedCount(count)}</span>}
    </div>
    {loading && !trainers.length && <Spinner style={{ height: 32 }} />}

    <div ref={listRef} style={{ minHeight: pages > 1 ? fullHeight : undefined }}>
      {pageRows}
      <div style={{ borderTop: `1px solid ${colors.line}` }} />
    </div>
    {pages > 1 && <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 10 }}>
      <IconButton label={t.previousPage} disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}><ChevronLeftIcon /></IconButton>
      {Array.from({ length: pages }, (_, index) => {
        const current = index === shownPage, marked = selectedPages.has(index);
        return <Button key={index} aria-label={t.pageLabel(index + 1)} aria-current={current ? "page" : undefined}
          onClick={() => setPage(index)} style={{
            width: 40, minWidth: 40, height: 40, padding: 0, fontSize: 14, fontWeight: current ? 700 : 400,
            background: current ? (marked ? colors.accent : colors.button) : marked ? "rgba(26,159,255,.18)" : "transparent",
            color: current ? colors.text : marked ? colors.accentText : "#a9b1b8",
            boxShadow: marked && !current ? "inset 0 0 0 1px rgba(124,196,255,.5)" : undefined,
          }}>{index + 1}</Button>;
      })}
      <IconButton label={t.nextPage} disabled={shownPage === pages - 1} onClick={() => setPage(shownPage + 1)}><ChevronRightIcon /></IconButton>
    </Focusable>}
  </Focusable>;
}
