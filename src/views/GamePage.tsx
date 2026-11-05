import { PLUGIN_NAME, useTranslations } from "../utils/i18n";
import { SidebarNavigation } from "@decky/ui";
import { useEffect } from "react";
import { checkDatabaseUpdate, cleanupTrash } from "../utils/backend";
import { FaSearch, FaDownload, FaLink } from "react-icons/fa";
import { getAppIdFromLocation } from "../utils/routes";
import TrainerSearch from "./TrainerSearch";
import Downloaded from "./Downloaded";
import ImportTrainer from "./ImportTrainer";

export default function GamePage() {
  const t = useTranslations();
  const appId = getAppIdFromLocation();
  useEffect(() => {
    if (appId) {
      void checkDatabaseUpdate().catch(() => {});
      void cleanupTrash().catch(() => {});
    }
  }, [appId]);
  if (!appId) return <div>{t.noAppId}</div>;
  const name = typeof appStore === "undefined" ? "" : appStore?.GetAppOverviewByAppID?.(Number(appId))?.display_name || "";
  return <SidebarNavigation key={appId} title={PLUGIN_NAME} showTitle pages={[
    { identifier: "downloaded", title: t.downloaded, hideTitle: true, icon: <FaDownload />, content: <Downloaded appId={appId} gameName={name} /> },
    { identifier: "bind", title: t.bindTrainer, icon: <FaLink />, content: <ImportTrainer appId={appId} gameName={name} /> },
    { identifier: "search", title: t.search, hideTitle: true, icon: <FaSearch />, content: <TrainerSearch appId={appId} initialKeyword={name} /> },
  ]} />;
}
