import { Focusable, Navigation, PanelSection, PanelSectionRow, useQuickAccessVisible } from "@decky/ui";
import { useEffect, useState } from "react";
import { cancelDownload, cleanupTrash } from "../utils/backend";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { errorMessage, useTranslations } from "../utils/i18n";
import { SETTINGS_ROUTE } from "../utils/routes";
import { colors, IconButton, jobStateLabel } from "./shell";
import { ChevronRightIcon, CrossIcon, GearIcon } from "./icons";

/** The Quick Access panel: running downloads, how to open a game page, and the way to the settings page. */
export default function Settings() {
  const t = useTranslations();
  const visible = useQuickAccessVisible();
  useEffect(() => {
    if (visible) void cleanupTrash().catch(() => {});
  }, [visible]);
  const [message, setMessage] = useState("");
  const [cancelling, setCancelling] = useState(new Set<string>());
  const active = useDownloads().filter(job => ["queued", "downloading", "extracting"].includes(job.state));
  async function cancel(jobId: string, appId: string) {
    setCancelling(previous => new Set(previous).add(jobId));
    try { trackDownload(await cancelDownload({ appId, jobId })); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
  }
  // The hint and the settings link sit at the bottom of the panel.
  return <PanelSection><div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 110px)" }}>
    {active.length > 0 && <PanelSectionRow>
      <Focusable flow-children="column" aria-label={t.downloadsTitle} style={{
        boxSizing: "border-box", padding: "12px 14px", borderRadius: 4, background: "rgba(0,0,0,.28)", marginBottom: 14,
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: colors.muted }}>
          <span>{t.downloadsTitle}</span><span>{t.activeDownloads(active.length)}</span></div>
        {active.map(job => {
          const percent = job.state === "extracting" ? 100 : job.total ? Math.floor(job.downloaded / job.total * 100) : 0;
          return <div key={job.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: colors.text }}>
              <span style={{ flex: "1 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.trainer_name}</span>
              <span style={{ color: colors.accentText, flex: "0 0 auto" }}>{job.state === "downloading" ? `${percent}%` : jobStateLabel(t, job, percent)}</span>
              <IconButton label={t.cancelDownload} disabled={cancelling.has(job.id)} style={{ width: 28, minWidth: 28, height: 28 }}
                onClick={() => { void cancel(job.id, job.app_ids[0] || ""); }}><CrossIcon size={14} width={2.4} /></IconButton>
            </Focusable>
            <div role="progressbar" aria-label={job.trainer_name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
              style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
              <div style={{ width: `${percent}%`, height: "100%", background: colors.accent }} /></div>
          </div>;
        })}
      </Focusable>
    </PanelSectionRow>}
    {message && <PanelSectionRow><div role="status" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{errorMessage(message, t)}</div></PanelSectionRow>}
    <div style={{ flex: "1 1 auto" }} />
    <PanelSectionRow><div style={{ fontSize: 11, color: colors.dim, lineHeight: 1.5, marginBottom: 14 }}>{t.openHint}</div></PanelSectionRow>
    <PanelSectionRow>
      <Focusable className="gcm-row" onActivate={openSettings} style={{
        display: "flex", alignItems: "center", gap: 10, height: 44, boxSizing: "border-box", padding: "0 12px", borderRadius: 4,
        background: "rgba(0,0,0,.28)", color: colors.text, fontSize: 14, cursor: "pointer",
      }}>
        <GearIcon />
        <span style={{ flex: "1 1 auto" }}>{t.advancedSettings}</span>
        <ChevronRightIcon size={14} color={colors.muted} />
      </Focusable>
    </PanelSectionRow>
  </div></PanelSection>;
}

function openSettings() {
  Navigation.Navigate(SETTINGS_ROUTE);
  Navigation.CloseSideMenus();
}
