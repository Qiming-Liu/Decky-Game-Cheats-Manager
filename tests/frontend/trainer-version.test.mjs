import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./support/load.mjs";

const { installedVersion, activeVersion, downloadedVersion, unreadDownloads } = load("src/domain/trainer");

test("an installed version does not prevent downloading another version", () => {
  const trainer = { id: "same-url", version: "2" };
  assert.equal(installedVersion(trainer, [{ trainer_id: trainer.id, version: "1" }]), false);
  assert.equal(installedVersion(trainer, [{ trainer_id: trainer.id, version: "" }]), false);
  assert.equal(installedVersion(trainer, [{ trainer_id: trainer.id, version: "2" }]), true);
});

test("a catalog entry without a version is installed once", () => {
  const trainer = { id: "same-url", version: "" };
  assert.equal(installedVersion(trainer, [{ trainer_id: trainer.id, version: "" }]), true);
  assert.equal(installedVersion(trainer, [{ trainer_id: trainer.id }]), true);
  assert.equal(installedVersion(trainer, [{ trainer_id: "other-url", version: "" }]), false);
});

test("only the active task for the displayed version disables its download", () => {
  const trainer = { id: "same-url", version: "2" };
  const old = { trainer_id: trainer.id, version: "1", state: "downloading" };
  const current = { ...old, version: "2" };
  assert.equal(activeVersion(trainer, [old]), undefined);
  assert.equal(activeVersion(trainer, [old, current]), current);
  assert.equal(activeVersion(trainer, [{ ...current, state: "done" }]), undefined);
});

test("a finished download counts as downloaded until the library has been read again", () => {
  const trainer = { id: "same-url", version: "2" };
  const done = { id: "job", trainer_id: trainer.id, version: "2", state: "done", app_ids: ["42"] };
  const unread = unreadDownloads([done, { ...done, id: "running", state: "downloading" }], "42", new Set());
  assert.deepEqual(unread, [done]);
  assert.equal(downloadedVersion(trainer, [], unread), true);
  // Read again without it (deleted since), or finished for another game: downloadable.
  assert.deepEqual(unreadDownloads([done], "42", new Set(["job"])), []);
  assert.deepEqual(unreadDownloads([done], "43", new Set()), []);
  assert.equal(downloadedVersion(trainer, [], []), false);
  assert.equal(downloadedVersion(trainer, [], [{ ...done, version: "1" }]), false);
  assert.equal(downloadedVersion(trainer, [{ trainer_id: trainer.id, version: "2" }], []), true);
});
