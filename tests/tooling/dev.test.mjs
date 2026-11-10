import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { copyRuntime, createProcessGroup, forwardSessionInput, prepareVendor } from "../../scripts/dev.mjs";

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

test("shutdown terminates background children while allowing the session to clean up", { timeout: 5000 }, async () => {
  const group = createProcessGroup();
  const session = group.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const heartbeat = group.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const sessionClosed = once(session, "close");
  const heartbeatClosed = once(heartbeat, "close");
  try {
    await Promise.all([once(session, "spawn"), once(heartbeat, "spawn")]);
    group.stop(session);
    await heartbeatClosed;
    assert.equal(session.exitCode, null);
    assert.equal(session.signalCode, null);
    assert.throws(() => group.spawn(process.execPath, []), /stopping/);
    group.stop();
    await sessionClosed;
  } finally {
    group.stop();
  }
});

test("Ctrl+C reaches the host shutdown handler and terminal raw mode is restored", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  const rawModes = [];
  input.setRawMode = (raw) => { input.isRaw = raw; rawModes.push(raw); };
  let stopped = 0;
  let forwarded = "";
  output.on("data", (data) => { forwarded += data.toString(); });
  const restore = forwardSessionInput(input, output, () => { stopped++; });
  input.write("sudo input\n");
  input.write(Buffer.from([3]));
  input.write(Buffer.from([3]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(forwarded, "sudo input\n");
  assert.equal(stopped, 2);
  restore();
  assert.deepEqual(rawModes, [true, false]);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(input.isPaused(), true);
  input.destroy();
  output.destroy();
});

test("failed dependency installs cannot contaminate the next build or become ready", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-vendor-test-"));
  const key = "0123456789abcdef";
  try {
    const incomplete = path.join(root, `vendor-${key}`);
    fs.mkdirSync(incomplete);
    fs.writeFileSync(path.join(incomplete, "stale.py"), "old");
    await assert.rejects(prepareVendor(root, key, async (stage) => {
      fs.writeFileSync(path.join(stage, "partial.py"), "partial");
      throw new Error("pip failed");
    }), /pip failed/);
    assert.deepEqual(fs.readdirSync(root), [`vendor-${key}`]);
    assert(!fs.existsSync(path.join(incomplete, ".ready")));
    const target = await prepareVendor(root, key, async (stage) => {
      assert.deepEqual(fs.readdirSync(stage), []);
      fs.writeFileSync(path.join(stage, "complete.py"), "complete");
    });
    assert.deepEqual(fs.readdirSync(target).sort(), [".ready", "complete.py"]);
    assert.equal(await prepareVendor(root, key, () => { throw new Error("Cache should be reused"); }), target);
    await assert.rejects(prepareVendor(root, "../outside", () => {}), /Invalid dependency cache key/);
  } finally {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
