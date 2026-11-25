import { isActiveJob, jobPercent } from "../../domain/trainerList";
import { dismissDownload } from "../../hooks/useDownloads";
import type { DownloadJob } from "../../utils/backend";
import { errorMessage, useTranslations } from "../../utils/i18n";
import { Button, colors, IconButton, jobStateLabel, Progress, Row } from "../shell";
import { CrossIcon, DownloadIcon } from "../icons";
import { small } from "./marks";

/** A running or failed download in the trainer list. */
export function JobRow({ job, busy, cancelling, onCancel }: {
  job: DownloadJob; busy: boolean; cancelling: boolean; onCancel: () => void;
}) {
  const t = useTranslations();
  const active = isActiveJob(job);
  const percent = jobPercent(job);
  return <Row tall icon={<DownloadIcon size={20} color={colors.accent} />} title={job.trainer_name} titleColor="#dcdedf"
    description={<span style={{ color: job.state === "error" ? colors.warning : colors.accentText }}>
      {jobStateLabel(t, job, percent)}{job.error && ` · ${errorMessage(job.error, t)}`}</span>}
    footer={active ? <Progress percent={percent} label={t.downloadProgress} indent={48} /> : undefined}>
    {active && <Button ghost style={small} disabled={busy || cancelling} onClick={onCancel}>{cancelling ? t.cancelling : t.cancel}</Button>}
    {job.state === "error" && <IconButton label={t.close} onClick={() => dismissDownload(job.id)}><CrossIcon /></IconButton>}
  </Row>;
}
