import english from "../locales/en.json";
import simplifiedChinese from "../locales/zh-CN.json";
import traditionalChinese from "../locales/zh-TW.json";

type Messages = typeof english;

function translations(messages: Messages) {
  return {
    ...messages,
    gameTitle: (id: string) => messages.gameTitle.replace("{id}", () => id),
    downloading: (percent: number | null) => percent === null
      ? messages.downloadingPending
      : messages.downloading.replace("{percent}", () => String(percent)),
    downloadedTitle: (count: number) => messages.downloadedTitle.replace("{count}", () => String(count)),
    deleteDescription: (name: string) => messages.deleteDescription.replace("{name}", () => name),
    runningWith: (name: string) => messages.runningWith.replace("{name}", () => name),
    foundCount: (count: number) => messages.foundCount.replace("{count}", () => String(count)),
    occupiedBy: (value: string) => messages.occupiedBy.replace("{value}", () => value),
    databaseDate: (date: string) => messages.databaseDate.replace("{date}", () => date),
    activeDownloads: (count: number) => messages.activeDownloads.replace("{count}", () => String(count)),
    moreCount: (count: number) => messages.moreCount.replace("{count}", () => String(count)),
    selectedCount: (count: number) => messages.selectedCount.replace("{count}", () => String(count)),
    compatWarnShort: (tool: string) => messages.compatWarnShort.replace("{tool}", () => tool),
    programCount: (count: number) => messages.programCount.replace("{count}", () => String(count)),
    programCountMultiple: (count: number) => messages.programCountMultiple.replace("{count}", () => String(count)),
    itemCount: (count: number) => messages.itemCount.replace("{count}", () => String(count)),
    pageLabel: (count: number) => messages.pageLabel.replace("{count}", () => String(count)),
    seconds: (count: number) => messages.seconds.replace("{count}", () => String(count)),
    recentLines: (count: number) => messages.recentLines.replace("{count}", () => String(count)),
    updatedAt: (date: string) => messages.updatedAt.replace("{date}", () => date),
    catalogProgress: (done: number, total: number) =>
      messages.catalogProgress.replace("{done}", () => String(done)).replace("{total}", () => String(total)),
    tableCount: (count: number) => messages.tableCount.replace("{count}", () => String(count)),
    viaCheatEngine: (version: string) => messages.viaCheatEngine.replace("{version}", () => version).trim(),
    ceInstalled: (version: string) => messages.ceInstalled.replace("{version}", () => version).trim(),
    panelAttached: (process: string) => messages.panelAttached.replace("{process}", () => process),
    panelEntries: (count: number, active: number) =>
      messages.panelEntries.replace("{count}", () => String(count)).replace("{active}", () => String(active)),
    panelAttachHint: (process: string) => messages.panelAttachHint.replace("{process}", () => process),
    panelNoReply: (seconds: number) => messages.panelNoReply.replace("{seconds}", () => String(seconds)),
    panelValueHint: (type: string, value: string) =>
      messages.panelValueHint.replace("{type}", () => type).replace("{value}", () => value),
    panelOnCount: (count: number) => messages.panelOnCount.replace("{count}", () => String(count)),
  };
}

export type Translations = ReturnType<typeof translations>;

export const en = translations(english);
export const zhCN = translations(simplifiedChinese);
export const zhTW = translations(traditionalChinese);
