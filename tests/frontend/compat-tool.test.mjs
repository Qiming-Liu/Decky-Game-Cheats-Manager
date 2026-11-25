import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./support/load.mjs";

const { isCompatToolUnsupported } = load("src/domain/compatTool");

test("builds bundling Wine Mono 11.2.0 are unsupported", () => {
  for (const name of ["Proton 11.0-2", "Proton 11.0-2e", "Proton Hotfix", "GE-Proton11-2", "GE-Proton11-6",
    "Proton-CachyOS 11.0-20260702", "proton-cachyos-11.0-20260703-slr"]) {
    assert.equal(isCompatToolUnsupported(name), true, name);
  }
});

test("Steam Linux Runtime runs no Proton and is unsupported", () => {
  for (const name of ["Steam Linux Runtime 1.0", "Steam Linux Runtime 3.0", "Steam Linux Runtime 1.0 (scout)"]) {
    assert.equal(isCompatToolUnsupported(name), true, name);
  }
});

test("builds with another Wine Mono stay supported", () => {
  for (const name of ["Proton 10.0-4", "Proton 11.0-1", "Proton 11.0-1b", "Proton Experimental", "GE-Proton11-1",
    "GE-Proton11-7", "GE-Proton11-12", "GE-Proton10-30", "Proton-CachyOS 11.0-20260602", "Proton-CachyOS 11.0-20261005", "", null, undefined]) {
    assert.equal(isCompatToolUnsupported(name), false, String(name));
  }
});
