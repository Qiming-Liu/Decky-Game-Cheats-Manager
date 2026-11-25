import { Focusable } from "@decky/ui";
import { useTranslations } from "../../utils/i18n";
import { Button, colors, IconButton } from "../shell";
import { BumperGlyph, ChevronLeftIcon, ChevronRightIcon } from "../icons";

const arrow = { width: 36, minWidth: 36, height: 36 } as const;

/** Page buttons between the bumper glyphs. Pages in `marked` hold a trainer in use. */
export function Pager({ page, pages, marked, onPage }: {
  page: number; pages: number; marked: ReadonlySet<number>; onPage: (page: number) => void;
}) {
  const t = useTranslations();
  return <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
    <BumperGlyph side="L" color={colors.muted} />
    <IconButton label={t.previousPage} disabled={page === 0} focusable={page > 0} style={arrow} onClick={() => onPage(page - 1)}><ChevronLeftIcon /></IconButton>
    {Array.from({ length: pages }, (_, index) => {
      const current = index === page, inUse = marked.has(index);
      return <Button key={index} aria-label={t.pageLabel(index + 1)} aria-current={current ? "page" : undefined}
        onClick={() => onPage(index)} style={{
          width: 36, minWidth: 36, height: 36, padding: 0, fontSize: 14, fontWeight: current ? 700 : 400,
          background: current ? (inUse ? colors.accent : colors.button) : inUse ? "rgba(26,159,255,.18)" : "transparent",
          color: current ? colors.text : inUse ? colors.accentText : "#a9b1b8",
          boxShadow: inUse && !current ? "inset 0 0 0 1px rgba(124,196,255,.5)" : undefined,
        }}>{index + 1}</Button>;
    })}
    <IconButton label={t.nextPage} disabled={page === pages - 1} focusable={page < pages - 1} style={arrow} onClick={() => onPage(page + 1)}><ChevronRightIcon /></IconButton>
    <BumperGlyph side="R" color={colors.muted} />
  </Focusable>;
}
