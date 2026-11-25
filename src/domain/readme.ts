// Where the About page sends a reader: the README in their language.
import data from "../data/readme.json";

const TRANSLATIONS: Record<string, string> = data.translations;

/**
 * The project's README for `locale`. The English one is the repository's front
 * page; a translation opens as its own file. Release packages carry only the
 * English README, so the translations are read on GitHub.
 */
export function readmeUrl(repository: string, locale: string): string {
  const file = TRANSLATIONS[locale];
  return file ? `${repository}/blob/${data.branch}/${file}#${data.anchor}` : `${repository}#${data.anchor}`;
}
