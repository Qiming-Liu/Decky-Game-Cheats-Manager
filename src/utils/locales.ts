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
  };
}

export type Translations = ReturnType<typeof translations>;

export const en = translations(english);
export const zhCN = translations(simplifiedChinese);
export const zhTW = translations(traditionalChinese);
