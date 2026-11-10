import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../src/domain/compatTool.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
const module = { exports: {} };
vm.runInNewContext(outputText, {
  module, exports: module.exports,
  require: name => JSON.parse(readFileSync(new URL(`../../src/domain/${name}`, import.meta.url), "utf8")),
});
const { isCompatToolUnsupported } = module.exports;

test("builds bundling Wine Mono 11.2.0 are unsupported", () => {
  for (const name of ["Proton 11.0-2", "Proton 11.0-2e", "Proton Hotfix", "GE-Proton11-2", "GE-Proton11-6",
    "Proton-CachyOS 11.0-20260702", "proton-cachyos-11.0-20260703-slr"]) {
    assert.equal(isCompatToolUnsupported(name), true, name);
  }
});

test("builds with another Wine Mono stay supported", () => {
  for (const name of ["Proton 10.0-4", "Proton 11.0-1", "Proton 11.0-1b", "Proton Experimental", "GE-Proton11-1",
    "GE-Proton11-7", "GE-Proton11-12", "GE-Proton10-30", "Proton-CachyOS 11.0-20260602", "Proton-CachyOS 11.0-20261005", "", null, undefined]) {
    assert.equal(isCompatToolUnsupported(name), false, String(name));
  }
});
