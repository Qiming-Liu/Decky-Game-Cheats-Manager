import { ConfirmModal, showModal } from "@decky/ui";
import { confirmTableFile, getTableTrust, TableCode, TableTrustState } from "../utils/backend";
import type { Translations } from "../utils/locales";

/** Whether a table still needs the player's confirmation, and what it can run; unknown when it cannot be checked. */
export async function tableTrust(path: string): Promise<{ state: TableTrustState; code: TableCode[] | null } | undefined> {
  try {
    const result = await getTableTrust(path);
    if (result.success && result.state) return { state: result.state, code: result.code ?? null };
  } catch { /* unknown */ }
  return undefined;
}

/** What in a table can run code, one line each; one line saying so when it could not be checked. */
export function tableCodeLines(t: Translations, code: TableCode[] | null): string[] {
  const labels: Record<TableCode, string> = {
    lua: t.tableCodeLua, forms: t.tableCodeForms, files: t.tableCodeFiles, assembler: t.tableCodeAssembler,
  };
  return code ? code.map(kind => `· ${labels[kind]}`) : [t.importTableUnknown];
}

/**
 * The confirmation dialog: true once the player agreed; the file name is then
 * recorded as confirmed. `opener` picks the window it opens in: from the Quick
 * Access menu that is the menu's own, so it is not hidden behind the game.
 */
export function askTable(t: Translations, path: string, code: TableCode[] | null, opener: EventTarget = window): Promise<boolean> {
  const details = tableCodeLines(t, code);
  return new Promise(resolve => {
    showModal(<ConfirmModal strTitle={t.importTableTitle}
      strDescription={<>
        <div style={{ marginBottom: 8 }}>{t.importTableWarning}</div>
        {details.map(line => <div key={line}>{line}</div>)}
      </>}
      strOKButtonText={t.importTableOk} strCancelButtonText={t.cancel}
      onOK={() => { void confirmTableFile(path).catch(() => {}).finally(() => resolve(true)); }}
      onCancel={() => resolve(false)} />, opener);
  });
}

/**
 * Cheat Engine runs a table's scripts without asking, so a table the player
 * has not agreed to (a local one that can run code, under a name never
 * confirmed) is confirmed before it is used. A table that cannot be checked
 * (an encrypted .cetrainer) is confirmed unless its name was.
 */
export async function confirmTableUse(t: Translations, path: string): Promise<boolean> {
  const trust = await tableTrust(path);
  if (trust?.state === "ok") return true;
  return askTable(t, path, trust?.code ?? null);
}
