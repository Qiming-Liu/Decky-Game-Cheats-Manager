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
  return { ...load("trainerCommand"), ...load("steam"), ...load("common"), ...load("custom"), ...load("options") };
}

test("the trainer command round-trips without altering unrelated launch source", () => {
  const { setTrainerCommand, trainerCommand } = loadDomain();
  const original = `MANGOHUD=1 gamescope -f -- %command% -windowed`;
  for (const path of ["/home/deck/Trainer.exe", `/home/deck/Trainer Folder/it's \"$trainer\".exe`, "/home/deck/游戏/Trainer.bat"]) {
    const updated = setTrainerCommand(original, path);
    assert.equal(trainerCommand(updated), path);
    assert.ok(updated.startsWith("MANGOHUD=1 "));
    assert.ok(updated.endsWith("gamescope -f -- %command% -windowed"));
    assert.equal(trainerCommand(setTrainerCommand(updated)), undefined);
    assert.ok(setTrainerCommand(updated).startsWith("MANGOHUD=1 "));
    assert.ok(setTrainerCommand(updated).endsWith("gamescope -f -- %command% -windowed"));
  }
});

test("values are quoted once, double-quoted only when they hold a single quote, and older quoting still reads", () => {
  const { setTrainerCommand, trainerCommand, launcherCommand, launcherPrograms, setToggle, renderWord, LaunchOptions } = loadDomain();
  assert.equal(setTrainerCommand("", "/home/deck/Trainer.exe"),
    "PROTON_REMOTE_DEBUG_CMD=/home/deck/Trainer.exe %command%");
  const spaced = setTrainerCommand("", "/home/deck/My Trainer/Trainer.exe");
  assert.ok(spaced.includes("PROTON_REMOTE_DEBUG_CMD='/home/deck/My Trainer/Trainer.exe'"), spaced);
  assert.equal(LaunchOptions.parse(spaced).getEnvironment("PROTON_REMOTE_DEBUG_CMD"), "/home/deck/My Trainer/Trainer.exe");
  assert.equal(trainerCommand(`PROTON_REMOTE_DEBUG_CMD=''"'"'/home/deck/Old Trainer.exe'"'"'' %command%`), "/home/deck/Old Trainer.exe");
  const script = "/home/deck/homebrew/settings/DeckyGCM/launch.bat";
  const program = "/home/deck/DeckyGCM/[风灵] Game/Trainer $1 `x`.exe";
  const value = setTrainerCommand("", launcherCommand(script, [program]), ["/home/deck/DeckyGCM/[风灵] Game"]);
  assert.equal(value,
    `PROTON_REMOTE_DEBUG_CMD="${script} 'Z:\\home\\deck\\DeckyGCM\\[风灵] Game\\Trainer \\$1 \\\`x\\\`.exe'" %command%`);
  const read = source => launcherPrograms(LaunchOptions.parse(source).getEnvironment("PROTON_REMOTE_DEBUG_CMD"), script);
  assert.deepEqual([...read(value)], [program]);
  const old = `PROTON_REMOTE_DEBUG_CMD='${script} '"'"'Z:\\home\\deck\\Old Trainer.exe'"'"'' %command%`;
  assert.deepEqual([...read(old)], ["/home/deck/Old Trainer.exe"]);
  // A backslash before the closing quote or a double quote stays literal.
  const options = LaunchOptions.parse("%command%");
  for (const tricky of [`it's a\\`, `it's "q" \\" \\\\`]) {
    const edited = options.setEnabled({ kind: "environment", name: "X", value: tricky }, true);
    assert.ok(edited.ok);
    assert.equal(LaunchOptions.parse(edited.value.toString()).getEnvironment("X"), tricky);
  }
  assert.equal(setToggle("", "overlay", true), "LD_PRELOAD='' %command%");
  assert.equal(renderWord("a b"), "'a b'");
  assert.equal(renderWord("$x y"), "'$x y'");
  assert.equal(renderWord("it's $x"), '"it\'s \\$x"');
  assert.equal(renderWord("Z:\\a b\\c.exe"), "'Z:\\a b\\c.exe'");
});

test("folders the container already shares are not listed; others are, and go again", () => {
  const { setTrainerCommand, LaunchOptions } = loadDomain();
  const shared = source => LaunchOptions.parse(source).getEnvironment("PRESSURE_VESSEL_FILESYSTEMS_RW");
  const original = `PRESSURE_VESSEL_FILESYSTEMS_RW='/mnt/tools:/data/mods' %command%`;
  for (const home of ["/home/deck", "/var/home/deck", "/run/media/deck/SD", "/mnt/games"]) {
    assert.equal(shared(setTrainerCommand(original, `${home}/Trainer.exe`)), "/mnt/tools:/data/mods");
  }
  const outside = setTrainerCommand(original, "/data/trainers/Trainer.exe");
  assert.equal(shared(outside), "/mnt/tools:/data/mods:/data/trainers");
  assert.equal(shared(setTrainerCommand(outside)), "/mnt/tools:/data/mods");
  assert.equal(setTrainerCommand(setTrainerCommand("%command%", "/data/trainers/Trainer.exe")), "");
});

test("switching trainers leaves no plugin folders behind, old ones included", () => {
  const { setTrainerCommand, launcherCommand, LaunchOptions } = loadDomain();
  const script = "/home/deck/homebrew/settings/DeckyGCM/launch.bat";
  // SteamOS-like: the library is configured through /home, trainer paths are resolved.
  const library = "/var/home/deck/DeckyGCM";
  const owner = { script, libraries: ["/home/deck/DeckyGCM", library] };
  const use = (source, program) => setTrainerCommand(source, launcherCommand(script, [program]),
    ["/home/deck/homebrew/settings/DeckyGCM", program.slice(0, program.lastIndexOf("/"))], owner);
  const shared = source => LaunchOptions.parse(source).getEnvironment("PRESSURE_VESSEL_FILESYSTEMS_RW");
  // What earlier versions wrote: the launcher folder and library folders, all shared anyway.
  let value = `PRESSURE_VESSEL_FILESYSTEMS_RW=/data/tools:/home/deck/homebrew/settings/DeckyGCM:${library}/Old:${library}/A %command%`;
  value = use(value, `${library}/A/a.exe`);
  assert.equal(shared(value), "/data/tools");
  value = use(value, "/data/linked/b.exe");
  assert.equal(shared(value), "/data/tools:/data/linked");
  value = use(value, `${library}/C/c.exe`);
  assert.equal(shared(value), "/data/tools");
  assert.equal(shared(setTrainerCommand(use("%command%", "/data/linked/b.exe"), undefined, undefined, owner)), undefined);
});

test("complex launch source and dynamic filesystem values are never overwritten", () => {
  const { setTrainerCommand } = loadDomain();
  assert.throws(() => setTrainerCommand("%command% && other", "/home/deck/Trainer.exe"), /safely/);
  assert.throws(() => setTrainerCommand("PRESSURE_VESSEL_FILESYSTEMS_RW=$HOME %command%", "/home/deck/Trainer.exe"), /dynamic/);
  assert.throws(() => setTrainerCommand("", "/home/deck/bad\nname.exe"), /valid/);
});

test("saving refuses stale state and unregisters its Steam subscription", async () => {
  let writes = 0, unregisters = 0;
  const { writeLaunchOptions, setTrainerCommand } = loadDomain({
    RegisterForAppDetails(_id, callback) {
      queueMicrotask(() => callback({ strLaunchOptions: "NEW=1 %command%" }));
      return { unregister() { unregisters++; } };
    },
    SetAppLaunchOptions() { writes++; },
  });
  await assert.rejects(() => writeLaunchOptions("42", "%command%", current => setTrainerCommand(current, "/home/deck/Trainer.exe")),
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

test("Flatpak and AppImage shortcut launchers are detected", async () => {
  const { readLaunchDetails, isUnsupportedLauncher } = loadDomain({
    RegisterForAppDetails(_id, callback) {
      queueMicrotask(() => callback({ strShortcutLaunchOptions: "", strShortcutExe: "\"/usr/bin/flatpak\"" }));
      return { unregister() {} };
    },
  }, { GetAppOverviewByAppID: () => ({ app_type: 1073741824 }) });
  const details = await readLaunchDetails("3000000000");
  assert.equal(isUnsupportedLauncher(details.command), true);
  assert.equal(isUnsupportedLauncher("/home/deck/Apps/Heroic.AppImage"), true);
  assert.equal(isUnsupportedLauncher("/home/deck/Games/game.exe"), false);
  assert.equal(isUnsupportedLauncher(""), false);
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

test("detected words keep Steam's quotes and a shell-read value keeps its name", () => {
  const { unrecognized, LaunchOptions } = loadDomain();
  const source = `WINEDLLOVERRIDES="version=n,b" PROTON_REMOTE_DEBUG_CMD=~/"DeckyGCM/.gcm.bat 'a b.exe'" %command%`;
  assert.deepEqual([...unrecognized(source, [])], [`WINEDLLOVERRIDES="version=n,b"`]);
  const trainer = LaunchOptions.parse(source).segments()[1];
  assert.equal(trainer.name, "PROTON_REMOTE_DEBUG_CMD");
  assert.equal(trainer.definition, undefined);
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

test("launcher commands pass programs in order as Windows paths and read back", () => {
  const { launcherCommand, launcherPrograms, setTrainerCommand, trainerCommand, LaunchOptions } = loadDomain();
  const script = "/home/deck/homebrew/settings/DeckyGCM/launch.bat";
  const programs = ["/home/deck/DeckyGCM/[风灵]《游戏》修改器 [1]/Trainer.exe", "/home/deck/it's/b.exe"];
  const commandValue = launcherCommand(script, programs);
  assert.ok(commandValue.startsWith(`${script} 'Z:\\home\\deck\\DeckyGCM\\`), commandValue);
  const updated = setTrainerCommand("MANGOHUD=1 %command%", commandValue, ["/home/deck/homebrew/settings/DeckyGCM", "/home/deck/DeckyGCM"]);
  assert.deepEqual([...launcherPrograms(trainerCommand(updated), script)], programs);
  assert.equal(LaunchOptions.parse(updated).getEnvironment("PRESSURE_VESSEL_FILESYSTEMS_RW"), undefined);
  // An older value naming one program directly still reads as that program.
  assert.deepEqual([...launcherPrograms("/home/deck/My Trainer/Trainer.exe", script)], ["/home/deck/My Trainer/Trainer.exe"]);
  assert.deepEqual([...launcherPrograms(undefined, script)], []);
  for (const bad of ["relative.exe", "/home/deck/100%.exe", '/home/deck/"x".exe', "/a:b.exe"]) {
    assert.throws(() => launcherCommand(script, [bad]), /valid/);
  }
});

test("a command path matches whether written with ~, $HOME or the home directory itself", () => {
  const { setOptionEnabled, isOptionEnabled, unrecognized, LaunchOptions } = loadDomain();
  const context = { home: "/home/deck" };
  const mako = { id: "preset-mako", name: "", preset: "mako", definitions: ["~/.local/bin/mako-run"] };
  for (const written of ["/home/deck/.local/bin/mako-run", "/var/home/deck/.local/bin/mako-run", "$HOME/.local/bin/mako-run",
    "${HOME}/.local/bin/mako-run", '"$HOME"/.local/bin/mako-run', "'/home/deck/.local/bin/mako-run'"]) {
    const source = `${written} %command%`;
    assert.equal(isOptionEnabled(source, mako, context), true, written);
    assert.deepEqual([...unrecognized(source, [mako], context.home)], [], written);
    // Turning it on again must not run the wrapper twice.
    assert.equal(setOptionEnabled(source, mako, true, context), source, written);
    assert.equal(setOptionEnabled(source, mako, false, context), "", written);
  }
  // A new entry is written as ~/...
  assert.equal(setOptionEnabled("", mako, true, context), "~/.local/bin/mako-run %command%");
  assert.equal(isOptionEnabled("/home/other/.local/bin/mako-run %command%", mako, context), false);
  assert.equal(LaunchOptions.parse("/home/deckx/mako-run %command%", context).isEnabled({ kind: "prefix", command: "~/mako-run", argv: [] }), false);
});

test("one saved option may hold several words", () => {
  const { parseLaunchOptionDefinitions, renderLaunchOptionDefinition, setOptionEnabled, isOptionEnabled } = loadDomain();
  const render = text => { const list = parseLaunchOptionDefinitions(text); return list && [...list.map(renderLaunchOptionDefinition)]; };
  assert.deepEqual(render("-novid -console"), ["-novid", "-console"]);
  assert.deepEqual(render("A=1 B=2"), ["A=1", "B=2"]);
  assert.deepEqual(render("A=1 -w 1280 -novid"), ["A=1", "-w 1280", "-novid"]);
  assert.deepEqual(render("A=1 gamemoderun -x"), ["A=1", "gamemoderun -x"]);
  assert.deepEqual(render("A=1 gamescope -- %command% -novid"), ["A=1", "gamescope", "-novid"]);
  for (const bad of ["", "a | b", "A=1 B=2 > x", "%command% bare"]) assert.equal(parseLaunchOptionDefinitions(bad), undefined, bad);
  const option = { id: "x", name: "", definitions: render("A=1 -novid -console") };
  const on = setOptionEnabled("", option, true);
  assert.equal(on, "A=1 %command% -novid -console");
  assert.equal(isOptionEnabled(on, option), true);
  assert.equal(setOptionEnabled(on, option, false), "");
});

test("wrappers are chained without -- and each one is turned off alone", () => {
  const { setOptionEnabled, isOptionEnabled, unrecognized, detectedOption, LaunchOptions } = loadDomain();
  const lsfg = { id: "preset-lsfg", name: "", preset: "lsfg", definitions: ["~/lsfg"] };
  const mako = { id: "preset-mako", name: "", preset: "mako", definitions: ["~/.local/bin/mako-run"] };
  const canonical = text => LaunchOptions.parse(text).canonical();
  const both = setOptionEnabled("A=1 gamemoderun %command% -novid", lsfg, true);
  assert.equal(both, "A=1 ~/lsfg gamemoderun %command% -novid");
  assert.deepEqual([...unrecognized(both, [lsfg])], ["A=1", "gamemoderun", "-novid"]);
  const gamemode = detectedOption("gamemoderun %command%", [lsfg], "42");
  assert.equal(gamemode.id, "detected-42");
  assert.equal(isOptionEnabled(both, gamemode), true);
  assert.equal(canonical(setOptionEnabled(both, lsfg, false)), "A=1 gamemoderun %command% -novid");
  assert.equal(canonical(setOptionEnabled(both, gamemode, false)), "A=1 ~/lsfg %command% -novid");
  const three = setOptionEnabled(both, mako, true);
  assert.equal(three, "A=1 ~/.local/bin/mako-run ~/lsfg gamemoderun %command% -novid");
  assert.equal(canonical(setOptionEnabled(three, lsfg, false)), "A=1 ~/.local/bin/mako-run gamemoderun %command% -novid");
  // Values written with -- by earlier versions still read and come apart cleanly.
  assert.equal(canonical(setOptionEnabled("~/lsfg -- gamemoderun %command%", lsfg, false)), "gamemoderun %command%");
  assert.equal(detectedOption("~/lsfg %command%", [lsfg], "42"), undefined);
});

test("the language row reads both variables and any spelling of a listed locale", () => {
  const { readCommon, knownLanguage } = loadDomain();
  const state = readCommon("LANG=zh_CN.utf8 %command%");
  assert.equal(state.language, "zh_CN.utf8");
  assert.equal(state.hostLanguage, undefined);
  assert.equal(knownLanguage("zh_CN.utf8"), "zh_CN.UTF-8");
  assert.equal(knownLanguage("xx_YY.UTF-8"), undefined);
});

test("library programs are passed relative to the launcher and the home directory is written as ~", () => {
  const { setTrainerCommand, launcherCommand, launcherPrograms, trainerCommand, LaunchOptions } = loadDomain();
  const home = "/home/deck";
  // SteamOS-like: the script path is resolved through /var/home.
  const script = "/var/home/deck/DeckyGCM/.gcm.bat";
  const legacy = "/home/deck/homebrew/settings/DeckyGCM/launch.bat";
  const programs = ["/var/home/deck/DeckyGCM/[风灵]《游戏》修改器 [1]/Trainer.exe", "/data/it's/b.exe"];
  const value = setTrainerCommand("MANGOHUD=1 %command%", launcherCommand(script, programs),
    ["/var/home/deck/DeckyGCM", "/data/it's"], { script, scripts: [legacy], home });
  assert.equal(value, String.raw`MANGOHUD=1 PRESSURE_VESSEL_FILESYSTEMS_RW="/data/it's" PROTON_REMOTE_DEBUG_CMD=~/"DeckyGCM/.gcm.bat`
    + String.raw` '[风灵]《游戏》修改器 [1]\Trainer.exe' \"Z:\data\it's\b.exe\"" %command%`);
  // Programs come back resolved against the script's folder.
  assert.deepEqual([...launcherPrograms(trainerCommand(value, home), script, legacy)], programs);
  // The value stays editable: switching away removes it and its folder.
  const cleared = setTrainerCommand(value, undefined, undefined, { script, scripts: [legacy], home });
  assert.equal(cleared, "MANGOHUD=1 %command%");
  assert.equal(LaunchOptions.parse(cleared).getEnvironment("PROTON_REMOTE_DEBUG_CMD"), undefined);
  // Launch options written for the old script still read as their programs.
  const old = String.raw`PROTON_REMOTE_DEBUG_CMD="` + legacy + String.raw` 'Z:\home\deck\DeckyGCM\A\a.exe'" %command%`;
  assert.deepEqual([...launcherPrograms(trainerCommand(old, home), script, legacy)], ["/home/deck/DeckyGCM/A/a.exe"]);
  // A library outside the home directory keeps its full path.
  assert.ok(setTrainerCommand("", launcherCommand("/run/media/deck/SD/GCM/.gcm.bat", ["/run/media/deck/SD/GCM/A/a.exe"]))
    .startsWith(String.raw`PROTON_REMOTE_DEBUG_CMD="/run/media/deck/SD/GCM/.gcm.bat 'A\a.exe'"`));
  assert.throws(() => launcherCommand(script, [String.raw`/home/deck/back\slash.exe`]), /valid/);
});
