import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./support/load.mjs";

// Values made inside the loader belong to another realm: compare their contents.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

const list = load(["src/domain/trainerList", "src/domain/selection", "src/domain/fileTypes", "src/domain/paths"]);

test("a trainer holds its own files, not those of a folder that starts with its name", () => {
  const trainer = { path: "/lib/Game (1)/Trainer" };
  assert.equal(list.isWithin("/lib/Game (1)/Trainer/a.exe", trainer.path), true);
  assert.equal(list.isWithin("/lib/Game (1)/Trainer 2/a.exe", trainer.path), false);
  assert.equal(list.selectionIndex(trainer, ["/x/b.exe", "/lib/Game (1)/Trainer/a.exe"], true), 1);
  // With one program allowed, only the first one runs.
  assert.equal(list.selectionIndex(trainer, ["/x/b.exe", "/lib/Game (1)/Trainer/a.exe"], false), -1);
  assert.equal(list.selectedProgram(trainer, "a.exe", ["/lib/Game (1)/Trainer/a.exe"], false), "/lib/Game (1)/Trainer/a.exe");
  assert.equal(list.selectedProgram({ path: "/home/deck/a.exe" }, "a.exe", ["/home/deck/a.exe"], false), "/home/deck/a.exe");
});

test("choosing a program replaces the selection unless several may run", () => {
  same(list.withProgram(["/a.exe"], "/b.exe", false), ["/b.exe"]);
  same(list.withProgram(["/a.exe", "/b.exe"], "/a.exe", true), ["/b.exe", "/a.exe"]);
  same(list.withoutTrainer(["/t/a.exe", "/t/b.exe", "/u/c.exe"], { path: "/t" }), ["/u/c.exe"]);
  same(list.sharedFolders("/lib/.gcm.bat", "/lib/CE/Cheat Engine.exe", ["/lib/G/T/a.ct", "/lib/G/T/b.ct"]),
    ["/lib", "/lib/CE", "/lib/G/T"]);
});

test("a selected table reports a missing or replaced Cheat Engine, and programs never do", () => {
  assert.equal(list.engineState(["/t/a.exe"], { installed: false }, false), "");
  assert.equal(list.engineState(["/t/a.CT"], undefined, false), "");
  assert.equal(list.engineState(["/t/a.CT"], { installed: false }, false), "missing");
  assert.equal(list.engineState(["/t/a.cetrainer"], { installed: true }, false), "moved");
  assert.equal(list.engineState(["/t/a.ct"], { installed: true }, true), "");
});

test("file kinds follow the shared extension list", () => {
  assert.equal(list.isTableFile("Table.CT"), true);
  assert.equal(list.isTableFile("Table.ct.bak"), false);
  assert.equal(list.isLaunchableFile("run.BAT"), true);
  assert.equal(list.isLaunchableFile("readme.txt"), false);
  same([...list.PICKER_EXTENSIONS], ["exe", "bat", "ct", "cetrainer"]);
});

test("pages clamp to the last one and mark where the selection is", () => {
  const rows = [1, 2, 3, 4, 5, 6, 7];
  const first = list.pageOf(rows, 0, 5);
  same([first.index, first.count, first.full], [0, 2, true]);
  const last = list.pageOf(rows, 9, 5);
  same([[...last.rows], last.index, last.full], [[6, 7], 1, false]);
  assert.equal(list.pageOf([], 3, 5).count, 1);
  same([...list.pagesWith(rows, row => row === 1 || row === 7, 5)], [0, 1]);
});

test("names sort the way a reader expects", () => {
  const names = list.orderByName([{ name: "Trainer 10" }, { name: "trainer 2" }, { name: "Álpha" }], "en").map(item => item.name);
  same(names, ["Álpha", "trainer 2", "Trainer 10"]);
});

test("download progress stays within 0 and 100", () => {
  assert.equal(list.jobPercent(undefined), 0);
  assert.equal(list.jobPercent({ state: "downloading", downloaded: 0, total: 0 }), 0);
  assert.equal(list.jobPercent({ state: "downloading", downloaded: 1, total: 3 }), 33);
  assert.equal(list.jobPercent({ state: "downloading", downloaded: 9, total: 3 }), 100);
  assert.equal(list.jobPercent({ state: "extracting", downloaded: 0, total: 0 }), 100);
  same(list.jobsWithRows([{ state: "done" }, { state: "cancelled" }, { state: "error" }, { state: "queued" }]).map(job => job.state),
    ["error", "queued"]);
});

test("a table shows Cheat Engine's running download, or else its last failure", () => {
  const job = (id, state, started_at, app_ids = []) => ({ id, state, started_at, app_ids });
  const pick = jobs => list.engineDownload(jobs)?.id;
  // A game's own download is never Cheat Engine's.
  assert.equal(pick([job("game", "downloading", 9, ["42"])]), undefined);
  assert.equal(pick([job("failed", "error", 1), job("running", "queued", 2)]), "running");
  assert.equal(pick([job("old", "error", 1), job("new", "error", 2)]), "new");
  // A failure followed by a finished or cancelled download is over.
  assert.equal(pick([job("failed", "error", 1), job("finished", "done", 2)]), undefined);
});

test("a table offers Cheat Engine, shows its download, or says it failed", () => {
  assert.equal(list.engineOffer(undefined), "offer");
  for (const state of ["queued", "downloading", "extracting"]) assert.equal(list.engineOffer({ state }), "downloading");
  assert.equal(list.engineOffer({ state: "error" }), "failed");
  // A finished or cancelled download leaves the offer as it was.
  assert.equal(list.engineOffer({ state: "done" }), "offer");
  assert.equal(list.engineOffer({ state: "cancelled" }), "offer");
});

test("a finished download is used once, when the library lists it and its table can open", () => {
  const trainers = [{ path: "/lib/T", files: ["a.exe"] }, { path: "/lib/C", files: ["a.ct"] }];
  const job = (id, path, extra = {}) => ({ id, state: "done", path, started_at: 100, ...extra });
  const state = { loadedAt: 50, handled: new Set(), engineInstalled: false };
  assert.equal(list.nextFinishedDownload([job("old", "/lib/T", { started_at: 10 })], trainers, state), undefined);
  assert.equal(list.nextFinishedDownload([job("gone", "/lib/missing")], trainers, state), undefined);
  assert.equal(list.nextFinishedDownload([job("run", "/lib/T", { state: "downloading" })], trainers, state), undefined);
  // The table waits for Cheat Engine; the program behind it is used.
  assert.equal(list.nextFinishedDownload([job("table", "/lib/C"), job("program", "/lib/T")], trainers, state).job.id, "program");
  assert.equal(list.nextFinishedDownload([job("table", "/lib/C")], trainers, { ...state, engineInstalled: true }).job.id, "table");
  assert.equal(list.nextFinishedDownload([job("program", "/lib/T")], trainers, { ...state, handled: new Set(["program"]) }), undefined);
});

test("a row selects, opens, toggles or does nothing", () => {
  const row = { missing: false, programs: 1, needsEngine: false, current: false, tables: 0, engineMoved: false, multiple: false };
  assert.equal(list.rowAction(row), "choose");
  assert.equal(list.rowAction({ ...row, missing: true }), "none");
  assert.equal(list.rowAction({ ...row, current: true }), "none");
  assert.equal(list.rowAction({ ...row, current: true, multiple: true }), "unselect");
  assert.equal(list.rowAction({ ...row, current: true, programs: 2 }), "choose");
  assert.equal(list.rowAction({ ...row, current: true, tables: 1, engineMoved: true }), "choose");
  assert.equal(list.rowAction({ ...row, current: true, tables: 1, engineMoved: true, multiple: true }), "unselect");
  assert.equal(list.needsCheatEngine({ files: ["a.ct"] }, undefined), false);
  assert.equal(list.needsCheatEngine({ files: ["a.ct"] }, { installed: false }), true);
  assert.equal(list.programLabel("/lib/T/a.exe", [{ path: "/lib/T", name: "Trainer" }]), "Trainer");
  assert.equal(list.programLabel("/home/deck/a.exe", []), "a.exe");
});
