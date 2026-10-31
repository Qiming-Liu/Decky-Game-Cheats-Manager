import { useTranslations, errorMessage } from "../utils/i18n";
import { FileSelectionType, openFilePicker } from "@decky/api";
import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";
import { useLibrary, invalidateLibrary } from "../hooks/useLibrary";
import { importTrainer } from "../utils/backend";

export default function ImportTrainer({ appId, gameName }: { appId: string; gameName: string }) {
  const t = useTranslations();
  const { library, error } = useLibrary(appId, gameName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function browse() {
    setBusy(true); setMessage("");
    let source: string;
    try {
      const picked = await openFilePicker(FileSelectionType.FILE, library?.directory || "~", true, true,
        undefined, ["exe"]);
      source = picked.realpath || picked.path;
    } catch { setBusy(false); return; }
    try {
      await importTrainer({ appId, directory: library?.directory || "", source, gameName });
      invalidateLibrary();
      setMessage("bound");
    } catch (error) { setMessage(error instanceof Error ? error.message : "unknownError"); }
    finally { setBusy(false); }
  }
  return <Focusable flow-children="column">
    <DialogButton disabled={busy || !library?.success} onClick={() => { void browse(); }}>
      {busy ? t.copying : t.selectExe}</DialogButton>
    {(message || error) && <div role="status" style={{ overflowWrap: "anywhere" }}>{errorMessage(message || error, t)}</div>}
  </Focusable>;
}
