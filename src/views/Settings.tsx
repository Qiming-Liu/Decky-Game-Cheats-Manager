import { useTranslations, errorMessage } from "../utils/i18n";
import { FileSelectionType, openFilePicker } from "@decky/api";
import { ButtonItem, PanelSection, PanelSectionRow, useQuickAccessVisible } from "@decky/ui";
import { useEffect, useState } from "react";
import { cleanupTrash, getLibrarySettings, refreshDatabase, setLibraryDirectory, DatabaseStatus } from "../utils/backend";
import { invalidateLibrary } from "../hooks/useLibrary";

export default function Settings() {
  const t = useTranslations();
  const visible = useQuickAccessVisible();
  useEffect(() => {
    if (visible) void cleanupTrash().catch(() => {});
  }, [visible]);
  const [directory, setDirectory] = useState("");
  const [database, setDatabase] = useState<DatabaseStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    getLibrarySettings().then(value => {
      if (active) { setDirectory(value.directory); setDatabase(value.database); }
    }).catch(() => { if (active) setMessage("settingsFailed"); });
    return () => { active = false; };
  }, []);
  const choose = async () => {
    setBusy(true);
    let path: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FOLDER, directory || "~", false, true);
      path = picked.realpath || picked.path;
    } catch { setBusy(false); return; }
    try {
      const result = await setLibraryDirectory(path);
      if (!result.success) throw new Error(result.error);
      setDirectory(result.directory || path);
      invalidateLibrary();
      setMessage("folderSaved");
    } catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  };
  const update = async () => {
    setBusy(true); setMessage("updatingDatabase");
    try {
      const result = await refreshDatabase();
      setDatabase((await getLibrarySettings()).database);
      setMessage(result.success ? "databaseUpdated" : Object.values(result.errors)[0] || "databaseUpdateFailed");
    } catch { setMessage("databaseUpdateFailed"); }
    finally { setBusy(false); }
  };
  const updatedAt = Math.max(0, ...Object.values(database?.files || {}).filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)));
  return <PanelSection title={t.settings}>
    <PanelSectionRow><div style={{ fontSize: 14 }}>{t.folder}</div>
      <div style={{ fontSize: 12, opacity: .7, overflowWrap: "anywhere", marginTop: 6 }}>{directory || t.loading}</div>
    </PanelSectionRow>
    <PanelSectionRow><ButtonItem layout="below"
      disabled={busy || !directory} onClick={() => { void choose(); }}>{t.chooseFolder}</ButtonItem></PanelSectionRow>
    <PanelSectionRow><ButtonItem layout="below" label={t.catalog}
      disabled={busy || !database} onClick={() => { void update(); }}>{t.updateDatabase}</ButtonItem></PanelSectionRow>
    <PanelSectionRow><div style={{ fontSize: 12, opacity: .7 }}>{t.lastUpdated}: {updatedAt
      ? new Date(updatedAt * 1000).toLocaleString() : t.neverUpdated}</div></PanelSectionRow>
    {message && <PanelSectionRow><div role="status" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{errorMessage(message, t)}</div></PanelSectionRow>}
  </PanelSection>;
}
