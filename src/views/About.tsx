import { Focusable, ModalRoot, showModal } from "@decky/ui";
import qrcode from "qrcode-generator";
import { FaUnlock } from "react-icons/fa";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { AUTHOR_AVATAR } from "../data/avatar";
import { publishOptions } from "../hooks/useCustomOptions";
import { useLaunchOptions } from "../hooks/useLaunchOptions";
import { publishSettings } from "../hooks/useSettings";
import { REPOSITORY_URL, useUpdate } from "../hooks/useUpdate";
import { getSystemName, resetSettings } from "../utils/backend";
import { errorMessage, getLanguage, useTranslations } from "../utils/i18n";
import { Button, colors, IconButton, PageHeader, Row, SectionTitle } from "./shell";
import { ChevronRightIcon } from "./icons";
import { openExternal, VersionBadge } from "./update";

const AUTHOR = "ProSS及时行乐";
const GITHUB_URL = `${REPOSITORY_URL}#deckygcm`;
const BILIBILI_URL = "https://space.bilibili.com/23706122";
const GCM_URL = "https://gamezonelabs.com/products/gcm";
const CREAMDECK_URL = "https://github.com/Qiming-Liu/CreamDeck#creamdeck";

/** A new GitHub issue with the details a report needs already filled in. */
export function feedbackUrl(details: { version: string; system: string; compatTool: string; appId: string }) {
  const body = [
    `**Version:** ${details.version || "?"}`,
    `**System:** ${details.system || "?"}`,
    `**Proton:** ${details.compatTool || "?"}`,
    `**AppID:** ${details.appId}`,
    "",
    "**What happened:**",
    "",
    "",
    "**Log:** attach Advanced settings > Log > Export",
  ].join("\n");
  return `${REPOSITORY_URL}/issues/new?body=${encodeURIComponent(body)}`;
}

/** The QR code as one SVG path, drawn locally. */
function QrCode({ text, label, size = 132 }: { text: string; label: string; size?: number }) {
  const { count, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(text, "Byte");
    code.make();
    const count = code.getModuleCount();
    let path = "";
    for (let row = 0; row < count; row++)
      for (let column = 0; column < count; column++)
        if (code.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
    return { count, path };
  }, [text]);
  return <div role="img" aria-label={label} style={{ flex: "0 0 auto", padding: 8, borderRadius: 4, background: "#fff", lineHeight: 0 }}>
    <svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges" aria-hidden="true">
      <path d={path} fill="#0e141b" /></svg>
  </div>;
}

const GithubIcon = () => <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
  <path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1-.3-3.3 1.3a11.4 11.4 0 00-6 0C7 2.8 6 3.1 6 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004.6 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" /></svg>;
const BilibiliIcon = () => <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
  <rect x="3" y="6" width="18" height="14" rx="3" /><path d="M8 3l3 3M16 3l-3 3M9 12v2M15 12v2" /></svg>;

function LinkRow({ title, description, note, icon, url }: { title: string; description?: string; note?: string; icon?: ReactNode; url: string }) {
  return <Row icon={icon} title={title} description={description} onActivate={() => openExternal(url)} aside={<>
    {note && <span style={{ flex: "0 0 auto", fontSize: 12, color: colors.muted }}>{note}</span>}
    <ChevronRightIcon size={14} color={colors.muted} />
  </>} />;
}

function FeedbackModal({ url, closeModal }: { url: string; closeModal?: () => void }) {
  const t = useTranslations();
  return <ModalRoot closeModal={closeModal} className="gcm-font gcm-dialog">
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>{t.feedbackIssue}</div>
      <QrCode text={url} label={t.feedbackQr} size={220} />
      <div style={{ fontSize: 13, color: colors.muted }}>{t.feedbackScan} · {t.feedbackHint}</div>
      <Focusable flow-children="row" style={{ display: "flex", gap: 8, paddingTop: 4 }}>
        <Button onClick={() => { openExternal(url); closeModal?.(); }}>{t.openInBrowser}</Button>
        <Button primary style={{ padding: "0 22px" }} onClick={closeModal}>{t.close}</Button>
      </Focusable>
    </div>
  </ModalRoot>;
}

export default function About({ appId, compatTool }: { appId: string; compatTool: string }) {
  const t = useTranslations();
  const { current, latest } = useUpdate();
  const [system, setSystem] = useState("");
  useEffect(() => { void getSystemName().then(name => setSystem(name || "")).catch(() => {}); }, []);
  const feedback = feedbackUrl({ version: current, system, compatTool, appId });
  const launch = useLaunchOptions(appId);
  // Reset asks for a second press instead of a dialog.
  const [reset, setReset] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [resetError, setResetError] = useState("");
  const runReset = async () => {
    if (reset !== "confirm") { setReset("confirm"); setResetError(""); return; }
    setReset("busy");
    try {
      // Launch options first, while the launcher check still uses the current settings.
      if (launch.blocked) setResetError(t.unsupportedLauncher);
      else await launch.update(() => "", "Clear the launch options (reset)");
      const defaults = await resetSettings();
      publishSettings(defaults.settings);
      publishOptions(defaults.options);
      setReset("done");
    } catch (error) {
      setResetError(errorMessage(error, t));
      setReset("idle");
    }
  };

  const linkButton = { background: colors.button, color: colors.text };
  return <div style={{ padding: "0 8px 16px 0" }}>
    <PageHeader title={t.tabAbout} gap={12} />
    {/* One row of columns, so right from the author links reaches the right column. */}
    <Focusable flow-children="row" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Focusable flow-children="row" aria-label={AUTHOR} style={{ padding: "10px 12px", borderRadius: 4, background: "rgba(0,0,0,.28)", display: "flex", alignItems: "center", gap: 12 }}>
          <img src={AUTHOR_AVATAR} alt="" width={44} height={44} style={{ flex: "0 0 44px", borderRadius: 22, objectFit: "cover", background: colors.button }} />
          <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: 18, fontWeight: 700, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{AUTHOR}</div>
          {getLanguage() !== "en" && <IconButton label={t.bilibili} style={linkButton} onClick={() => openExternal(BILIBILI_URL)}><BilibiliIcon /></IconButton>}
          <IconButton label="GitHub" style={linkButton} onClick={() => openExternal(GITHUB_URL)}><GithubIcon /></IconButton>
        </Focusable>

        <SectionTitle>{t.aboutPlugin}</SectionTitle>
        <Row title={t.aboutVersion}><VersionBadge current={current} latest={latest} /></Row>
        <Row title={t.feedback} description={t.feedbackHint}>
          <Button onClick={() => showModal(<FeedbackModal url={feedback} />)}><GithubIcon />{t.feedbackIssue}</Button>
        </Row>
        <div style={{ borderBottom: `1px solid ${colors.line}` }}>
          <Row title={t.reset} description={resetError || (reset === "done" ? t.resetDone : t.resetHint)}
            titleColor={reset === "confirm" ? colors.danger : undefined}>
            <Button disabled={reset === "busy" || launch.options === undefined} onClick={() => void runReset()}
              style={reset === "confirm" ? { background: colors.danger, color: "#fff" } : undefined}>
              {reset === "confirm" ? t.resetConfirm : t.reset}
            </Button>
          </Row>
        </div>
      </Focusable>

      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <SectionTitle first>{t.thanks}</SectionTitle>
        <div style={{ borderBottom: `1px solid ${colors.line}` }}>
          <LinkRow title="Game Cheats Manager" note="dyang886" url={GCM_URL} />
        </div>
        <SectionTitle>{t.recommended}</SectionTitle>
        <div style={{ borderBottom: `1px solid ${colors.line}` }}>
          <LinkRow title="CreamDeck" description={t.creamDeckHint} note={t.deckyPlugin} url={CREAMDECK_URL} icon={<span style={{
            display: "inline-flex", width: 44, height: 44, borderRadius: 6, alignItems: "center", justifyContent: "center",
            background: "rgba(26,159,255,.18)", color: colors.accentText, fontSize: 18,
          }}><FaUnlock /></span>} />
        </div>
      </Focusable>
    </Focusable>
  </div>;
}
