import { FileSelectionType, openFilePicker } from "@decky/api";
import { Focusable, Navigation, Spinner } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import data from "../data/trainers.json";
import { isTableFile, PICKER_EXTENSIONS } from "../domain/fileTypes";
import { launchableFiles, tableOnly } from "../domain/trainer";
import { isTable } from "../domain/trainerCommand";
import {
  engineDownload, isActiveJob, jobPercent, jobsWithRows, needsCheatEngine, nextFinishedDownload, orderByName, pageOf, pagesWith, programLabel, rowAction,
} from "../domain/trainerList";
import { invalidateLibrary, useLibrary } from "../hooks/useLibrary";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { useSettings } from "../hooks/useSettings";
import { useTrainerLaunch } from "../hooks/useTrainerLaunch";
import { useGameEnvironment } from "../hooks/useGameEnvironment";
import { environmentHints, type Hint } from "../domain/environment";
import { readLaunchDetails } from "../domain/steam";
import { cancelDownload, deleteTrainer, LINKED_ORIGIN, LocalTrainer, linkTrainer, TableCode, TableTrustState } from "../utils/backend";
import { askTable, confirmTableUse, tableTrust } from "./confirmTable";
import { downloadCheatEngine } from "../hooks/useCheatEngine";
import { bumperStep } from "../utils/bumpers";
import { errorMessage, getLanguage, useTranslations } from "../utils/i18n";
import { Button, Collapsible, colors, IconButton, jobStateLabel, PageHeader, Row, Status } from "./shell";
import {
  AlertCircleIcon, BackIcon, CheckCircleIcon, ChevronUpIcon, CircleIcon, FolderIcon, SearchIcon, SquareIcon, TrashIcon, WarningIcon,
} from "./icons";
import { Alert, InUseCard } from "./modifiers/InUseCard";
import { JobRow } from "./modifiers/JobRow";
import { CheckedBox, InUseBadge, small } from "./modifiers/marks";
import { Pager } from "./modifiers/Pager";
import { EnginePanel, ProgramList } from "./modifiers/ProgramList";
import TrainerSearch from "./TrainerSearch";

const PAGE_SIZE = data.page_size;
// Downloads started before this load (kept by the backend across a frontend
// reload) are never applied, so reopening the page does not switch trainers.
const LOADED_AT = Date.now() / 1000;
const autoSelected = new Set<string>();

/** `unsupportedTool` names the game's compatibility tool when it is known to break trainers. */
export default function Modifiers({ appId, gameName, unsupportedTool = "" }: { appId: string; gameName: string; unsupportedTool?: string }) {
  const t = useTranslations();
  const { library, loading, error } = useLibrary(appId, gameName);
  const downloads = useDownloads();
  const jobs = downloads.filter(job => job.app_ids.includes(appId));
  // Cheat Engine's own download, shown on the tables that wait for it.
  const engineJob = engineDownload(downloads);
  const engineActive = Boolean(engineJob && isActiveJob(engineJob));
  const settingsLoaded = useSettings() !== undefined;
  // A table is confirmed before it starts with the game (see confirmTable).
  const launch = useTrainerLaunch(appId, library?.directory || "", library?.real_directory || "",
    path => confirmTableUse(t, path));
  // What the game runs on: a hint under the card when trainers are chosen (src/domain/environment.ts).
  const [exe, setExe] = useState("");
  useEffect(() => {
    let disposed = false;
    void readLaunchDetails(appId).then(details => { if (!disposed) setExe(details.command.replace(/^"|"$/g, "")); }).catch(() => {});
    return () => { disposed = true; };
  }, [appId]);
  const environment = useGameEnvironment(launch.selected.length ? appId : undefined, [], exe);
  const hints = environmentHints(environment);
  const hintText: Record<Hint, string> = {
    wineMono: t.hintWineMono, dotnetPrefix: t.hintDotnetPrefix, oldWow64: t.hintOldWow64, brokenMono: t.hintBrokenMono,
    untracked: t.hintUntracked,
  };
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<string>();
  // The table to use once Cheat Engine, downloaded for it, is installed.
  const [pendingTable, setPendingTable] = useState<string>();
  const engine = launch.cheatEngine;
  const needsEngine = (trainer: LocalTrainer) => needsCheatEngine(trainer, engine);
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

  // Tables in use are checked again whenever the selection changes or one is confirmed.
  const [untrusted, setUntrusted] = useState<{ path: string; state: TableTrustState; code: TableCode[] | null }[]>([]);
  const [trustChecked, setTrustChecked] = useState(0);
  const selectedTables = launch.selected.filter(isTable).join("|");
  useEffect(() => {
    let disposed = false;
    void Promise.all(launch.selected.filter(isTable).map(async path => ({ path, trust: await tableTrust(path) }))).then(list => {
      if (disposed) return;
      setUntrusted(list.flatMap(({ path, trust }) => trust && trust.state !== "ok" ? [{ path, ...trust }] : []));
    });
    return () => { disposed = true; };
  }, [selectedTables, trustChecked]);

  async function action(run: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await run(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }

  // A trainer with several programs opens in place to list them; only one row is open at a time.
  // A table without Cheat Engine opens in place too, offering to install it.
  function choose(trainer: LocalTrainer) {
    const programs = launchableFiles(trainer);
    if (!programs.length) { setMessage("executableRequired"); return; }
    if (programs.length === 1 && !needsEngine(trainer)) { void action(() => launch.select(trainer, programs[0])); return; }
    setOpen(open === trainer.id ? undefined : trainer.id);
  }

  /** Uses a table once Cheat Engine is there: directly, or by opening the row to pick one. */
  function useTable(trainer: LocalTrainer) {
    const programs = launchableFiles(trainer);
    if (programs.length === 1) void action(() => launch.select(trainer, programs[0]));
    else setOpen(trainer.id);
  }

  /** What an opened row shows: the offer to install Cheat Engine, or the trainer's programs. */
  function opened(trainer: LocalTrainer) {
    if (needsEngine(trainer)) {
      // The row stays open while Cheat Engine downloads, so its progress is in sight.
      return <EnginePanel busy={busy} job={engineJob} cancelling={Boolean(engineJob && cancelling.has(engineJob.id))}
        onDownload={() => { void action(async () => {
          const job = await downloadCheatEngine();
          if (job) trackDownload(job);
          setPendingTable(trainer.id);
        }); }}
        onCancel={() => { if (engineJob) { setPendingTable(undefined); cancel(engineJob.id, ""); } }} />;
    }
    return <ProgramList trainer={trainer} multiple={launch.multiple} busy={busy}
      selectedPath={file => launch.programPath(trainer, file)}
      onUse={file => { void action(async () => { await launch.select(trainer, file); setOpen(undefined); }); }}
      onAdd={file => { void action(() => launch.select(trainer, file)); }}
      onRemove={path => { void action(() => launch.removeProgram(path)); }} />;
  }

  // A finished download is used automatically, replacing
  // the trainer in use (or joining it when several may run). The job waits until
  // the refreshed library lists it, and a table until Cheat Engine is installed
  // too; each job is handled once per plugin load.
  useEffect(() => {
    if (!settingsLoaded || !launch.ready || busy) return;
    const next = nextFinishedDownload(jobs, trainers,
      { loadedAt: LOADED_AT, handled: autoSelected, engineInstalled: Boolean(engine?.installed) });
    if (!next) return;
    autoSelected.add(next.job.id);
    const programs = launchableFiles(next.trainer);
    if (programs.length === 1 && launch.indexOf(next.trainer) < 0) void action(() => launch.select(next.trainer, programs[0]));
    else if (programs.length > 1) setOpen(next.trainer.id);
  }, [jobs, trainers, launch.ready, busy, settingsLoaded, engine?.installed]);

  // The table that asked for Cheat Engine is used as soon as it is installed.
  useEffect(() => {
    if (!pendingTable || !engine?.installed || !launch.ready || busy) return;
    const trainer = trainers.find(item => item.id === pendingTable);
    setPendingTable(undefined);
    setOpen(undefined);
    if (trainer) useTable(trainer);
  }, [pendingTable, engine?.installed, launch.ready, busy, trainers]);

  async function pickLocalFile() {
    let source: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FILE, "/home", true, true, undefined, PICKER_EXTENSIONS);
      source = picked.realpath || picked.path;
    } catch { return; }
    if (isTableFile(source) && !await confirmTableUse(t, source)) return;
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

  /** Cancels a download of this game, or Cheat Engine's, which belongs to no game. */
  function cancel(jobId: string, owner = appId) {
    void action(async () => {
      const result = await cancelDownload({ appId: owner, jobId });
      setCancelling(previous => new Set(previous).add(jobId));
      trackDownload(result);
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
  const ordered = orderByName(trainers, getLanguage());
  const rows = [
    ...ordered.map(trainer => {
      const current = launch.indexOf(trainer) >= 0;
      const linked = trainer.origin === LINKED_ORIGIN;
      const programs = launchableFiles(trainer);
      const tables = programs.filter(isTableFile);
      const icon = trainer.missing ? <WarningIcon size={20} color={colors.warning} />
        : multiple ? current ? <CheckedBox label={t.selected} /> : <SquareIcon size={20} color={colors.dim} />
        : current ? <CheckCircleIcon size={20} color={colors.accent} /> : linked ? <FolderIcon size={20} color={colors.dim} /> : <CircleIcon size={20} color={colors.dim} />;
      const source = linked ? `${t.localSource} · ${trainer.path}`
        : [t.originOnline, trainer.version, trainer.author, tables.length ? t.kindTable : ""].filter(Boolean).join(" · ");
      const description = trainer.missing ? <span style={{ color: colors.warning }}>{t.fileMissingDetail}</span>
        : !programs.length ? t.executableRequired
        : needsEngine(trainer) && engineJob && engineActive
          ? <>{source} · <span style={{ color: colors.accentText }}>{engineJob.trainer_name} · {jobStateLabel(t, engineJob, jobPercent(engineJob))}</span></>
        : needsEngine(trainer) ? <>{source} · <span style={{ color: colors.warning }}>{t.cheatEngineRequired}</span></>
        : source;
      const what = rowAction({
        missing: Boolean(trainer.missing), programs: programs.length, needsEngine: needsEngine(trainer), current,
        tables: tables.length, engineMoved: launch.engineState === "moved", multiple,
      });
      const activate = what === "choose" ? () => choose(trainer)
        : what === "unselect" ? () => { void action(() => launch.unselect(trainer)); } : undefined;
      if (open === trainer.id) {
        const count = tableOnly(trainer) ? t.tableCount(programs.length)
          : multiple ? t.programCountMultiple(programs.length) : t.programCount(programs.length);
        return <Row key={trainer.id} tall open icon={icon} title={trainer.name} titleColor={colors.text}
          description={<span style={{ color: needsEngine(trainer) ? colors.warning : colors.accentText }}>{needsEngine(trainer) ? source : count}</span>}
          disabled={!launch.ready} onActivate={activate} footer={opened(trainer)}>
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
    ...jobsWithRows(jobs).map(job =>
      <JobRow key={job.id} job={job} busy={busy} cancelling={cancelling.has(job.id)} onCancel={() => cancel(job.id)} />),
  ];
  const shown = pageOf(rows, page, PAGE_SIZE);
  // Pages holding a trainer in use are marked, so a selection on another page is never hidden.
  const selectedPages = pagesWith(ordered, trainer => launch.indexOf(trainer) >= 0, PAGE_SIZE);
  showingFullPage.current = shown.full;
  const count = launch.selected.length;
  const separator = getLanguage().startsWith("zh") ? "，" : ", ";
  // Red warnings stay at the top: a broken Proton, a trainer in use whose file
  // is gone, or a table in use whose Cheat Engine is.
  const alerts: Alert[] = [
    unsupportedTool && t.compatWarnShort(unsupportedTool),
    launch.engineState === "missing" && t.tableEngineMissing,
    launch.engineState === "moved" && t.tableEngineMoved,
    trainers.some(trainer => trainer.missing && launch.indexOf(trainer) >= 0) && t.selectedFileMissing,
  ].filter((text): text is string => Boolean(text));
  // Another tool sharing the variable can replace or delete the command it wrote.
  // One program can be taken over; any other command can only be cleared.
  const adopt = launch.adopt;
  if (launch.direct) alerts.push({ text: t.trainerSetElsewhere, action: adopt
    ? { label: t.takeOver, onClick: () => { void action(adopt); } }
    : { label: t.clear, onClick: () => { void action(launch.clear); } } });
  // A table in use whose name was never confirmed.
  for (const { path, code } of untrusted) {
    alerts.push({ text: t.tableUnconfirmed(programLabel(path, trainers)), action: {
      label: t.tableConfirm,
      onClick: () => { void askTable(t, path, code).then(agreed => { if (agreed) setTrustChecked(value => value + 1); }); },
    } });
  }

  // L1/R1 turn the list's pages from anywhere on the page.
  return <Focusable flow-children="column"
    onButtonDown={bumperStep(direction => setPage(Math.min(shown.count - 1, Math.max(0, shown.index + direction))))}>
    <PageHeader title={t.tabModifiers}>
      {unsupportedTool && <Button style={{ background: colors.danger, color: "#fff" }}
        onClick={() => Navigation.Navigate(`/app/${appId}/properties/compatibility`)}><AlertCircleIcon size={16} />{t.switchProton}</Button>}
      <Button onClick={() => setSearching(true)}><SearchIcon size={16} />{t.search}</Button>
      {localFileButton}
    </PageHeader>
    {status}

    <InUseCard count={count} names={launch.selected.map(path => programLabel(path, trainers)).join(separator)}
      hints={hints.map(hint => hintText[hint])}
      viaCheatEngine={launch.selected.some(isTable) ? t.viaCheatEngine(engine?.version || "") : ""}
      alerts={alerts} busy={busy} onClear={() => { void action(launch.clear); }} />

    {/* The pager sits on the count line so the list and its tips fit one screen. */}
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 36, fontSize: 12, color: colors.muted, padding: "0 4px 8px" }}>
      <span>{t.downloadedTitle(trainers.length)}</span>
      {multiple && <span style={{ color: colors.accentText }}>{t.selectedCount(count)}</span>}
      {shown.count > 1 && <Pager page={shown.index} pages={shown.count} marked={selectedPages} onPage={setPage} />}
    </Focusable>
    {loading && !trainers.length && <Spinner style={{ height: 32 }} />}

    <div ref={listRef} style={{ minHeight: shown.count > 1 ? fullHeight : undefined }}>
      {shown.rows}
      <div style={{ borderTop: `1px solid ${colors.line}` }} />
    </div>
    <Collapsible title={t.tipsTitle}>
      <div>{t.tipWindowed}</div>
      <div>{t.tipRuntimes}</div>
      <div>{t.tipReport}</div>
    </Collapsible>
  </Focusable>;
}
