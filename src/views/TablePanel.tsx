import { Dropdown, Focusable, ModalRoot, PanelSectionRow, showModal, TextField, Toggle } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import timing from "../data/timing.json";
import { fileName } from "../domain/paths";
import {
  bridgeStatus, countEntries, countOn, displayOnlyLabels as labelsOf, DropdownCache, dropdownOptions, EntryFailure, entryFailure, flatten, isGroup, isScriptEntry,
  withDisplayOnlyEntries,
} from "../domain/table";
import { changeCheatEngine } from "../hooks/useCheatEngine";
import type { RunningTable } from "../hooks/useRunningTable";
import {
  attachTable, EntryScan, GameProcess, scanTable, getGameProcesses, getTable, getTableState, sendTableCommand, TableEntry, TableState, tableSession,
} from "../utils/backend";
import { errorMessage, useTranslations } from "../utils/i18n";
import type { Translations } from "../utils/locales";
import { askTable, tableTrust } from "./confirmTable";
import { Badge, Button, colors, mono } from "./shell";
import { ChevronDownIcon, ChevronRightIcon, LinkIcon } from "./icons";

const NO_REPLY_AFTER = timing.table_no_reply_after_seconds;
const POLL = timing.table_state_poll_ms;

/** The Quick Access panel while a game runs with a table. */
/** `collectorAtRisk`: the game runs on Wine Mono, so entries that use Cheat Engine's .NET data collector may fail. */
export default function TablePanel({ running, collectorAtRisk = false }: { running: RunningTable; collectorAtRisk?: boolean }) {
  const t = useTranslations();
  const { appId, table, programs } = running;
  const [state, setState] = useState<TableState | null>(null);
  const [preview, setPreview] = useState<TableEntry[]>();
  const [processes, setProcesses] = useState<GameProcess[]>([]);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState(new Set<number>());
  const [editing, setEditing] = useState<{ id: number; value: string }>();
  // Commands sent but not yet reported back, by entry.
  const [pending, setPending] = useState(new Map<number, number>());
  const sessionTable = useRef("");
  const dropdowns = useRef<DropdownCache>(new Map());

  // A table never confirmed is pointed out: Cheat Engine has opened it
  // already, so the warning is all that can be done.
  const [trust, setTrust] = useState<Awaited<ReturnType<typeof tableTrust>>>();
  const [trustChecked, setTrustChecked] = useState(0);
  useEffect(() => {
    let disposed = false;
    void tableTrust(table).then(result => { if (!disposed) setTrust(result); });
    return () => { disposed = true; };
  }, [table, trustChecked]);

  // The table's byte patterns are looked for in the game's files once, in the background.
  const [scan, setScan] = useState<Record<string, EntryScan>>({});
  // On ARM, entries of an IL2CPP game that need Cheat Engine's injected data collector are pointed out:
  // that injection failed under FEX (py_modules/table_scan.py).
  const [armRisk, setArmRisk] = useState(new Set<string>());
  const [collector, setCollector] = useState(new Set<string>());
  const [arm, setArm] = useState(false);
  useEffect(() => {
    let disposed = false;
    void scanTable(table, appId).then(result => {
      if (disposed || !result.success) return;
      setScan(result.entries || {});
      setArm(Boolean(result.arm));
      setArmRisk(new Set(result.arm ? result.injection || [] : []));
      setCollector(new Set(result.collector || []));
    }).catch(() => {});
    return () => { disposed = true; };
  }, [table, appId]);

  // One session per table: old commands are dropped at the start, the files at the end.
  useEffect(() => {
    sessionTable.current = table;
    void tableSession("start", table, appId).catch(() => {});
    void getTable(table).then(result => { if (result.success && result.entries) setPreview(result.entries); }).catch(() => {});
    return () => { void tableSession("stop", table, appId).catch(() => {}); };
  }, [table, appId]);

  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const result = await getTableState(table);
        if (disposed) return;
        setNow(Date.now());
        if (result.success && result.state) {
          setState(result.state);
          setPending(previous => {
            const next = new Map([...previous].filter(([, n]) => n > result.state!.last_n));
            return next.size === previous.size ? previous : next;
          });
        }
      } catch { /* The next poll tries again. */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, POLL);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [table]);

  async function send(command: Record<string, unknown>, id?: number) {
    setMessage("");
    try {
      const result = await sendTableCommand(table, command);
      if (!result.success) throw new Error(result.error);
      if (id !== undefined && result.n !== undefined) setPending(previous => new Map(previous).set(id, result.n!));
    } catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
  }
  // Cheat Engine's own process list, read again when the dropdown opens: the
  // game's processes change while it runs.
  async function loadProcesses() {
    try {
      const result = await getGameProcesses(appId, programs, table);
      if (result.success) setProcesses(result.processes || []);
    } catch { /* the dropdown keeps the last list */ }
  }
  const answering = Boolean(state);
  useEffect(() => { if (answering) void loadProcesses(); }, [appId, table, answering]);
  async function attach(pid: number) {
    setMessage("");
    try {
      const name = processes.find(item => item.pid === pid)?.name || "";
      const result = await attachTable(table, pid, name, appId);
      if (!result.success) throw new Error(result.error);
    } catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
  }
  const processLabel = (item: GameProcess) => [
    processes.filter(other => other.name === item.name).length > 1 ? `${item.name} #${item.pid}` : item.name,
    item.window ? t.processWindow : "", item.launched ? t.processLaunched : "", item.memory ? `${item.memory} MB` : "",
  ].filter(Boolean).join(" · ");

  const attached = Boolean(state && state.pid);
  const waited = Math.floor((now - startedAt) / 1000);
  const displayOnlyLabels = useMemo(() => labelsOf(preview ?? []), [preview]);
  const entries = state?.entries ? withDisplayOnlyEntries(state.entries, displayOnlyLabels) : preview ?? [];
  const rows = flatten(entries, filter, collapsed);
  const live = attached;

  const card = (tone: "ok" | "warn" | "bad", line: React.ReactNode, action?: React.ReactNode) => {
    const border = tone === "ok" ? "rgba(124,196,255,.25)" : tone === "warn" ? "rgba(245,185,66,.45)" : "rgba(227,91,91,.5)";
    const color = tone === "ok" ? colors.accentText : tone === "warn" ? colors.warning : colors.danger;
    return <Focusable flow-children="row" style={{
      boxSizing: "border-box", padding: "10px 12px", borderRadius: 6, background: "#1b2838", border: `1px solid ${border}`,
      display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
    }}>
      <span aria-hidden style={{ display: "inline-flex", width: 32, height: 32, flex: "0 0 32px", borderRadius: 8, background: `${color}29`, color, alignItems: "center", justifyContent: "center" }}>
        <LinkIcon size={16} /></span>
      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fileName(table)}</div>
        <div style={{ fontSize: 11, color: tone === "ok" ? colors.muted : color }}>{line}</div>
      </div>
      {action}
    </Focusable>;
  };

  const bridge = bridgeStatus(state, waited, NO_REPLY_AFTER);
  let header: React.ReactNode;
  if (bridge === "attached") {
    header = card("ok", <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: "#59bf40" }} />
      {t.panelAttached(state!.attached)} · {t.panelEntries(countEntries(entries), countOn(entries))}</span>);
  } else if (bridge === "notAttached") {
    header = card("warn", t.panelNotAttached);
  } else if (bridge === "noReply") {
    header = card("bad", t.panelNoReply(waited));
  } else {
    header = card("ok", t.panelStarting);
  }

  const failureText: Record<EntryFailure, string> = {
    detached: t.panelFailedDetached, exited: t.panelFailedExited, rejected: t.panelFailed,
    error: t.panelFailedError, value: t.panelFailedValue,
  };
  // Cheat Engine's own reason, when it gave one; a gone process still says so first.
  const reasonText: Record<string, string> = {
    afAOBNotFound: t.reasonAobNotFound, afAOBModuleNotFound: t.reasonModuleNotFound, afAssertFailure: t.reasonAssert,
    afSyntaxError: t.reasonSyntax, afSyntaxErrorInLua: t.reasonSyntax, afStructureDefinitionError: t.reasonSyntax,
    afAllocateFailure: t.reasonAllocate, afInaccessible: t.reasonInaccessible, afDLLInjectionFailure: t.reasonInjection,
    afIncludeNotFound: t.reasonInclude,
  };
  const failureLabel = (entry: TableEntry, failure: EntryFailure) =>
    failure === "detached" || failure === "exited" ? failureText[failure]
      : (entry.reason && reasonText[entry.reason]) || failureText[failure];
  const toggle = (entry: TableEntry, value: boolean) => { void send({ id: entry.id, active: value }, entry.id); };
  const write = (entry: TableEntry, value: string) => { setEditing(undefined); void send({ id: entry.id, value }, entry.id); };

  return <div style={{ display: "flex", flexDirection: "column" }}>
    <PanelSectionRow>{header}</PanelSectionRow>
    {trust && trust.state !== "ok" && <PanelSectionRow>
      <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 12, color: colors.warning }}>
        <span style={{ flex: "1 1 auto", minWidth: 0 }}>{t.tableUnconfirmed(fileName(table))}</span>
        {/* The dialog opens in the menu's own window, in front of the running game. */}
        <Button style={{ height: 30, padding: "0 12px", fontSize: 12 }} onClick={event => {
          void askTable(t, table, trust.code, event.currentTarget ?? window)
            .then(agreed => { if (agreed) setTrustChecked(value => value + 1); });
        }}>{t.tableConfirm}</Button>
      </Focusable></PanelSectionRow>}
    {state?.script_error && <PanelSectionRow>
      {/* Cheat Engine shows the error in its Lua window, which the game hides. */}
      <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 12 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ color: colors.danger }}>{t.panelScriptError}</div>
          <div style={{ color: colors.muted, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {state.script_error.text.split("\n")[0]}</div>
        </div>
        <Button style={{ height: 30, padding: "0 12px", fontSize: 12 }} onClick={event => {
          const error = state.script_error!;
          showScriptError(t, error.full || error.text, event.currentTarget ?? window);
        }}>{t.panelScriptErrorShow}</Button>
      </Focusable></PanelSectionRow>}
    {state?.injection_error && <PanelSectionRow>
      {/* Printed in Cheat Engine's hidden Lua window without a traceback. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10, fontSize: 12 }}>
        <div style={{ color: colors.danger }}>{arm ? `${t.panelInjectionFailed} · ${t.panelArmMaybe}` : t.panelInjectionFailed}</div>
        <div style={{ color: colors.muted, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {state.injection_error.text}</div>
      </div></PanelSectionRow>}
    {state && <PanelSectionRow><div style={{ marginBottom: 10 }}>
      <Dropdown menuLabel={t.panelProcess} strDefaultLabel={t.panelProcess}
        selectedOption={processes.some(item => item.pid === state.pid) ? state.pid : undefined}
        rgOptions={processes.map(item => ({ data: item.pid, label: processLabel(item) }))}
        onMenuWillOpen={showMenu => { void loadProcesses().then(showMenu); }}
        onChange={option => { void attach(Number(option.data)); }} /></div></PanelSectionRow>}
    {bridge === "noReply" && <PanelSectionRow>
      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "#a9b1b8", lineHeight: 1.6 }}>{t.panelNoReplyHint}</div>
        <Button style={{ height: 36, fontSize: 13 }} onClick={() => { void changeCheatEngine("bridge").catch(() => {}); }}>{t.panelReinstallBridge}</Button>
      </Focusable>
    </PanelSectionRow>}
    {message && <PanelSectionRow><div role="status" style={{ fontSize: 12, color: "#ff9b9b", overflowWrap: "anywhere" }}>{errorMessage(message, t)}</div></PanelSectionRow>}

    {entries.length > 0 && <PanelSectionRow>
      <Focusable flow-children="row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
        onSecondaryButton={() => { if (live) void send({ all: false }); }} onSecondaryActionDescription={t.panelAllOff}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <TextField aria-label={t.panelFind} placeholder={t.panelFind} value={filter} onChange={event => setFilter(event.target.value)} /></div>
        <Button style={{ height: 36, padding: "0 12px", fontSize: 12 }} disabled={!live} onClick={() => { void send({ all: false }); }}><Badge button="X" />{t.panelAllOff}</Button>
      </Focusable>
    </PanelSectionRow>}

    <PanelSectionRow>
      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", opacity: live ? 1 : .45 }}
        onSecondaryButton={() => { if (live) void send({ all: false }); }} onSecondaryActionDescription={t.panelAllOff}>
        {rows.map(({ entry, depth }) => {
          const indent = Math.min(depth, 3) * 10;
          if (isGroup(entry)) {
            const open = filter.trim() ? true : !collapsed.has(entry.id);
            const on = countOn(entry.children);
            return <Focusable key={entry.id} className="gcm-row" onActivate={() => setCollapsed(previous => {
              const next = new Set(previous);
              if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
              return next;
            })} onOKActionDescription={open ? t.collapse : t.expand} style={{
              display: "flex", alignItems: "center", gap: 8, height: 36, padding: `0 4px 0 ${4 + indent}px`, color: colors.muted, fontSize: 12,
              borderTop: `1px solid ${colors.line}`,
            }}>
              {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              <span style={{ flex: "1 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.desc} · {countEntries(entry.children)}</span>
              {on > 0 && <span style={{ color: colors.accentText }}>{t.panelOnCount(on)}</span>}
            </Focusable>;
          }
          if (entry.displayOnly) {
            return <div key={entry.id} style={{
              borderTop: `1px solid ${colors.line}`, padding: `9px 4px 9px ${4 + indent}px`,
              fontSize: 14, color: colors.muted, overflowWrap: "anywhere",
            }}>{entry.desc}</div>;
          }
          // A failed entry can be tried again: the reason goes once it works.
          const failure = entryFailure(entry.error);
          const failed = Boolean(failure);
          const busy = pending.has(entry.id);
          const script = isScriptEntry(entry);
          const edit = editing?.id === entry.id;
          return <div key={entry.id} style={{ borderTop: `1px solid ${colors.line}`, background: edit ? colors.surface : undefined, borderRadius: 3 }}>
            <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: `9px 4px 9px ${4 + indent}px` }}
              onSecondaryButton={!script && live ? () => setEditing({ id: entry.id, value: entry.value || "" }) : undefined}
              onSecondaryActionDescription={!script && live ? t.edit : undefined}>
              <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <div style={{ fontSize: 14, color: failed ? "#a9b1b8" : entry.active ? colors.text : "#dcdedf", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.desc}</div>
                {failure ? <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <div style={{ fontSize: 11, color: colors.warning }}>
                    {failureLabel(entry, failure)}{armRisk.has(String(entry.id)) ? ` · ${t.panelArmMaybe}`
                      : collectorAtRisk && collector.has(String(entry.id)) ? ` · ${t.panelNeedsDotnet}` : ""}</div>
                  {entry.reason_text && <div style={{ fontSize: 10, color: colors.muted, overflowWrap: "anywhere",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {entry.reason_text}</div>}</div>
                  : busy ? <div style={{ fontSize: 11, color: colors.accentText }}>{t.panelSwitching}</div>
                  : scan[String(entry.id)] === "missing" ? <div style={{ fontSize: 11, color: colors.warning }}>{t.panelScanMissing}</div>
                  : armRisk.has(String(entry.id)) ? <div style={{ fontSize: 11, color: colors.warning }}>{t.panelArmMaybe}</div>
                  : collectorAtRisk && collector.has(String(entry.id)) ? <div style={{ fontSize: 11, color: colors.warning }}>{t.panelNeedsDotnet}</div>
                  : !script ? <div style={{ fontSize: 11, color: colors.muted }}>{t.panelLockHint}</div> : null}
              </div>
              {!script && entry.options?.length ? <div style={{ minWidth: 96 }}>
                <Dropdown disabled={!live} selectedOption={entry.value} rgOptions={dropdownOptions(dropdowns.current, entry)}
                  onChange={option => write(entry, String(option.data))} /></div>
                : !script ? <Button style={{ height: 30, padding: "0 10px", fontSize: 12, ...mono }} disabled={!live}
                  onClick={() => setEditing(edit ? undefined : { id: entry.id, value: entry.value || "" })}>{entry.value}</Button>
                : null}
              <div style={{ opacity: busy ? .5 : 1 }}>
                <Toggle value={entry.active} disabled={!live || busy} onChange={value => toggle(entry, value)} /></div>
            </Focusable>
            {edit && <Focusable flow-children="row" style={{ display: "flex", gap: 6, alignItems: "center", padding: "0 4px 9px 4px" }}
              onCancelButton={() => setEditing(undefined)} onCancelActionDescription={t.cancel}
              onSecondaryButton={() => write(entry, editing!.value)} onSecondaryActionDescription={t.panelWrite}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <TextField aria-label={entry.desc} value={editing!.value} style={mono} onChange={event => setEditing({ id: entry.id, value: event.target.value })} /></div>
              <Button style={{ height: 36, padding: "0 14px", fontSize: 13, background: "#dcdedf", color: "#0e141b" }} onClick={() => write(entry, editing!.value)}>
                <Badge button="X" dark />{t.panelWrite}</Button>
              <div style={{ flexBasis: "100%", fontSize: 11, color: colors.dim }}>{t.panelValueHint(entry.type, entry.value || "")}</div>
            </Focusable>}
          </div>;
        })}
        {rows.length > 0 && <div style={{ borderTop: `1px solid ${colors.line}` }} />}
      </Focusable>
    </PanelSectionRow>
    {!live && entries.length > 0 && <PanelSectionRow><div style={{ fontSize: 11, color: colors.dim, lineHeight: 1.5, marginTop: 8 }}>{t.panelWaitHint}</div></PanelSectionRow>}
  </div>;
}

/**
 * The whole error, in a dialog opened in the window of the element that asked
 * for it: from the Quick Access menu that is the menu's own window, in front
 * of the running game.
 */
function showScriptError(t: Translations, text: string, opener: EventTarget) {
  showModal(<ScriptErrorModal t={t} text={text} />, opener, { strTitle: t.panelScriptError });
}

function ScriptErrorModal({ t, text, closeModal }: { t: Translations; text: string; closeModal?: () => void }) {
  return <ModalRoot closeModal={closeModal}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: colors.danger }}>{t.panelScriptError}</div>
      <div style={{ ...mono, fontSize: 12, lineHeight: 1.5, color: "#dcdedf", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</div>
      <Button primary style={{ alignSelf: "flex-end", padding: "0 22px" }} onClick={closeModal}>{t.close}</Button>
    </div>
  </ModalRoot>;
}
