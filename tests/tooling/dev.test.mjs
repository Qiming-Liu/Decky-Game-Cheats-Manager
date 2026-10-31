import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyRuntime } from "../../scripts/dev.mjs";

test("development payload includes generated auth but excludes raw secrets and host wheels", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-dev-test-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  try {
    for (const name of ["dist/index.js", "main.py", "package.json", "plugin.json", "py_modules/backend.py", "py_modules/_gcm_core/auth.py", "py_modules/secret_config.py", "py_modules/_vendor/windows.pyd", "py_modules/__pycache__/backend.pyc"]) {
      fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
      fs.writeFileSync(path.join(source, name), "test");
    }
    copyRuntime(source, target);
    assert(fs.existsSync(path.join(target, "py_modules/_gcm_core/auth.py")));
    assert(!fs.existsSync(path.join(target, "py_modules/secret_config.py")));
    assert(!fs.existsSync(path.join(target, "py_modules/_vendor")));
    assert(!fs.existsSync(path.join(target, "py_modules/__pycache__")));
  } finally {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
