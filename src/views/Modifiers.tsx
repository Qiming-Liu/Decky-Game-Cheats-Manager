import { FileSelectionType, openFilePicker } from "@decky/api";
import { Focusable, Navigation, Spinner } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invalidateLibrary, useLibrary } from "../hooks/useLibrary";
import { dismissDownload, trackDownload, useDownloads } from "../hooks/useDownloads";
import { useSettings } from "../hooks/useSettings";
import { useTrainerLaunch } from "../hooks/useTrainerLaunch";
import { isTableFile, launchableFiles, tableOnly } from "../domain/trainer";
import { isTable } from "../domain/trainerCommand";
import { cancelDownload, deleteTrainer, LINKED_ORIGIN, LocalTrainer, linkTrainer } from "../utils/backend";
import { downloadCheatEngine } from "../hooks/useCheatEngine";
import { bumperStep } from "../utils/bumpers";
import { errorMessage, getLanguage, useTranslations } from "../utils/i18n";
import { Badge, Button, Collapsible, colors, IconButton, jobStateLabel, PageHeader, Progress, Row, Status } from "./shell";
import {
  AlertCircleIcon, BackIcon, BumperGlyph,CheckCircleIcon, CheckIcon, ChevronUpIcon, TerminalIcon, WindowIcon, ChevronLeftIcon, ChevronRightIcon, CircleIcon, CrossIcon, DownloadIcon, FolderIcon, LinkIcon, SearchIcon, SquareIcon,
  StopIcon, TableIcon, TrashIcon, WarningIcon,
} from "./icons";
import TrainerSearch from "./TrainerSearch";

const PAGE_SIZE = 5;
const programsOf = launchableFiles;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const small = { height: 36, padding: "0 14px", fontSize: 13 } as const;
const pagerArrow = { width: 36, minWidth: 36, height: 36 } as const;
// Downloads started before this load (kept by the backend across a frontend
// reload) are never applied, so reopening the page does not switch trainers.
const LOADED_AT = Date.now() / 1000;
const autoSelected = new Set<string>();

/** Marks a trainer in use: a solid blue disc with the "starts with the game" link. */
const InUseBadge = ({ label }: { label: string }) =>
  <span role="img" aria-label={label} title={label} style={{
    display: "inline-flex", width: 30, height: 30, flex: "0 0 30px", borderRadius: 15, background: colors.accent, color: "#fff",
    alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 3px rgba(26,159,255,.25)",
  }}><LinkIcon size={16} width={2.6} /></span>;

/** A ticked box: a selected trainer when several may run. */
const CheckedBox = ({ label }: { label: string }) =>
  <span role="img" aria-label={label} style={{
    display: "inline-flex", width: 20, height: 20, flex: "0 0 20px", borderRadius: 5, background: colors.accent, color: "#fff",
    alignItems: "center", justifyContent: "center",
  }}><CheckIcon size={14} width={3.2} /></span>;

/** `unsupportedTool` names the game's compatibility tool when it is known to break trainers. */
export default function Modifiers({ appId, gameName, unsupportedTool = "" }: { appId: string; gameName: string; unsupportedTool?: string }) {
  const t = useTranslations();
  const { library, loading, error } = useLibrary(appId, gameName);
  const jobs = useDownloads().filter(job => job.app_ids.includes(appId));
  const settingsLoaded = useSettings() !== undefined;
  const launch = useTrainerLaunch(appId, library?.directory || "", library?.real_directory || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<string>();
  // The table to use once Cheat Engine, downloaded for it, is installed.
  const [pendingTable, setPendingTable] = useState<string>();
  const engine = launch.cheatEngine;
  // Unknown status (still loading, or unreadable) offers nothing; choosing a table then reads it again.
  const needsEngine = (trainer: LocalTrainer) => programsOf(trainer).some(isTableFile) && engine !== undefined && !engine.installed;
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
  const trainers = library?.trainers || [];
  // Running and failed downloads get a row; a cancelled one simply goes away.
  const activeJobs = jobs.filter(job => job.state !== "done" && job.state !== "cancelled");
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

  // A trainer with several programs opens in place to list them; only one row is open at a time.
  // A table without Cheat Engine opens in place too, offering to install it.
  function choose(trainer: LocalTrainer) {
    const programs = programsOf(trainer);
    if (!programs.length) { setMessage("executableRequired"); return; }
    if (programs.length === 1 && !needsEngine(trainer)) { void action(() => launch.select(trainer, programs[0])); return; }
    setOpen(open === trainer.id ? undefined : trainer.id);
  }

  /** Uses a table once Cheat Engine is there: directly, or by opening the row to pick one. */
  function useTable(trainer: LocalTrainer) {
    const programs = programsOf(trainer);
    if (programs.length === 1) void action(() => launch.select(trainer, programs[0]));
    else setOpen(trainer.id);
  }

  /** The in-place offer to install Cheat Engine for an opened table. */
  function enginePanel(trainer: LocalTrainer) {
    const download = () => action(async () => {
      const job = await downloadCheatEngine();
      if (job) trackDownload(job);
      setPendingTable(trainer.id);
      setOpen(undefined);
    });
    return <Focusable flow-children="row" style={{
      display: "flex", alignItems: "center", gap: 12, margin: "0 14px 12px 48px", padding: "10px 10px 10px 12px", borderRadius: 4, background: "rgba(255,255,255,.1)",
    }}>
      <span style={{ display: "inline-flex", color: colors.warning }}><DownloadIcon size={18} width={2.2} /></span>
      <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 14, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.ceNeedFirst}</span>
      <Button style={{ ...small, minWidth: 96, background: "#dcdedf", color: "#0e141b" }} disabled={busy} onClick={() => { void download(); }}
        onSecondaryButton={() => { void download(); }} onSecondaryActionDescription={t.ceDownloadUse}><Badge button="X" dark />{t.ceDownloadUse}</Button>
    </Focusable>;
  }

  /** The programs of an opened trainer, each with its own action. */
  function programList(trainer: LocalTrainer) {
    if (needsEngine(trainer)) return enginePanel(trainer);
    return <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 14px 12px 48px" }}>
      {programsOf(trainer).map(file => {
        const path = launch.programPath(trainer, file);
        const script = /\.bat$/i.test(file);
        const table = isTableFile(file);
        return <Focusable key={file} flow-children="row" style={{
          display: "flex", alignItems: "center", gap: 12, padding: "8px 10px 8px 12px", borderRadius: 4,
          background: path && launch.multiple ? "rgba(26,159,255,.1)" : undefined,
        }}>
          {launch.multiple && (path ? <CheckedBox label={t.selected} /> : <SquareIcon size={20} color={colors.dim} />)}
          <span style={{ display: "inline-flex", color: colors.muted }}>{table ? <TableIcon /> : script ? <TerminalIcon /> : <WindowIcon />}</span>
          <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 14, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file}</span>
          <span style={{ fontSize: 12, color: colors.muted, whiteSpace: "nowrap" }}>{table ? t.kindTable : script ? t.kindScript : t.kindProgram}</span>
          {launch.multiple
            ? <Button style={{ ...small, minWidth: 96 }} disabled={busy} onClick={() => {
                void action(() => path ? launch.removeProgram(path) : launch.select(trainer, file));
              }}>{path ? t.removeProgram : t.addProgram}</Button>
            : path ? <InUseBadge label={t.inUse} />
            : <Button style={{ ...small, minWidth: 96 }} disabled={busy} onClick={() => {
                void action(async () => { await launch.select(trainer, file); setOpen(undefined); });
              }}>{t.useThis}</Button>}
        </Focusable>;
      })}
    </Focusable>;
  }

  // A finished download is used automatically, replacing
  // the trainer in use (or joining it when several may run). The job waits until
  // the refreshed library lists it, and a table until Cheat Engine is installed
  // too; each job is handled once per plugin load.
  useEffect(() => {
    if (!settingsLoaded || !launch.ready || busy) return;
    for (const job of jobs) {
      if (job.state !== "done" || !job.path || job.started_at < LOADED_AT || autoSelected.has(job.id)) continue;
      const trainer = trainers.find(item => item.path === job.path);
      // A table waits for a Cheat Engine that is known to be there.
      if (!trainer || (programsOf(trainer).some(isTableFile) && !engine?.installed)) continue;
      autoSelected.add(job.id);
      const programs = programsOf(trainer);
      if (programs.length === 1 && launch.indexOf(trainer) < 0) void action(() => launch.select(trainer, programs[0]));
      else if (programs.length > 1) setOpen(trainer.id);
      return;
    }
  }, [jobs, trainers, launch.ready, busy, settingsLoaded, engine?.installed]);

  // The table that asked for Cheat Engine is used as soon as it is installed.
  useEffect(() => {
    if (!pendingTable || !engine?.installed || !launch.ready || busy) return;
    const trainer = trainers.find(item => item.id === pendingTable);
    setPendingTable(undefined);
    if (trainer) useTable(trainer);
  }, [pendingTable, engine?.installed, launch.ready, busy, trainers]);

  async function pickLocalFile() {
    let source: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FILE, "/home", true, true, undefined, ["exe", "bat", "ct", "cetrainer"]);
      source = picked.realpath || picked.path;
    } catch { return; }
    await action(async () => {
      const path = await linkTrainer({ appId, directory: library?.directory || "", source, gameName });
      invalidateLibrary();
      await launch.use(path);
      setSearching(false);
    });
  }

  // Deleting needs no confirmation: downloaded files go to the plugin's trash
  // cache and come back on the next download, and a linked file is only forgotten.
  function remove(trainer: LocalTrainer) {
    void action(async () => {
      if (launch.isSelected(trainer)) await launch.unselect(trainer);
      await deleteTrainer({ appId, directory: library?.directory || "", entryId: trainer.id });
      invalidateLibrary();
    });
  }

  const status = <Status message={message || error || launch.error ? errorMessage(message || error || launch.error, t) : undefined} />;
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

  const multiple = launch.multiple;
  // Always alphabetical: choosing a trainer never moves it.
  const collator = new Intl.Collator(getLanguage(), { numeric: true, sensitivity: "base" });
  const ordered = [...trainers].sort((a, b) => collator.compare(a.name, b.name));
  const rows = [
    ...ordered.map(trainer => {
      const current = launch.indexOf(trainer) >= 0;
      const linked = trainer.origin === LINKED_ORIGIN;
      const programs = programsOf(trainer);
      const tables = programs.filter(isTableFile);
      const icon = trainer.missing ? <WarningIcon size={20} color={colors.warning} />
        : multiple ? current ? <CheckedBox label={t.selected} /> : <SquareIcon size={20} color={colors.dim} />
        : current ? <CheckCircleIcon size={20} color={colors.accent} /> : linked ? <FolderIcon size={20} color={colors.dim} /> : <CircleIcon size={20} color={colors.dim} />;
      const source = linked ? `${t.localSource} · ${trainer.path}`
        : [t.originOnline, trainer.version, trainer.author, tables.length ? t.kindTable : ""].filter(Boolean).join(" · ");
      const description = trainer.missing ? <span style={{ color: colors.warning }}>{t.fileMissingDetail}</span>
        : !programs.length ? t.executableRequired
        : needsEngine(trainer) ? <>{source} · <span style={{ color: colors.warning }}>{t.cheatEngineRequired}</span></>
        : source;
      // Several programs: the row opens. One program: the row selects it, or
      // toggles it in and out when several trainers may run.
      const activate = trainer.missing ? undefined
        : programs.length > 1 || needsEngine(trainer) ? () => choose(trainer)
        // A table whose Cheat Engine moved is chosen again to write the new place.
        : current && tables.length && launch.engineState === "moved" && !multiple ? () => choose(trainer)
        : current ? multiple ? () => { void action(() => launch.unselect(trainer)); } : undefined
        : () => choose(trainer);
      if (open === trainer.id) {
        const count = tableOnly(trainer) ? t.tableCount(programs.length)
          : multiple ? t.programCountMultiple(programs.length) : t.programCount(programs.length);
        return <Row key={trainer.id} tall open icon={icon} title={trainer.name} titleColor={colors.text}
          description={<span style={{ color: needsEngine(trainer) ? colors.warning : colors.accentText }}>{needsEngine(trainer) ? source : count}</span>}
          disabled={!launch.ready} onActivate={activate} footer={programList(trainer)}>
          <IconButton label={t.collapse} onClick={() => setOpen(undefined)}><ChevronUpIcon /></IconButton>
        </Row>;
      }
      return <Row key={trainer.id} tall icon={icon} title={trainer.name} description={description} highlight={current}
        titleColor={current ? colors.text : "#dcdedf"} disabled={busy || !launch.ready} onActivate={activate}
        aside={current && <InUseBadge label={t.inUse} />}>
        {trainer.missing && <Button style={small} disabled={busy} onClick={() => { void pickLocalFile(); }}>{t.reselectFile}</Button>}
        <IconButton tone="danger" label={linked ? t.removeLink : t.delete} disabled={busy || !launch.ready}
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
        {job.state === "error" && <IconButton label={t.close} onClick={() => dismissDownload(job.id)}><CrossIcon /></IconButton>}
      </Row>;
    }),
  ];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shownPage = Math.min(page, pages - 1);
  const pageRows = rows.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE);
  // Pages holding a trainer in use are marked, so a selection on another page is never hidden.
  const selectedPages = new Set(ordered.flatMap((trainer, index) => launch.indexOf(trainer) >= 0 ? [Math.floor(index / PAGE_SIZE)] : []));
  showingFullPage.current = pageRows.length === PAGE_SIZE;
  const count = launch.selected.length;
  const separator = getLanguage().startsWith("zh") ? "，" : ", ";
  // Red warnings stay at the top: a broken Proton, a trainer in use whose file
  // is gone, or a table in use whose Cheat Engine is.
  const alerts = [
    unsupportedTool && t.compatWarnShort(unsupportedTool),
    launch.engineState === "missing" && t.tableEngineMissing,
    launch.engineState === "moved" && t.tableEngineMoved,
    trainers.some(trainer => trainer.missing && launch.indexOf(trainer) >= 0) && t.selectedFileMissing,
  ].filter((text): text is string => Boolean(text));
  const warned = alerts.length > 0;

  // L1/R1 turn the list's pages from anywhere on the page.
  return <Focusable flow-children="column"
    onButtonDown={bumperStep(direction => setPage(Math.min(pages - 1, Math.max(0, shownPage + direction))))}>
    <PageHeader title={t.tabModifiers}>
      {unsupportedTool && <Button style={{ background: colors.danger, color: "#fff" }}
        onClick={() => Navigation.Navigate(`/app/${appId}/properties/compatibility`)}><AlertCircleIcon size={16} />{t.switchProton}</Button>}
      <Button onClick={() => setSearching(true)}><SearchIcon size={16} />{t.search}</Button>
      {localFileButton}
    </PageHeader>
    {status}

    {count > 0 && <Focusable flow-children="row" aria-label={t.runsWithGame} style={{
      display: "flex", alignItems: "center", gap: 14, padding: "12px 12px 12px 14px", marginBottom: warned ? 0 : 16,
      borderRadius: warned ? "6px 6px 0 0" : 6, background: "#1b2838",
      border: `1px solid ${warned ? "rgba(227,91,91,.6)" : "rgba(124,196,255,.25)"}`,
    }}>
      <span aria-hidden style={{
        display: "inline-flex", width: 40, height: 40, flex: "0 0 40px", borderRadius: 8, background: "rgba(26,159,255,.18)",
        color: colors.accentText, alignItems: "center", justifyContent: "center",
      }}><LinkIcon size={20} /></span>
      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, fontSize: 16, fontWeight: 500, color: colors.text }}>
          <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{launch.selected.map(nameOf).join(separator)}</span>
          {count > 1 && <span style={{ flex: "0 0 auto", fontSize: 14, fontWeight: 400, color: colors.accentText }}>{t.moreCount(count)}</span>}
        </div>
        <div style={{ fontSize: 12, color: colors.muted }}>
          <span style={{ color: colors.accentText }}>{t.runsWithGame}</span>
          {launch.selected.some(isTable) && ` · ${t.viaCheatEngine(engine?.version || "")}`} · {t.switchWindowHint}</div>
      </div>
      <Button disabled={busy} onClick={() => { void action(launch.clear); }}
        onOptionsButton={() => { if (!busy) void action(launch.clear); }} onOptionsActionDescription={count > 1 ? t.stopAll : t.stopUsing}>
        <StopIcon size={14} />{count > 1 ? t.stopAll : t.stopUsing}<Badge button="Y" /></Button>
    </Focusable>}
    {/* Joined under the in-use card, or on their own. */}
    {warned && <div role="alert" style={{
      display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", marginBottom: 16,
      borderRadius: count > 0 ? "0 0 6px 6px" : 6, background: "rgba(227,91,91,.16)",
      border: "1px solid rgba(227,91,91,.6)", ...(count > 0 ? { borderTop: 0 } : {}), color: "#ff9b9b", fontSize: 13,
    }}>{alerts.map(text => <div key={text} style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <AlertCircleIcon size={18} color={colors.danger} /><span>{text}</span></div>)}</div>}

    {/* The pager sits on the count line so the list and its tips fit one screen. */}
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 36, fontSize: 12, color: colors.muted, padding: "0 4px 8px" }}>
      <span>{t.downloadedTitle(trainers.length)}</span>
      {multiple && <span style={{ color: colors.accentText }}>{t.selectedCount(count)}</span>}
      {pages > 1 && <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
        <BumperGlyph side="L" color={colors.muted} />
        <IconButton label={t.previousPage} disabled={shownPage === 0} focusable={shownPage > 0} style={pagerArrow} onClick={() => setPage(shownPage - 1)}><ChevronLeftIcon /></IconButton>
        {Array.from({ length: pages }, (_, index) => {
          const current = index === shownPage, marked = selectedPages.has(index);
          return <Button key={index} aria-label={t.pageLabel(index + 1)} aria-current={current ? "page" : undefined}
            onClick={() => setPage(index)} style={{
              width: 36, minWidth: 36, height: 36, padding: 0, fontSize: 14, fontWeight: current ? 700 : 400,
              background: current ? (marked ? colors.accent : colors.button) : marked ? "rgba(26,159,255,.18)" : "transparent",
              color: current ? colors.text : marked ? colors.accentText : "#a9b1b8",
              boxShadow: marked && !current ? "inset 0 0 0 1px rgba(124,196,255,.5)" : undefined,
            }}>{index + 1}</Button>;
        })}
        <IconButton label={t.nextPage} disabled={shownPage === pages - 1} focusable={shownPage < pages - 1} style={pagerArrow} onClick={() => setPage(shownPage + 1)}><ChevronRightIcon /></IconButton>
        <BumperGlyph side="R" color={colors.muted} />
      </Focusable>}
    </Focusable>
    {loading && !trainers.length && <Spinner style={{ height: 32 }} />}

    <div ref={listRef} style={{ minHeight: pages > 1 ? fullHeight : undefined }}>
      {pageRows}
      <div style={{ borderTop: `1px solid ${colors.line}` }} />
    </div>
    <Collapsible title={t.tipsTitle}>
      <div>{t.tipWindowed}</div>
      <div>{t.tipRuntimes}</div>
    </Collapsible>
  </Focusable>;
}
