import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { load } from "./support/load.mjs";

const { readmeUrl } = load("src/domain/readme");
const repository = "https://github.com/Qiming-Liu/Decky-Game-Cheats-Manager";

test("the About page opens the README in the reader's language", () => {
  assert.equal(readmeUrl(repository, "en"), `${repository}#deckygcm`);
  assert.equal(readmeUrl(repository, "zh-CN"), `${repository}/blob/main/README.zh-CN.md#deckygcm`);
  assert.equal(readmeUrl(repository, "zh-TW"), `${repository}/blob/main/README.zh-TW.md#deckygcm`);
  // A language without a translation gets the English front page.
  assert.equal(readmeUrl(repository, "ja"), `${repository}#deckygcm`);
});

test("every README a link points to exists and links to the others", () => {
  const files = ["README.md", ...Object.values(JSON.parse(readFileSync(new URL("../../src/data/readme.json", import.meta.url), "utf8")).translations)];
  for (const file of files) {
    const url = new URL(`../../${file}`, import.meta.url);
    assert.ok(existsSync(url), file);
    const text = readFileSync(url, "utf8");
    assert.match(text, /^# DeckyGCM$/m, `${file} keeps the heading the link's anchor names`);
    for (const other of files.filter(name => name !== file)) assert.ok(text.includes(`(${other})`), `${file} links to ${other}`);
  }
});
