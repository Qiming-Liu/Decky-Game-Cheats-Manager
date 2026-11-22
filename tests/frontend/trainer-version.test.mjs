import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../src/domain/trainer.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports });
const { installedVersion, activeVersion } = module.exports;

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
