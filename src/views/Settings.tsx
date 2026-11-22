import { Focusable, Navigation, PanelSection, PanelSectionRow, useQuickAccessVisible } from "@decky/ui";
import { type ReactNode, useEffect, useState } from "react";
import { cancelDownload, cleanupTrash } from "../utils/backend";
import { trackDownload, useDownloads } from "../hooks/useDownloads";
import { refreshUpdate, useUpdate } from "../hooks/useUpdate";
import { useRunningTable } from "../hooks/useRunningTable";
import TablePanel from "./TablePanel";
import { errorMessage, menuItemLabel, useTranslations } from "../utils/i18n";
import { ABOUT_ROUTE, SETTINGS_ROUTE } from "../utils/routes";
import { colors, FOCUS_CSS, IconButton, jobStateLabel } from "./shell";
import { NAV_BUTTON, NAV_GLYPH_CSS, NavGlyph } from "./AdaptiveNavGlyph";
import { ChevronRightIcon, CrossIcon, GearIcon, InfoIcon, LibraryIcon, PluginIcon } from "./icons";
import { UpdateDot } from "./update";

/** The Quick Access panel: the way to the settings page, running downloads and how to open a game page. */
export default function Settings() {
  const t = useTranslations();
  const { latest } = useUpdate();
  const visible = useQuickAccessVisible();
  useEffect(() => {
    if (!visible) return;
    void cleanupTrash().catch(() => {});
    void refreshUpdate();
  }, [visible]);
  const [message, setMessage] = useState("");
  const [cancelling, setCancelling] = useState(new Set<string>());
  const active = useDownloads().filter(job => ["queued", "downloading", "extracting"].includes(job.state));
  const running = useRunningTable();
  async function cancel(jobId: string, appId: string) {
    setCancelling(previous => new Set(previous).add(jobId));
    try { trackDownload(await cancelDownload({ appId, jobId })); }
    catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
  }
  // The Quick Access menu is its own window without the page styles, so the
  // link brings its own focus colour (an inline background hides Steam's), and
  // the rows and buttons shared with the pages bring theirs.
  return <PanelSection>
    <style>{".gcm-panel-link.gpfocus { background: #dcdedf !important; color: #0e141b !important; }" + NAV_GLYPH_CSS + FOCUS_CSS}</style>
    <PanelSectionRow><HowTo /></PanelSectionRow>
    {!running && <>
      <PanelLink route={SETTINGS_ROUTE} icon={<GearIcon />}>{t.advancedSettings}</PanelLink>
      <PanelLink route={ABOUT_ROUTE} icon={<InfoIcon />}>{t.aboutPlugin}{latest && <UpdateDot />}</PanelLink>
    </>}
    {running && <TablePanel key={running.table} running={running} />}
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
  </PanelSection>;
}

/** How to reach a game page: Library, a game's options button, then the plugin's menu item. */
function HowTo() {
  return <div style={{
    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 4, background: "rgba(0,0,0,.28)",
    fontSize: 12, color: colors.muted, marginBottom: 14,
  }}>
    <LibraryIcon size={16} />
    <ChevronRightIcon size={10} />
    <NavGlyph button={NAV_BUTTON.MENU} fallback="≡" />
    <ChevronRightIcon size={10} />
    <PluginIcon size={16} color={colors.accentText} />
    <span style={{ minWidth: 0, color: "#dcdedf", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {menuItemLabel()}
    </span>
  </div>;
}

function PanelLink({ route, icon, children }: { route: string; icon: ReactNode; children: ReactNode }) {
  const open = () => {
    Navigation.Navigate(route);
    Navigation.CloseSideMenus();
  };
  return <PanelSectionRow>
    <Focusable className="gcm-panel-link" onActivate={open} onClick={open} style={{
      display: "flex", alignItems: "center", gap: 10, height: 44, boxSizing: "border-box", padding: "0 12px", borderRadius: 4,
      background: "rgba(0,0,0,.28)", color: colors.text, fontSize: 14, cursor: "pointer", marginBottom: 14,
    }}>
      {icon}
      <span style={{ flex: "1 1 auto", display: "flex", alignItems: "center", gap: 8 }}>{children}</span>
      <ChevronRightIcon size={14} color="currentColor" />
    </Focusable>
  </PanelSectionRow>;
}
