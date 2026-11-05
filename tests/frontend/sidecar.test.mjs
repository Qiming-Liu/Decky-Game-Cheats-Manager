import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadDomain(steam = {}) {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const source = readFileSync(new URL(`../../src/domain/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    const module = { exports: {} };
    cache.set(name, module.exports);
    vm.runInNewContext(outputText, { module, exports: module.exports, require: name => load(name.replace("./", "")),
      SteamClient: { Apps: steam }, window: { setTimeout, clearTimeout } });
    return module.exports;
  }
  return { ...load("sidecar"), LaunchOptions: load("options").LaunchOptions };
}

test("sidecar paths round-trip without altering unrelated launch source", () => {
  const { editSidecar, sidecarPath } = loadDomain();
  const original = `MANGOHUD=1 gamescope -f -- %command% -windowed`;
  for (const path of ["/home/deck/Trainer.exe", `/home/deck/Trainer Folder/it's \"$trainer\".exe`, "/home/deck/游戏/Trainer.bat"]) {
    const updated = editSidecar(original, path);
    assert.equal(sidecarPath(updated), path);
    assert.ok(updated.startsWith("MANGOHUD=1 "));
    assert.ok(updated.endsWith("gamescope -f -- %command% -windowed"));
    assert.equal(sidecarPath(editSidecar(updated)), undefined);
    assert.ok(editSidecar(updated).startsWith("MANGOHUD=1 "));
    assert.ok(editSidecar(updated).endsWith("gamescope -f -- %command% -windowed"));
  }
});

test("existing shared folders survive enabling and disabling sidecars", () => {
  const { editSidecar, LaunchOptions } = loadDomain();
  const original = `PRESSURE_VESSEL_FILESYSTEMS_RW='/mnt/tools:/mnt/mods' %command%`;
  const updated = editSidecar(original, "/home/deck/Trainer.exe");
  assert.equal(LaunchOptions.parse(updated).getEnvironment("PRESSURE_VESSEL_FILESYSTEMS_RW"), "/mnt/tools:/mnt/mods:/home/deck");
  assert.equal(LaunchOptions.parse(editSidecar(updated)).getEnvironment("PRESSURE_VESSEL_FILESYSTEMS_RW"), "/mnt/tools:/mnt/mods:/home/deck");
});

test("complex launch source and dynamic filesystem values are never overwritten", () => {
  const { editSidecar } = loadDomain();
  assert.throws(() => editSidecar("%command% && other", "/home/deck/Trainer.exe"), /safely/);
  assert.throws(() => editSidecar("PRESSURE_VESSEL_FILESYSTEMS_RW=$HOME %command%", "/home/deck/Trainer.exe"), /dynamic/);
  assert.throws(() => editSidecar("", "/home/deck/bad\nname.exe"), /valid/);
});

test("saving refuses stale state and unregisters its Steam subscription", async () => {
  let writes = 0, unregisters = 0;
  const { saveSidecar } = loadDomain({
    RegisterForAppDetails(_id, callback) {
      queueMicrotask(() => callback({ strLaunchOptions: "NEW=1 %command%" }));
      return { unregister() { unregisters++; } };
    },
    SetAppLaunchOptions() { writes++; },
  });
  await assert.rejects(() => saveSidecar("42", "%command%", "/home/deck/Trainer.exe"), /changed elsewhere/);
  assert.equal(writes, 0);
  assert.equal(unregisters, 1);
});
