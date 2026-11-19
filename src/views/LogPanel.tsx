import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import { Focusable } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clearLog, exportLog, getLog, getLogExportDirectory, LogLine } from "../utils/backend";
import { PLUGIN_NAME, useTranslations } from "../utils/i18n";
import { colors, IconButton, mono } from "./shell";
import { DownloadIcon, TrashIcon } from "./icons";

const LOG_LINES = 200;

const levelColor = (level: string) => level === "ERROR" || level === "CRITICAL" ? colors.danger
  : level === "WARNING" ? colors.warning : undefined;

/** The plugin's recent log lines with export and clear, refreshed while it is shown. */
export default function LogPanel({ height }: { height: string }) {
  const t = useTranslations();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const loadLog = () => getLog(LOG_LINES).then(setLines);
  useEffect(() => {
    void loadLog().catch(() => {});
    // The log keeps growing while the page is open.
    const timer = window.setInterval(() => { void loadLog().catch(() => {}); }, 3000);
    return () => window.clearInterval(timer);
  }, []);
  // Keep the newest lines in view while the log grows, unless the user scrolled up.
  const logBox = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const box = logBox.current;
    if (box && atBottom.current) box.scrollTop = box.scrollHeight;
  }, [lines]);

  const toastError = (error: unknown) => toaster.toast({
    title: PLUGIN_NAME, body: error instanceof Error && error.message ? error.message : t.unknownError, critical: true,
  });
  async function exportFile() {
    let folder: string;
    try {
      const start = await getLogExportDirectory().catch(() => "/home");
      const picked = await openFilePicker(FileSelectionType.FOLDER, start, false, true);
      folder = picked.realpath || picked.path;
    } catch { return; }
    try {
      toaster.toast({ title: PLUGIN_NAME, body: t.exportedTo(await exportLog(folder)) });
    } catch (error) {
      toastError(error);
    }
  }
  async function clear() {
    setBusy(true);
    try { await clearLog(); setLines([]); }
    catch (error) { toastError(error); }
    finally { setBusy(false); }
  }

  return <section aria-label={t.log} style={{
    height, boxSizing: "border-box", padding: "12px 14px", borderRadius: 4, background: "rgba(0,0,0,.4)",
    display: "flex", flexDirection: "column", gap: 8,
  }}>
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: colors.muted }}>
      <span>{t.recentLines(LOG_LINES)}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <IconButton label={t.exportLog} style={logButton} disabled={!lines.length}
          onClick={() => { void exportFile(); }}><DownloadIcon size={16} /></IconButton>
        <IconButton label={t.clear} style={logButton} disabled={busy || !lines.length}
          onClick={() => { void clear(); }}><TrashIcon size={16} /></IconButton>
      </div>
    </Focusable>
    <div ref={logBox} onScroll={() => {
      const box = logBox.current;
      if (box) atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    }} style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", fontSize: 12, lineHeight: 1.7, ...mono, whiteSpace: "pre-wrap", color: "#a9b1b8" }}>
      {lines.length ? lines.map((line, index) => <div key={index}>
        <span style={{ color: colors.dim }}>{line.time}</span>{" "}
        <span style={{ color: levelColor(line.level) }}>
          {line.level === "WARNING" ? "WARN" : line.level} {line.message}</span>
      </div>) : <span style={{ color: colors.dim }}>{t.logEmpty}</span>}
    </div>
  </section>;
}

const logButton = { width: 32, minWidth: 32, height: 30, background: colors.button, color: colors.text } as const;
