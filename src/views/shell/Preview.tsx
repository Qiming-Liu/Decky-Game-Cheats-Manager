import { definitionKey, type LaunchContext, LaunchOptions } from "../../domain/options";
import type { Translations } from "../../utils/locales";
import { colors, mono } from "./theme";

export type Owner = "page" | "game" | "common" | "modifier" | "other";

/** What Steam receives, with every word coloured by who owns it. */
export function Preview({ t, source, context, ownerOf }: {
  t: Translations; source: string; context: LaunchContext; ownerOf: (definitionKey: string | undefined, name: string | undefined) => Owner;
}) {
  const tone: Record<Owner, string> = { page: colors.accentText, game: "#5ee0c8", common: "#c49bff", modifier: colors.success, other: "#a9b1b8" };
  const key = (owner: Owner, meaning: string) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: tone[owner] }}>
    <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: tone[owner] }} />{meaning}</span>;
  const segments = LaunchOptions.parse(LaunchOptions.parse(source).canonical(), context).segments();
  return <section aria-label={t.steamReceives} style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 4, background: "rgba(0,0,0,.35)", display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, color: colors.muted }}>
      <span>{t.steamReceives}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap" }}>
        {key("page", t.globalOptions)}{key("game", t.gameOptions)}{key("common", t.legendCommon)}{key("modifier", t.legendModifier)}{key("other", t.legendOther)}
      </span></div>
    <div style={{ ...mono, lineHeight: 1.6, color: tone.other }}>
      {segments.length ? segments.map((segment, index) => {
        const definition = segment.definition;
        const owner = ownerOf(definition ? definitionKey(definition, context.home) : undefined, segment.name);
        return <span key={index} style={{ color: tone[owner] }}>{index ? " " : ""}{segment.text}</span>;
      }) : t.noLaunchOptions}
    </div>
  </section>;
}
