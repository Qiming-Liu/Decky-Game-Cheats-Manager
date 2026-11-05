import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadI18n(getCurrentLanguage = async () => "english") {
  const cache = new Map();
  const effects = [];
  let notify;
  const react = {
    useEffect(effect) { effects.push(effect); },
    useSyncExternalStore(subscribe, snapshot) {
      notify = { calls: 0, snapshot };
      notify.unsubscribe = subscribe(() => { notify.calls++; });
      return snapshot();
    },
  };
  function load(name) {
    if (name.endsWith(".json")) return JSON.parse(readFileSync(new URL(`../../src/utils/${name}`, import.meta.url), "utf8"));
    if (cache.has(name)) return cache.get(name);
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../../src/utils/${name}.ts`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const module = { exports: {} };
    cache.set(name, module.exports);
    vm.runInNewContext(outputText, {
      module, exports: module.exports, SteamClient: { Settings: { GetCurrentLanguage: getCurrentLanguage } },
      require: name => name === "react" ? react : load(name.replace(/^\.\//, "")),
    });
    return module.exports;
  }
  return { i18n: load("i18n"), effects, notification: () => notify };
}

test("Steam language identifiers distinguish Simplified and Traditional Chinese", async () => {
  const { i18n } = loadI18n();
  for (const language of ["schinese", "ZH_cn", "zh-Hans", "zh-SG"]) assert.equal(i18n.steamLocale(language), "zh-CN");
  for (const language of ["tchinese", "zh_TW", "zh-Hant", "zh-HK"]) assert.equal(i18n.steamLocale(language), "zh-TW");
  for (const language of ["english", "german", "", null, undefined, {}]) assert.equal(i18n.steamLocale(language), "en");
});

test("initial detection and later Steam language changes notify mounted views", async () => {
  let language = "schinese";
  const { i18n, notification } = loadI18n(async () => language);
  assert.equal(i18n.useTranslations().settings, "Settings");
  await i18n.initLanguage();
  assert.equal(notification().calls, 1);
  assert.equal(notification().snapshot(), "zh-CN");
  assert.equal(i18n.translations().settings, "设置");
  assert.equal(i18n.getSearchLanguage(), "zh");
  language = "tchinese";
  await i18n.initLanguage();
  assert.equal(notification().calls, 2);
  assert.equal(i18n.translations().settings, "設定");
  assert.equal(i18n.getSearchLanguage(), "zh");
  language = "english";
  await i18n.initLanguage();
  assert.equal(i18n.translations().settings, "Settings");
  assert.equal(i18n.getSearchLanguage(), "en");
  notification().unsubscribe();
});

test("concurrent detection shares a request and temporary Steam failures preserve the language", async () => {
  let calls = 0, release;
  const { i18n } = loadI18n(() => {
    calls++;
    return calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.reject(new Error("Steam unavailable"));
  });
  const first = i18n.initLanguage();
  const second = i18n.initLanguage();
  assert.equal(first, second);
  assert.equal(calls, 1);
  release("tchinese");
  await first;
  await i18n.initLanguage();
  assert.equal(i18n.getLanguage(), "zh-TW");
});
