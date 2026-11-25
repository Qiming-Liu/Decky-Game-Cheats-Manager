import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./support/load.mjs";

const environment = load(["src/domain/environment"]);
const hints = (...args) => JSON.parse(JSON.stringify(environment.environmentHints(...args)));
const running = { wine_mono: "", ms_clr: false, elf32: false, tool_mono: "11.3.0", managed_trainers: [] };

test("what the running game loaded decides; before it runs, its files and prefix do", () => {
  assert.deepEqual(hints({ runtime: { ...running, wine_mono: "11.3.0" } }), ["wineMono"]);
  // Microsoft's runtime loaded as well: nothing to say.
  assert.deepEqual(hints({ runtime: { ...running, wine_mono: "11.3.0", ms_clr: true } }), []);
  assert.deepEqual(hints({ prelaunch: { managed: true, prefix: true, ms_dotnet: false } }), ["dotnetPrefix"]);
  assert.deepEqual(hints({ prelaunch: { managed: true, prefix: true, ms_dotnet: true } }), []);
  assert.deepEqual(hints({ prelaunch: { managed: true, prefix: true, ms_dotnet: false }, runtime: running }), []);
});

test("old WoW64, a broken Wine Mono with a .NET trainer, and a game Steam does not see each add a hint", () => {
  assert.deepEqual(hints({ runtime: { ...running, elf32: true } }), ["oldWow64"]);
  assert.deepEqual(hints({ runtime: { ...running, tool_mono: "11.2.0" } }), []);
  assert.deepEqual(hints({ runtime: { ...running, tool_mono: "11.2.0", managed_trainers: ["Trainer.exe"] } }, true),
    ["brokenMono", "untracked"]);
  assert.equal(environment.collectorAtRisk({ runtime: { ...running, wine_mono: "11.3.0" } }), true);
  assert.equal(environment.collectorAtRisk({ runtime: running }), false);
});
