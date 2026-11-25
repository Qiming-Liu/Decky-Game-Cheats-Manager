import { ModalRoot, showModal } from "@decky/ui";
import { useEffect, useRef } from "react";
import { acknowledgeTestNotice, getTestNotice, logFrontend } from "../utils/backend";
import { useTranslations } from "../utils/i18n";
import type { Translations } from "../utils/locales";
import { Button, colors } from "./shell";

// Asked once per plugin load; the backend remembers across loads which test
// build the player has seen.
let asked = false;

/**
 * Warns once after a test build is installed, the first time the Quick Access
 * menu shows the plugin. Releases ship it too, but the backend never has a
 * notice for them. The dialog opens in the menu's own window.
 */
export function TestBuildNotice() {
  const t = useTranslations();
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (asked) return;
    asked = true;
    getTestNotice().then(version => {
      if (!version) return;
      // The menu closed before the answer came: ask again on the next open.
      if (!anchor.current) { asked = false; return; }
      showModal(<Notice t={t} version={version} />, anchor.current, {
        strTitle: t.testBuildTitle(version), bHideMainWindowForPopouts: false,
        fnOnClose: () => {
          void acknowledgeTestNotice().then(result => {
            if (!result.success) logFrontend("warning", `Could not record the test build notice: ${result.error}`);
          }).catch(error => logFrontend("warning", "Could not record the test build notice", error));
        },
      });
    }).catch(() => { asked = false; });
  }, []);
  return <span ref={anchor} hidden />;
}

function Notice({ t, version, closeModal }: { t: Translations; version: string; closeModal?: () => void }) {
  return <ModalRoot closeModal={closeModal}>
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: colors.warning }}>{t.testBuildTitle(version)}</div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#dcdedf" }}>{t.testBuildNotice}</div>
      <Button primary style={{ alignSelf: "flex-end", padding: "0 22px" }} onClick={closeModal}>{t.testBuildOk}</Button>
    </div>
  </ModalRoot>;
}
