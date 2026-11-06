import { Dropdown, Focusable, PanelSectionRow, TextField, Toggle } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { changeCheatEngine } from "../hooks/useCheatEngine";
import type { RunningTable } from "../hooks/useRunningTable";
import { getTable, getTableState, sendTableCommand, TableEntry, TableState, tableSession } from "../utils/backend";
import { errorMessage, useTranslations } from "../utils/i18n";
import { Button, colors, mono } from "./shell";
import { ChevronDownIcon, ChevronRightIcon, LinkIcon } from "./icons";
import { Badge } from "./Modifiers";

const NO_REPLY_AFTER = 20;
const POLL = 1000;

/** The entries of a table with their groups, as rows: nested groups are flattened under their parents. */
function flatten(entries: TableEntry[], filter: string, collapsed: Set<number>, depth = 0): { entry: TableEntry; depth: number }[] {
  const rows: { entry: TableEntry; depth: number }[] = [];
  const query = filter.trim().toLowerCase();
  for (const entry of entries) {
    const children = flatten(entry.children, filter, collapsed, depth + 1);
    const matches = !query || entry.desc.toLowerCase().includes(query);
    if (entry.group) {
      // A filter shows every matching entry, with its group kept as a heading.
      if (query ? children.length : true) {
        rows.push({ entry, depth });
        if (query || !collapsed.has(entry.id)) rows.push(...children);
      }
    } else if (matches || children.length) {
      rows.push({ entry, depth }, ...children);
    }
  }
  return rows;
}

const countOn = (entries: TableEntry[]): number => entries.reduce((sum, entry) =>
  sum + (!entry.group && entry.active ? 1 : 0) + countOn(entry.children), 0);
const countEntries = (entries: TableEntry[]): number => entries.reduce((sum, entry) =>
  sum + (entry.group ? 0 : 1) + countEntries(entry.children), 0);

/** The Quick Access panel while a game runs with a table: every entry as a switch. */
export default function TablePanel({ running }: { running: RunningTable }) {
  const t = useTranslations();
  const { appId, table } = running;
  const [state, setState] = useState<TableState | null>(null);
  const [preview, setPreview] = useState<TableEntry[]>();
  const [process, setProcess] = useState("");
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState(new Set<number>());
  const [editing, setEditing] = useState<{ id: number; value: string }>();
  // Commands sent but not yet reported back, by entry.
  const [pending, setPending] = useState(new Map<number, number>());
  const sessionTable = useRef("");

  // One session per table: old commands are dropped at the start, the files at the end.
  useEffect(() => {
    sessionTable.current = table;
    void tableSession("start", table, appId).then(result => { if (result.success) setProcess(result.process || ""); }).catch(() => {});
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
  async function attach() {
    try {
      const result = await tableSession("attach", table, appId);
      if (result.success) setProcess(result.process || "");
    } catch { /* shown by the next state */ }
  }

  const attached = Boolean(state && state.pid);
  const waited = Math.floor((now - startedAt) / 1000);
  const entries = state?.entries || preview || [];
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
        <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{state?.table || table.slice(table.lastIndexOf("/") + 1)}</div>
        <div style={{ fontSize: 11, color: tone === "ok" ? colors.muted : color }}>{line}</div>
      </div>
      {action}
    </Focusable>;
  };

  let header: React.ReactNode;
  if (attached) {
    header = card("ok", <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: "#59bf40" }} />
      {t.panelAttached(state!.attached)} · {t.panelEntries(countEntries(entries), countOn(entries))}</span>);
  } else if (state) {
    header = card("warn", t.panelNotAttached,
      <Button style={{ height: 32, padding: "0 12px", fontSize: 12 }} onClick={() => { void attach(); }}>{t.panelAttach}</Button>);
  } else if (waited >= NO_REPLY_AFTER) {
    header = card("bad", t.panelNoReply(waited));
  } else {
    header = card("ok", t.panelStarting);
  }

  const toggle = (entry: TableEntry, value: boolean) => { void send({ id: entry.id, active: value }, entry.id); };
  const write = (entry: TableEntry, value: string) => { setEditing(undefined); void send({ id: entry.id, value }, entry.id); };

  return <div style={{ display: "flex", flexDirection: "column" }}>
    <PanelSectionRow>{header}</PanelSectionRow>
    {!attached && state && <PanelSectionRow><div style={{ fontSize: 11, color: colors.dim, lineHeight: 1.5, marginBottom: 10 }}>
      {process ? t.panelAttachHint(process) : t.panelAttachUnknown}</div></PanelSectionRow>}
    {!state && waited >= NO_REPLY_AFTER && <PanelSectionRow>
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
          if (entry.group) {
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
          const failed = Boolean(entry.error);
          const busy = pending.has(entry.id);
          const script = entry.type === "script" || entry.value === undefined;
          const edit = editing?.id === entry.id;
          return <div key={entry.id} style={{ borderTop: `1px solid ${colors.line}`, background: edit ? colors.surface : undefined, borderRadius: 3 }}>
            <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 10, padding: `9px 4px 9px ${4 + indent}px` }}
              onSecondaryButton={!script && live && !failed ? () => setEditing({ id: entry.id, value: entry.value || "" }) : undefined}
              onSecondaryActionDescription={!script && live && !failed ? t.edit : undefined}>
              <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <div style={{ fontSize: 14, color: failed ? "#a9b1b8" : entry.active ? colors.text : "#dcdedf", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.desc}</div>
                {failed ? <div style={{ fontSize: 11, color: colors.warning }}>{t.panelFailed}</div>
                  : busy ? <div style={{ fontSize: 11, color: colors.accentText }}>{t.panelSwitching}</div>
                  : !script ? <div style={{ fontSize: 11, color: colors.muted }}>{t.panelLockHint}</div> : null}
              </div>
              {!script && entry.options?.length ? <div style={{ minWidth: 96 }}>
                <Dropdown disabled={!live || failed} selectedOption={entry.value} rgOptions={entry.options.map(option => ({ data: option.value, label: option.label }))}
                  onChange={option => write(entry, String(option.data))} /></div>
                : !script ? <Button style={{ height: 30, padding: "0 10px", fontSize: 12, ...mono }} disabled={!live || failed}
                  onClick={() => setEditing(edit ? undefined : { id: entry.id, value: entry.value || "" })}>{entry.value}</Button>
                : null}
              <div style={{ opacity: busy ? .5 : 1 }}>
                <Toggle value={entry.active} disabled={!live || failed || busy} onChange={value => toggle(entry, value)} /></div>
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
