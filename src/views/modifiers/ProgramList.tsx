import { Focusable } from "@decky/ui";
import { isScriptFile, isTableFile } from "../../domain/fileTypes";
import { launchableFiles } from "../../domain/trainer";
import { engineOffer, jobPercent } from "../../domain/trainerList";
import type { DownloadJob, LocalTrainer } from "../../utils/backend";
import { errorMessage, useTranslations } from "../../utils/i18n";
import { Badge, Button, colors, jobStateLabel, Progress } from "../shell";
import { DownloadIcon, SquareIcon, TableIcon, TerminalIcon, WindowIcon } from "../icons";
import { CheckedBox, InUseBadge, small } from "./marks";

/**
 * The in-place offer to install Cheat Engine for an opened table. While Cheat
 * Engine downloads, the offer gives way to the download's progress; a failed
 * download says so and can be started again.
 */
export function EnginePanel({ busy, job, cancelling, onDownload, onCancel }: {
  busy: boolean; job?: DownloadJob; cancelling: boolean; onDownload: () => void; onCancel: () => void;
}) {
  const t = useTranslations();
  const state = engineOffer(job);
  const active = state === "downloading", failed = state === "failed";
  const percent = jobPercent(job);
  const text = job && active ? `${job.trainer_name} · ${jobStateLabel(t, job, percent)}`
    : job && failed ? `${job.trainer_name} · ${t.failed}${job.error ? ` · ${errorMessage(job.error, t)}` : ""}`
    : t.ceNeedFirst;
  return <div style={{ margin: "0 14px 12px 48px", borderRadius: 4, background: "rgba(255,255,255,.1)" }}>
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 10px 10px 12px" }}>
      <span style={{ display: "inline-flex", color: active ? colors.accent : colors.warning }}><DownloadIcon size={18} width={2.2} /></span>
      <span style={{
        flex: "1 1 auto", minWidth: 0, fontSize: 14, color: active ? colors.accentText : failed ? colors.warning : colors.text,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{text}</span>
      {active
        ? <Button ghost style={{ ...small, minWidth: 96 }} disabled={busy || cancelling} onClick={onCancel}>{cancelling ? t.cancelling : t.cancel}</Button>
        : <Button style={{ ...small, minWidth: 96, background: "#dcdedf", color: "#0e141b" }} disabled={busy} onClick={onDownload}
            onSecondaryButton={onDownload} onSecondaryActionDescription={t.ceDownloadUse}><Badge button="X" dark />{t.ceDownloadUse}</Button>}
    </Focusable>
    {active && <Progress percent={percent} label={t.downloadProgress} indent={12} />}
  </div>;
}

/** The programs of an opened trainer, each with its own action. */
export function ProgramList({ trainer, multiple, busy, selectedPath, onUse, onAdd, onRemove }: {
  trainer: LocalTrainer; multiple: boolean; busy: boolean;
  /** The selected path of a program of this trainer, if it is selected. */
  selectedPath: (file: string) => string | undefined;
  /** Makes the program the one in use. */
  onUse: (file: string) => void;
  /** Adds the program to those in use, when several may run. */
  onAdd: (file: string) => void;
  onRemove: (path: string) => void;
}) {
  const t = useTranslations();
  return <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 14px 12px 48px" }}>
    {launchableFiles(trainer).map(file => {
      const path = selectedPath(file);
      const script = isScriptFile(file);
      const table = isTableFile(file);
      return <Focusable key={file} flow-children="row" style={{
        display: "flex", alignItems: "center", gap: 12, padding: "8px 10px 8px 12px", borderRadius: 4,
        background: path && multiple ? "rgba(26,159,255,.1)" : undefined,
      }}>
        {multiple && (path ? <CheckedBox label={t.selected} /> : <SquareIcon size={20} color={colors.dim} />)}
        <span style={{ display: "inline-flex", color: colors.muted }}>{table ? <TableIcon /> : script ? <TerminalIcon /> : <WindowIcon />}</span>
        <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 14, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file}</span>
        <span style={{ fontSize: 12, color: colors.muted, whiteSpace: "nowrap" }}>{table ? t.kindTable : script ? t.kindScript : t.kindProgram}</span>
        {multiple
          ? <Button style={{ ...small, minWidth: 96 }} disabled={busy} onClick={() => { if (path) onRemove(path); else onAdd(file); }}>
              {path ? t.removeProgram : t.addProgram}</Button>
          : path ? <InUseBadge label={t.inUse} />
          : <Button style={{ ...small, minWidth: 96 }} disabled={busy} onClick={() => onUse(file)}>{t.useThis}</Button>}
      </Focusable>;
    })}
  </Focusable>;
}
