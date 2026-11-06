import { Focusable } from "@decky/ui";
import qrcode from "qrcode-generator";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { AUTHOR_AVATAR } from "../data/avatar";
import { REPOSITORY_URL, useUpdate } from "../hooks/useUpdate";
import { getSystemName } from "../utils/backend";
import { useTranslations } from "../utils/i18n";
import { Button, colors, PageHeader, Row, SectionTitle } from "./shell";
import { ChevronRightIcon } from "./icons";
import { openExternal, VersionBadge } from "./update";

const AUTHOR = "ProSS及时行乐";
const GITHUB_URL = "https://github.com/Qiming-Liu";
const BILIBILI_URL = "https://space.bilibili.com/23706122";
const GCM_URL = "https://github.com/dyang886/Game-Cheats-Manager";
const CREAMDECK_URL = "https://github.com/Qiming-Liu/CreamDeck";

/** A new GitHub issue with the details a report needs already filled in; logging in and typing happen on the phone. */
export function feedbackUrl(details: { version: string; system: string; compatTool: string; appId: string }) {
  const body = [
    `**Version:** ${details.version || "?"}`,
    `**System:** ${details.system || "?"}`,
    `**Proton:** ${details.compatTool || "?"}`,
    `**AppID:** ${details.appId}`,
    "",
    "**What happened:**",
    "",
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
  return <Row icon={icon} title={title} description={description} onActivate={() => openExternal(url)}>
    {note && <span style={{ fontSize: 12, color: colors.muted }}>{note}</span>}
    <ChevronRightIcon size={14} color={colors.muted} />
  </Row>;
}

export default function About({ appId, compatTool }: { appId: string; compatTool: string }) {
  const t = useTranslations();
  const { current, latest } = useUpdate();
  const [system, setSystem] = useState("");
  useEffect(() => { void getSystemName().then(name => setSystem(name || "")).catch(() => {}); }, []);
  const feedback = feedbackUrl({ version: current, system, compatTool, appId });

  return <div style={{ padding: "0 8px 24px 0" }}>
    <PageHeader title={t.tabAbout} />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 28, alignItems: "start" }}>
      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <section aria-label={AUTHOR} style={{ padding: 18, borderRadius: 4, background: "rgba(0,0,0,.28)", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src={AUTHOR_AVATAR} alt="" width={64} height={64} style={{ flex: "0 0 64px", borderRadius: 32, objectFit: "cover", background: colors.button }} />
            <div style={{ fontSize: 20, fontWeight: 700, color: colors.text, overflowWrap: "anywhere" }}>{AUTHOR}</div>
          </div>
          <Focusable flow-children="row" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button onClick={() => openExternal(GITHUB_URL)}><GithubIcon />GitHub</Button>
            <Button onClick={() => openExternal(BILIBILI_URL)}><BilibiliIcon />{t.bilibili}</Button>
          </Focusable>
        </section>

        <SectionTitle>{t.aboutPlugin}</SectionTitle>
        <Row title={t.aboutVersion}><VersionBadge current={current} latest={latest} /></Row>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 14px", borderTop: `1px solid ${colors.line}`, borderBottom: `1px solid ${colors.line}` }}>
          <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 16, color: colors.text }}>{t.feedback}</div>
            <div style={{ fontSize: 12, color: colors.muted }}>{t.feedbackHint}</div>
          </div>
          <QrCode text={feedback} label={t.feedbackQr} />
        </div>

        <SectionTitle>{t.thanks}</SectionTitle>
        <div style={{ borderBottom: `1px solid ${colors.line}` }}>
          <LinkRow title="Game Cheats Manager" note="dyang886" url={GCM_URL} />
        </div>
      </Focusable>

      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <SectionTitle first>{t.recommended}</SectionTitle>
        <div style={{ borderBottom: `1px solid ${colors.line}` }}>
          <LinkRow title="CreamDeck" description={t.creamDeckHint} note={t.deckyPlugin} url={CREAMDECK_URL} />
        </div>
        <div style={{ fontSize: 11, color: colors.dim, lineHeight: 1.5, padding: "12px 4px 0" }}>{t.linksOpenInBrowser}</div>
      </Focusable>
    </div>
  </div>;
}
