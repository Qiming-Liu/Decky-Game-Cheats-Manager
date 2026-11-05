import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadDomain(steam = {}, appStore = undefined) {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const source = readFileSync(new URL(`../../src/domain/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    const module = { exports: {} };
    cache.set(name, module.exports);
    vm.runInNewContext(outputText, { module, exports: module.exports, require: name => load(name.replace("./", "")),
      SteamClient: { Apps: steam }, appStore, window: { setTimeout, clearTimeout } });
    return module.exports;
  }
  return { ...load("sidecar"), ...load("steam"), ...load("common"), ...load("custom"), LaunchOptions: load("options").LaunchOptions };
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

test("the program path is quoted exactly once and old double-quoted values still read back", () => {
  const { editSidecar, sidecarPath, LaunchOptions } = loadDomain();
  assert.equal(editSidecar("", "/home/deck/Trainer.exe"),
    "PROTON_REMOTE_DEBUG_CMD=/home/deck/Trainer.exe PRESSURE_VESSEL_FILESYSTEMS_RW=/home/deck %command%");
  const spaced = editSidecar("", "/home/deck/My Trainer/Trainer.exe");
  assert.ok(spaced.includes("PROTON_REMOTE_DEBUG_CMD='/home/deck/My Trainer/Trainer.exe'"), spaced);
  assert.equal(LaunchOptions.parse(spaced).getEnvironment("PROTON_REMOTE_DEBUG_CMD"), "/home/deck/My Trainer/Trainer.exe");
  assert.equal(sidecarPath(`PROTON_REMOTE_DEBUG_CMD=''"'"'/home/deck/Old Trainer.exe'"'"'' %command%`), "/home/deck/Old Trainer.exe");
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
  const { writeLaunchOptions, editSidecar } = loadDomain({
    RegisterForAppDetails(_id, callback) {
      queueMicrotask(() => callback({ strLaunchOptions: "NEW=1 %command%" }));
      return { unregister() { unregisters++; } };
    },
    SetAppLaunchOptions() { writes++; },
  });
  await assert.rejects(() => writeLaunchOptions("42", "%command%", current => editSidecar(current, "/home/deck/Trainer.exe")),
    /changed elsewhere/);
  assert.equal(writes, 0);
  assert.equal(unregisters, 1);
});

test("writes sort variables, keep command and argument order, and confirm the result", async () => {
  let stored = "ZED=1 gamescope -f -- mangohud %command% -novid +fps_max 60";
  const written = [];
  const { writeLaunchOptions, setToggle } = loadDomain({
    RegisterForAppDetails(_id, callback) {
      queueMicrotask(() => callback({ strLaunchOptions: stored }));
      return { unregister() {} };
    },
    SetAppLaunchOptions(_id, value) { written.push(value); stored = value; },
  });
  const saved = await writeLaunchOptions("42", stored, current => setToggle(current, "log", true));
  assert.equal(saved, "PROTON_LOG=1 ZED=1 gamescope -f -- mangohud %command% -novid +fps_max 60");
  assert.deepEqual([...written], [saved]);
});

test("non-Steam shortcuts are read and written through their own launch options", async () => {
  let shortcut = "%command%";
  const calls = [];
  const { writeLaunchOptions, setToggle } = loadDomain({
    RegisterForAppDetails(_id, callback) {
      queueMicrotask(() => callback({ strLaunchOptions: "WRONG=1 %command%", strShortcutLaunchOptions: shortcut }));
      return { unregister() {} };
    },
    SetAppLaunchOptions() { calls.push("app"); },
    SetShortcutLaunchOptions(_id, value) { calls.push("shortcut"); shortcut = value; },
  }, { GetAppOverviewByAppID: () => ({ app_type: 1073741824 }) });
  assert.equal(await writeLaunchOptions("3000000000", "%command%", current => setToggle(current, "sdl", true)),
    "PROTON_USE_SDL=1 %command%");
  assert.deepEqual(calls, ["shortcut"]);
});

test("canonical form keeps the last duplicate and drops an empty result", () => {
  const { LaunchOptions } = loadDomain();
  assert.equal(LaunchOptions.parse("b=2 A=1 b=3 %command%").canonical(), "A=1 b=3 %command%");
  assert.equal(LaunchOptions.parse("gamescope -- %command%").canonical(), "gamescope -- %command%");
  assert.equal(LaunchOptions.parse("%command%").canonical(), "");
  assert.equal(LaunchOptions.parse("%command% | tee").canonical(), "%command% | tee");
});

test("common settings are read only from the launch text", () => {
  const { readCommon, setLanguage, setToggle } = loadDomain();
  const state = readCommon(`LD_PRELOAD=/opt/hook.so LANG=ja_JP.UTF-8 SteamDeck=0 %command%`);
  assert.equal(state.language, "ja_JP.UTF-8");
  assert.equal(state.toggles.desktop, true);
  assert.equal(state.toggles.overlay, false);
  assert.equal(state.occupied.overlay, true);
  const english = setLanguage("LANG=ja_JP.UTF-8 HOST_LC_ALL=ja_JP.UTF-8 %command%", "en_US.UTF-8");
  assert.equal(readCommon(english).language, "en_US.UTF-8");
  assert.equal(setLanguage(english, undefined), "");
  assert.equal(readCommon(setToggle("%command%", "overlay", true)).toggles.overlay, true);
});

test("unrecognized words become toggleable definitions; known ones stay out", () => {
  const { unrecognized, setOptionEnabled, isOptionEnabled } = loadDomain();
  const source = `MANGOHUD=1 PROTON_LOG=1 PROTON_REMOTE_DEBUG_CMD='/t.exe' ~/lsfg -- gamemoderun %command% -novid -w 1280`;
  const saved = [{ id: "preset-lsfg", name: "", definitions: ["~/lsfg"] }];
  const words = unrecognized(source, saved);
  assert.deepEqual([...words], ["MANGOHUD=1", "gamemoderun", "-novid", "-w 1280"]);
  const detected = { id: "user", name: "", detected: true, definitions: words };
  assert.equal(isOptionEnabled(source, detected), true);
  const off = setOptionEnabled(source, detected, false);
  assert.equal(unrecognized(off, saved).length, 0);
  assert.ok(off.includes("~/lsfg") && off.includes("PROTON_LOG=1"));
  assert.equal(isOptionEnabled(setOptionEnabled(off, detected, true), detected), true);
});

test("preview segments keep source order and group arguments with their flag", () => {
  const { LaunchOptions } = loadDomain();
  const segments = LaunchOptions.parse("A=$HOME B=1 ~/lsfg -- gamemoderun %command% bare -w 1280").segments();
  assert.deepEqual([...segments.map(segment => segment.text)], ["A=$HOME", "B=1", "~/lsfg", "--", "gamemoderun", "%command%", "bare", "-w 1280"]);
  assert.deepEqual([...segments.map(segment => segment.definition?.kind ?? null)], [null, "environment", "prefix", null, "prefix", null, null, "argument"]);
});

test("launch options without %command% are the game's arguments and stay editable", () => {
  const { LaunchOptions, setToggle, unrecognized } = loadDomain();
  const shortcut = `"run" "--branch=stable" "--command=protonplus" "com.vysp3r.ProtonPlus"`;
  const parsed = LaunchOptions.parse(shortcut);
  assert.equal(parsed.editable, true);
  assert.equal(parsed.canonical(), shortcut);
  assert.equal(setToggle(shortcut, "sdl", true), `PROTON_USE_SDL=1 %command% ${shortcut}`);
  assert.equal(LaunchOptions.parse(setToggle(setToggle(shortcut, "sdl", true), "sdl", false)).canonical(), shortcut);
  assert.equal(LaunchOptions.parse("%command% -novid").canonical(), "-novid");
  assert.deepEqual([...unrecognized("-novid -w 1280", [])], ["-novid", "-w 1280"]);
  assert.deepEqual([...LaunchOptions.parse("-novid").segments().map(s => s.text)], ["-novid"]);
});
