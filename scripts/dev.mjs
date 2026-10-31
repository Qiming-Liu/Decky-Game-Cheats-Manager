import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { homedir } from "node:os";

const repo = fileURLToPath(new URL("../", import.meta.url));
const cache = path.join(repo, ".decky-dev");
const guest = '/tmp/decky-gcm-dev-$(id -u)';
const log = (message) => console.log(`[dev] ${message}`);

// Own every child, including short-lived heartbeat/upload processes. Closing the
// foreground SSH connection alone does not let Node exit while those are alive.
export function createProcessGroup() {
  const children = new Set();
  let stopped = false;
  return {
    spawn(command, args, options) {
      if (stopped) throw new Error("Development session is stopping");
      const child = spawn(command, args, options);
      children.add(child);
      child.once("close", () => children.delete(child));
      return child;
    },
    stop(except) {
      stopped = true;
      for (const child of children) {
        if (child === except || child.exitCode !== null || child.signalCode !== null) continue;
        child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), 1000);
        force.unref();
        child.once("close", () => clearTimeout(force));
      }
    },
  };
}

function run(group, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = group.spawn(command, args, { cwd: repo, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}

// SSH receives a pipe rather than the host TTY. Node owns raw mode and can
// always restore it, even when SSH or the VM disappears during shutdown.
export function forwardSessionInput(input, output, stop) {
  const wasRaw = input.isRaw;
  if (input.isTTY) input.setRawMode(true);
  const onData = (data) => {
    if (data.includes(3)) stop();
    else if (!output.destroyed && !output.writableEnded) output.write(data);
  };
  const onEnd = () => stop();
  const onError = () => {}; // EPIPE is expected when SSH exits before stdin.
  input.on("data", onData);
  input.once("end", onEnd);
  output.on("error", onError);
  input.resume();
  return () => {
    input.removeListener("data", onData);
    input.removeListener("end", onEnd);
    input.pause();
    if (input.isTTY) input.setRawMode(Boolean(wasRaw));
  };
}

function executable(name) {
  const git = process.platform === "win32" ? [
    path.join(process.env.ProgramFiles || "C:/Program Files", "Git/usr/bin", `${name}.exe`),
    path.join(process.env.USERPROFILE || "", "scoop/apps/git/current/usr/bin", `${name}.exe`),
  ].find((candidate) => fs.existsSync(candidate)) : null;
  return git || name;
}

function fingerprint() {
  const hash = createHash("sha256");
  function visit(target) {
    if (!fs.existsSync(target)) return;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      if (["_vendor", "_gcm_core", "__pycache__"].includes(path.basename(target))) return;
      for (const name of fs.readdirSync(target).sort()) visit(path.join(target, name));
    } else hash.update(`${path.relative(repo, target)}:${stat.size}:${stat.mtimeMs}\n`);
  }
  for (const name of ["src", "main.py", "py_modules", "requirements.txt", "package.json", "rollup.config.js", "scripts/build_gcm_core.py", "gcm/src/scripts", "plugin.json", "scripts/dev-session.sh"]) visit(path.join(repo, name));
  return hash.digest("hex");
}

// Only runtime code is synchronized. Raw secrets, Windows wheels and cache files
// stay on the host; the generated signer is sent through encrypted SSH.
export function copyRuntime(source, destination, vendor) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ["dist", "main.py", "package.json", "plugin.json", "py_modules"]) {
    fs.cpSync(path.join(source, name), path.join(destination, name), {
      recursive: true, preserveTimestamps: true,
      filter: (file) => {
        const relative = path.relative(source, file).split(path.sep);
        return !fs.lstatSync(file).isSymbolicLink() && !relative.some((part) => ["_vendor", "__pycache__", "secret_config.py"].includes(part)) && !file.endsWith(".pyc");
      },
    });
  }
  if (vendor) fs.cpSync(vendor, path.join(destination, "py_modules/_vendor"), { recursive: true });
}

export function loadDevEnv(directory, environment = process.env) {
  const filename = path.join(directory, ".env");
  const local = fs.existsSync(filename) ? parseEnv(fs.readFileSync(filename, "utf8")) : {};
  return { ...local, ...environment };
}

const localPath = (value) => path.resolve(repo, value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value);

export function connectionArgs(env) {
  const host = env.DECKY_HOST;
  const port = env.DECKY_PORT ? Number(env.DECKY_PORT) : null;
  if (!host || host.startsWith("-") || !/^[a-zA-Z0-9_.@:[\]-]+$/.test(host) ||
      (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))) {
    throw new Error('Set a valid DECKY_HOST and optional DECKY_PORT in .env (SSH key login required).');
  }
  // Omitting -p lets OpenSSH use the Port configured for an existing host alias.
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=3", "-o", "ServerAliveCountMax=3"];
  if (port !== null) args.push("-p", String(port));
  if (env.DECKY_SSH_IDENTITY) args.push("-i", localPath(env.DECKY_SSH_IDENTITY));
  if (env.DECKY_SSH_KNOWN_HOSTS) args.push("-o", `UserKnownHostsFile=${localPath(env.DECKY_SSH_KNOWN_HOSTS)}`);
  return args;
}

export async function prepareVendor(directory, key, install) {
  if (!/^[a-f0-9]{16}$/.test(key)) throw new Error("Invalid dependency cache key");
  const target = path.join(directory, `vendor-${key}`);
  if (fs.existsSync(path.join(target, ".ready"))) return target;
  // pip must always start with an empty directory after failure/interruption.
  const stage = fs.mkdtempSync(path.join(directory, "wheels-"));
  try {
    await install(stage);
    fs.writeFileSync(path.join(stage, ".ready"), "");
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink() || path.dirname(fs.realpathSync(target)) !== fs.realpathSync(directory)) {
        throw new Error("Invalid dependency cache path");
      }
      fs.rmSync(target, { recursive: true, force: true });
    }
    fs.renameSync(stage, target);
    return target;
  } finally {
    if (fs.existsSync(stage)) {
      if (path.dirname(fs.realpathSync(stage)) !== fs.realpathSync(directory)) throw new Error("Invalid dependency staging path");
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
}

async function main() {
  const env = loadDevEnv(repo);
  const host = env.DECKY_HOST;
  const sshArgs = connectionArgs(env);
  const python = env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const ssh = executable("ssh");
  const tar = executable("tar");
  const group = createProcessGroup();
  const remote = (command, options = {}) => run(group, ssh, [...sshArgs, host, command], { stdio: "ignore", timeout: 15000, ...options });
  fs.mkdirSync(cache, { recursive: true });

  let vendorKey = "";
  let stopping = false;
  let session;
  let busy = false;
  let timer;
  let heartbeat;
  let shutdownTimer;
  let restoreInput;
  const stop = () => {
    if (stopping) {
      log("Forcing local exit; the guest heartbeat will handle remote cleanup if it is still running.");
      group.stop();
      return;
    }
    stopping = true;
    clearInterval(timer);
    clearInterval(heartbeat);
    group.stop(session);
    if (session && session.exitCode === null && session.signalCode === null) {
      log("Stopping; waiting up to 25 seconds for the installed plugin to be restored. Ctrl+C again forces local exit.");
      // Send Ctrl+C through the remote TTY, preserving SSH until cleanup ends.
      if (!session.stdin.destroyed && !session.stdin.writableEnded) session.stdin.write(Buffer.from([3]));
      shutdownTimer = setTimeout(() => {
        log("Remote cleanup did not finish in time; closing local SSH. Check the guest before shutting it down.");
        group.stop();
      }, 25000);
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    let probeOutput = "";
    await new Promise((resolve, reject) => {
      const child = group.spawn(ssh, [...sshArgs, host, `set -e; test -d "$HOME/homebrew/plugins/DeckyGCM" || { echo 'Install the plugin ZIP first.' >&2; exit 1; }; for tool in rsync timeout flock; do command -v "$tool" >/dev/null || { echo "$tool is required in the VM." >&2; exit 1; }; done; grep -aoE 'libpython3\\.[0-9]+' "$HOME/homebrew/services/PluginLoader" | sort -u`], { stdio: ["ignore", "pipe", "inherit"], timeout: 15000 });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data) => { probeOutput += data; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error("Cannot inspect the VM. Check SSH, installed Decky, rsync, timeout and flock.")));
    });
    const version = env.DECKY_PYTHON_VERSION || probeOutput.match(/libpython(3\.\d+)/)?.[1];
    if (!/^3\.\d+$/.test(version || "")) throw new Error("Cannot detect Decky Python; set DECKY_PYTHON_VERSION.");
    log(`SSH connected; Decky Python ${version}.`);
    async function synchronize() {
      log("Building GCM core and frontend…");
      await run(group, process.execPath, ["node_modules/rollup/dist/bin/rollup", "-c"], { env: { ...env, PYTHON: python } });
      if (stopping) return;
      const key = createHash("sha256").update(version).update(fs.readFileSync(path.join(repo, "requirements.txt"))).digest("hex").slice(0, 16);
      const dependenciesChanged = vendorKey !== key;
      const vendor = await prepareVendor(cache, key, async (stage) => {
        log("Preparing Linux dependencies for the VM…");
        await run(group, python, ["-m", "pip", "install", "--target", stage, "--python-version", version, "--implementation", "cp", "--abi", `cp${version.replace(".", "")}`, "--platform", "manylinux_2_28_x86_64", "--platform", "manylinux2014_x86_64", "--only-binary=:all:", "--no-compile", "-r", "requirements.txt"]);
      });
      if (stopping) return;
      const stage = fs.mkdtempSync(path.join(cache, "upload-"));
      try {
        copyRuntime(repo, stage, dependenciesChanged ? vendor : null);
        // Publish a complete upload before the privileged session applies it.
        const receive = `set -eu; dev="${guest}"; test ! -L "$dev"; if test -e "$dev"; then test "$(stat -c %u "$dev")" = "$(id -u)"; fi; mkdir -p -m 700 "$dev"; incoming=$(mktemp -d "$dev/.upload.XXXXXX"); tar -xf - -C "$incoming"; printf '%s\\n' "$incoming" > "$dev/pending.tmp"; mv "$dev/pending.tmp" "$dev/pending"`;
        await new Promise((resolve, reject) => {
          const sender = group.spawn(tar, ["-cf", "-", "-C", stage, "."], { stdio: ["ignore", "pipe", "inherit"] });
          const receiver = group.spawn(ssh, [...sshArgs, host, receive], { stdio: ["pipe", "inherit", "inherit"] });
          sender.stdout.pipe(receiver.stdin);
          let remaining = 2;
          let failure;
          for (const child of [sender, receiver]) {
            const peer = child === sender ? receiver : sender;
            child.once("error", (error) => { failure = error; peer.kill("SIGTERM"); });
            child.once("close", (code) => {
              if (code !== 0) {
                failure ||= new Error("Source synchronization failed");
                peer.kill("SIGTERM");
              }
              // Do not remove the staging directory while tar still has it open.
              if (--remaining === 0) failure ? reject(failure) : resolve();
            });
          }
          receiver.stdin.on("error", () => {});
        });
        vendorKey = key;
        log("Source synchronized.");
      } finally {
        const resolved = fs.realpathSync(stage);
        if (path.dirname(resolved) !== fs.realpathSync(cache)) throw new Error("Invalid staging path");
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }

    // Retain edits made while the initial build/upload or sudo prompt is running.
    let settled = fingerprint();
    await synchronize();
    // Upload the session script without putting its contents in a shell command.
    await new Promise((resolve, reject) => {
      const child = group.spawn(ssh, [...sshArgs, host, `cat > "${guest}/session.sh"`], { stdio: ["pipe", "inherit", "inherit"] });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Could not upload development session")));
      child.stdin.on("error", () => {});
      child.stdin.end(fs.readFileSync(path.join(repo, "scripts/dev-session.sh"), "utf8").replace(/\r\n/g, "\n"));
    });
    log("Starting live session; enter the VM's sudo password if prompted. Ctrl+C restores the installed plugin.");
    session = group.spawn(ssh, [...sshArgs, "-tt", host, `bash "${guest}/session.sh"`], { stdio: ["pipe", "inherit", "inherit"] });
    restoreInput = forwardSessionInput(process.stdin, session.stdin, stop);
    let heartbeatBusy = false;
    heartbeat = setInterval(() => {
      if (!stopping && !heartbeatBusy) {
        heartbeatBusy = true;
        void remote(`touch "${guest}/heartbeat"`).catch(() => {}).finally(() => { heartbeatBusy = false; });
      }
    }, 10000);
    const ended = new Promise((resolve, reject) => { session.once("error", reject); session.once("exit", resolve); });
    let pending = settled;
    let changedAt = 0;
    timer = setInterval(async () => {
      if (busy || stopping) return;
      busy = true;
      try {
        const current = fingerprint();
        if (current !== pending) { pending = current; changedAt = Date.now(); }
        if (current !== settled && Date.now() - changedAt >= 1000) {
          await synchronize();
          settled = current;
        }
      } catch (error) {
        if (!stopping) console.error(`[dev] ${error.message}; waiting for the next change/retry.`);
      } finally { busy = false; }
    }, 500);
    const code = await ended;
    if (!stopping && code !== 0) throw new Error(`SSH session ended (${code}); the VM may have disconnected.`);
  } catch (error) {
    if (!stopping) throw error;
  } finally {
    stopping = true;
    clearInterval(timer);
    clearInterval(heartbeat);
    clearTimeout(shutdownTimer);
    restoreInput?.();
    group.stop();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[dev] ${error.message}`); process.exitCode = 1; });
}
