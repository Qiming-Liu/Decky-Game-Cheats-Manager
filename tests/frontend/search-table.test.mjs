import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./support/load.mjs";

// Values made inside the loader belong to another realm: compare their contents.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

const { rankResults, databaseDate } = load("src/domain/search");
const table = load("src/domain/table");

test("results for the searched game come first and ties keep the database order", () => {
  const results = [
    { game_name: "Portal Knights", trainer_name: "a" },
    { game_name: "Other", trainer_name: "《传送门》 Trainer" },
    { game_name: "Portal", trainer_name: "b" },
    { game_name: "Unrelated", trainer_name: "c" },
    { game_name: "Portal", trainer_name: "d" },
  ];
  same(rankResults(results, ["portal!", undefined]).map(item => item.trainer_name), ["b", "d", "a", "《传送门》 Trainer", "c"]);
  assert.equal(rankResults(results, ["传送门"])[0].game_name, "Other");
  same(rankResults(results, []), results);
});

test("the database date is the newest file, or nothing", () => {
  assert.equal(databaseDate(undefined), "");
  assert.equal(databaseDate({ files: { a: null, b: "x" } }), "");
  const stamp = new Date(2026, 10, 5, 12).getTime() / 1000;
  assert.equal(databaseDate({ files: { a: 1, b: stamp } }), "11-05");
});

const entry = (id, desc, extra = {}) => ({ id, desc, group: false, displayOnly: false, active: false, children: [], ...extra });
const entries = [
  entry(1, "Player", { group: true, children: [entry(2, "Health", { active: true }), entry(3, "Ammo")] }),
  entry(4, "Notes", { displayOnly: true }),
  entry(5, "Speed", { active: true }),
];

test("groups collapse, and a filter keeps matching entries under their group", () => {
  const descriptions = rows => rows.map(row => `${"-".repeat(row.depth)}${row.entry.desc}`);
  same(descriptions(table.flatten(entries, "", new Set())), ["Player", "-Health", "-Ammo", "Notes", "Speed"]);
  same(descriptions(table.flatten(entries, "", new Set([1]))), ["Player", "Notes", "Speed"]);
  same(descriptions(table.flatten(entries, " AMMO ", new Set([1]))), ["Player", "-Ammo"]);
  assert.equal(table.countOn(entries), 2);
  assert.equal(table.countEntries(entries), 3);
});

test("labels from the table file stay labels in what Cheat Engine reports", () => {
  const labels = table.displayOnlyLabels(entries);
  same([...labels], [[4, "Notes"]]);
  const reported = [entry(4, "Notes"), entry(5, "Speed"), entry(6, "Notes")];
  same(table.withDisplayOnlyEntries(reported, labels).map(item => item.displayOnly), [true, false, false]);
});

test("the bridge status follows what Cheat Engine has answered", () => {
  assert.equal(table.bridgeStatus(null, 5, 20), "starting");
  assert.equal(table.bridgeStatus(null, 20, 20), "noReply");
  assert.equal(table.bridgeStatus({ pid: 0 }, 99, 20), "notAttached");
  assert.equal(table.bridgeStatus({ pid: 42 }, 0, 20), "attached");
  assert.equal(table.isScriptEntry({ type: "script", value: "1" }), true);
  assert.equal(table.isScriptEntry({ type: "4 Bytes", value: "??" }), true);
  assert.equal(table.isScriptEntry({ type: "4 Bytes", value: "100" }), false);
});

test("entry failures keep their reason; an older bridge's reason reads as rejected", () => {
  same(["", "exited", "detached", "error", "value", "rejected", "activate"].map(table.entryFailure),
    [null, "exited", "detached", "error", "value", "rejected", "rejected"]);
});

test("a dropdown keeps its options array until the options change", () => {
  const cache = new Map();
  const entry = { id: 38, options: [{ value: "0", label: "Off" }, { value: "1", label: "On" }] };
  const first = table.dropdownOptions(cache, entry);
  same(first, [{ data: "0", label: "Off" }, { data: "1", label: "On" }]);
  // The next poll sends equal options in new objects: the same array comes back.
  assert.equal(table.dropdownOptions(cache, JSON.parse(JSON.stringify(entry))), first);
  const changed = table.dropdownOptions(cache, { id: 38, options: [{ value: "0", label: "Off" }] });
  assert.notEqual(changed, first);
  same(changed, [{ data: "0", label: "Off" }]);
});
