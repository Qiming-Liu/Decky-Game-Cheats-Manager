import { FileSelectionType, openFilePicker } from "@decky/api";
import { Focusable, Navigation, Spinner } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invalidateLibrary, useLibrary } from "../hooks/useLibrary";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { useSettings } from "../hooks/useSettings";
import { useSidecar } from "../hooks/useSidecar";
import { changeCheatEngine } from "../hooks/useCheatEngine";
import { isTableFile, launchableFiles, tableOnly } from "../domain/trainer";
import { isTable } from "../domain/sidecar";
import { cancelDownload, deleteTrainer, LINKED_ORIGIN, LocalTrainer, linkTrainer, manageCheatEngine } from "../utils/backend";
import { errorMessage, getLanguage, useTranslations } from "../utils/i18n";
import { Button, colors, IconButton, jobStateLabel, PageHeader, Progress, Row, Status } from "./shell";
import {
  AlertCircleIcon, BackIcon, CheckCircleIcon, CheckIcon, ChevronUpIcon, TerminalIcon, WindowIcon, ChevronLeftIcon, ChevronRightIcon, CircleIcon, DownloadIcon, FolderIcon, LinkIcon, SearchIcon, SquareIcon,
  StopIcon, TableIcon, TrashIcon, WarningIcon,
} from "./icons";
import TrainerSearch from "./TrainerSearch";

const PAGE_SIZE = 5;
const programsOf = launchableFiles;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const small = { height: 36, padding: "0 14px", fontSize: 13 } as const;
/** A gamepad button badge drawn inside a button, so the shortcut is visible. */
export const Badge = ({ button, dark }: { button: string; dark?: boolean }) =>
  <span aria-hidden style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 10,
    background: dark ? "rgba(14,20,27,.85)" : "#a9b1b8", color: dark ? "#fff" : "#0e141b", fontSize: 12, fontWeight: 700,
  }}>{button}</span>;

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
  const settings = useSettings();
  const sidecar = useSidecar(appId, library?.directory || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<string>();
  // The table to use once Cheat Engine, downloaded for it, is installed.
  const [pendingTable, setPendingTable] = useState<string>();
  const engine = sidecar.cheatEngine;
  const needsEngine = (trainer: LocalTrainer) => programsOf(trainer).some(isTableFile) && !engine?.installed;
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

  // A trainer with several programs opens in place to list them; only one row is open at a time.
  // A table without Cheat Engine opens in place too, offering to install it.
  function choose(trainer: LocalTrainer) {
    const programs = programsOf(trainer);
    if (!programs.length) { setMessage("executableRequired"); return; }
    if (programs.length === 1 && !needsEngine(trainer)) { void action(() => sidecar.select(trainer, programs[0])); return; }
    setOpen(open === trainer.id ? undefined : trainer.id);
  }

  /** Uses a table once Cheat Engine is there: directly, or by opening the row to pick one. */
  function useTable(trainer: LocalTrainer) {
    const programs = programsOf(trainer);
    if (programs.length === 1) void action(() => sidecar.select(trainer, programs[0]));
    else setOpen(trainer.id);
  }

  async function pickCheatEngineFolder() {
    let folder: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FOLDER, "/home", false, true);
      folder = picked.realpath || picked.path;
    } catch { return; }
    await action(() => changeCheatEngine("link", folder));
  }

  /** The in-place offer to install Cheat Engine for an opened table. */
  function enginePanel(trainer: LocalTrainer) {
    const download = () => action(async () => {
      const result = await manageCheatEngine("download");
      if (result.job) trackDownload(result.job);
      setPendingTable(trainer.id);
      setOpen(undefined);
    });
    return <Focusable flow-children="row" style={{
      display: "flex", alignItems: "center", gap: 12, margin: "0 14px 12px 48px", padding: "10px 10px 10px 12px", borderRadius: 4, background: "rgba(255,255,255,.1)",
    }}>
      <span style={{ display: "inline-flex", color: colors.warning }}><DownloadIcon size={18} width={2.2} /></span>
      <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 14, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.ceNeedFirst}</span>
      <Button style={small} disabled={busy} onClick={() => { void pickCheatEngineFolder(); }}
        onOptionsButton={() => { void pickCheatEngineFolder(); }} onOptionsActionDescription={t.ceHaveIt}><Badge button="Y" />{t.ceHaveIt}</Button>
      <Button style={{ ...small, minWidth: 96, background: "#dcdedf", color: "#0e141b" }} disabled={busy} onClick={() => { void download(); }}
        onSecondaryButton={() => { void download(); }} onSecondaryActionDescription={t.ceDownloadUse}><Badge button="X" dark />{t.ceDownloadUse}</Button>
    </Focusable>;
  }

  /** The programs of an opened trainer, each with its own action. */
  function programList(trainer: LocalTrainer) {
    if (needsEngine(trainer)) return enginePanel(trainer);
    return <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 14px 12px 48px" }}>
      {programsOf(trainer).map(file => {
        const path = sidecar.programPath(trainer, file);
        const script = /\.bat$/i.test(file);
        const table = isTableFile(file);
        return <Focusable key={file} flow-children="row" style={{
          display: "flex", alignItems: "center", gap: 12, padding: "8px 10px 8px 12px", borderRadius: 4,
          background: path && sidecar.multiple ? "rgba(26,159,255,.1)" : undefined,
        }}>
          {sidecar.multiple && (path ? <CheckedBox label={t.selected} /> : <SquareIcon size={20} color={colors.dim} />)}
          <span style={{ display: "inline-flex", color: colors.muted }}>{table ? <TableIcon /> : script ? <TerminalIcon /> : <WindowIcon />}</span>
          <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 14, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file}</span>
          <span style={{ fontSize: 12, color: colors.muted, whiteSpace: "nowrap" }}>{table ? t.kindTable : script ? t.kindScript : t.kindProgram}</span>
          {sidecar.multiple
            ? <Button style={{ ...small, minWidth: 96 }} disabled={busy} onClick={() => {
                void action(() => path ? sidecar.removeProgram(path) : sidecar.select(trainer, file));
              }}>{path ? t.removeProgram : t.addProgram}</Button>
            : path ? <InUseBadge label={t.inUse} />
            : <Button style={{ ...small, minWidth: 96 }} disabled={busy} onClick={() => {
                void action(async () => { await sidecar.select(trainer, file); setOpen(undefined); });
              }}>{t.useThis}</Button>}
        </Focusable>;
      })}
    </Focusable>;
  }

  // A finished download is used automatically when the setting is on and
  // nothing is in use yet. A table waits until Cheat Engine is installed too.
  useEffect(() => {
    if (!settings?.auto_select || !sidecar.ready || sidecar.selected.length || busy) return;
    for (const job of jobs) {
      if (job.state !== "done" || !job.path || autoSelected.current.has(job.id)) continue;
      const trainer = trainers.find(item => item.path === job.path);
      if (trainer && needsEngine(trainer)) continue;
      autoSelected.current.add(job.id);
      const programs = trainer ? programsOf(trainer) : [];
      if (trainer && programs.length === 1) void action(() => sidecar.select(trainer, programs[0]));
      return;
    }
  }, [jobs, trainers, sidecar.ready, sidecar.selected.length, settings?.auto_select, engine?.installed]);

  // The table that asked for Cheat Engine is used as soon as it is installed.
  useEffect(() => {
    if (!pendingTable || !engine?.installed || !sidecar.ready || busy) return;
    const trainer = trainers.find(item => item.id === pendingTable);
    setPendingTable(undefined);
    if (trainer) useTable(trainer);
  }, [pendingTable, engine?.installed, sidecar.ready, busy, trainers]);

  async function pickLocalFile() {
    let source: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FILE, "/home", true, true, undefined, ["exe", "bat", "ct", "cetrainer"]);
      source = picked.realpath || picked.path;
    } catch { return; }
    await action(async () => {
      const path = await linkTrainer({ appId, directory: library?.directory || "", source, gameName });
      invalidateLibrary();
      await sidecar.use(path);
      setSearching(false);
    });
  }

  // Deleting needs no confirmation: downloaded files go to the plugin's trash
  // cache and come back on the next download, and a linked file is only forgotten.
  function remove(trainer: LocalTrainer) {
    void action(async () => {
      if (sidecar.isSelected(trainer)) await sidecar.unselect(trainer);
      await deleteTrainer({ appId, directory: library?.directory || "", entryId: trainer.id });
      invalidateLibrary();
    });
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
      const current = sidecar.indexOf(trainer) >= 0;
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
        : current ? multiple ? () => { void action(() => sidecar.unselect(trainer)); } : undefined
        : () => choose(trainer);
      if (open === trainer.id) {
        const count = tableOnly(trainer) ? t.tableCount(programs.length)
          : multiple ? t.programCountMultiple(programs.length) : t.programCount(programs.length);
        return <Row key={trainer.id} tall open icon={icon} title={trainer.name} titleColor={colors.text}
          description={<span style={{ color: needsEngine(trainer) ? colors.warning : colors.accentText }}>{needsEngine(trainer) ? source : count}</span>}
          disabled={!sidecar.ready} onActivate={activate} footer={programList(trainer)}>
          <IconButton label={t.collapse} onClick={() => setOpen(undefined)}><ChevronUpIcon /></IconButton>
        </Row>;
      }
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
      {unsupportedTool && <Button style={{ background: colors.danger, color: "#fff" }}
        onClick={() => Navigation.Navigate(`/app/${appId}/properties/compatibility`)}><AlertCircleIcon size={16} />{t.switchProton}</Button>}
      <Button onClick={() => setSearching(true)}><SearchIcon size={16} />{t.search}</Button>
      {localFileButton}
    </PageHeader>
    {status}

    {count > 0 && <Focusable flow-children="row" aria-label={t.runsWithGame} style={{
      display: "flex", alignItems: "center", gap: 14, padding: "12px 12px 12px 14px", marginBottom: unsupportedTool ? 0 : 16,
      borderRadius: unsupportedTool ? "6px 6px 0 0" : 6, background: "#1b2838",
      border: `1px solid ${unsupportedTool ? "rgba(227,91,91,.6)" : "rgba(124,196,255,.25)"}`,
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
          <span style={{ color: colors.accentText }}>{t.runsWithGame}</span>
          {sidecar.selected.some(isTable) && ` · ${t.viaCheatEngine(engine?.version || "")}`} · {t.switchWindowHint}</div>
      </div>
      <Button disabled={busy} onClick={() => { void action(sidecar.clear); }}
        onOptionsButton={() => { if (!busy) void action(sidecar.clear); }} onOptionsActionDescription={count > 1 ? t.stopAll : t.stopUsing}>
        <StopIcon size={14} />{count > 1 ? t.stopAll : t.stopUsing}<Badge button="Y" /></Button>
    </Focusable>}
    {/* Always at the top on a broken Proton: joined under the in-use card, or on its own. */}
    {unsupportedTool && <div role="alert" style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 16,
      borderRadius: count > 0 ? "0 0 6px 6px" : 6, background: "rgba(227,91,91,.16)",
      border: "1px solid rgba(227,91,91,.6)", ...(count > 0 ? { borderTop: 0 } : {}), color: "#ff9b9b", fontSize: 13,
    }}><AlertCircleIcon size={18} color={colors.danger} /><span>{t.compatWarnShort(unsupportedTool)}</span></div>}

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
