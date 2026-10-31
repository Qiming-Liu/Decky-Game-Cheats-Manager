import { spawn, spawnSync } from "node:child_process";
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
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
  for (const name of ["src", "main.py", "py_modules", "requirements.txt", "package.json", "rollup.config.js", "scripts/build_gcm_core.py", "gcm/src/scripts", "scripts/dev-session.sh"]) visit(path.join(repo, name));
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

async function main() {
  const env = loadDevEnv(repo);
  const host = env.DECKY_HOST;
  const port = Number(env.DECKY_PORT || 22);
  if (!host || !/^[a-zA-Z0-9_.@:[\]-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Set DECKY_HOST and DECKY_PORT in .env (SSH key login required).');
  }
  const python = env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const ssh = executable("ssh");
  const tar = executable("tar");
  const sshArgs = ["-p", String(port), "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3"];
  if (env.DECKY_SSH_IDENTITY) sshArgs.push("-i", localPath(env.DECKY_SSH_IDENTITY));
  if (env.DECKY_SSH_KNOWN_HOSTS) sshArgs.push("-o", `UserKnownHostsFile=${localPath(env.DECKY_SSH_KNOWN_HOSTS)}`);
  const remote = (command, options = {}) => run(ssh, [...sshArgs, host, command], options);
  fs.mkdirSync(cache, { recursive: true });
  const probe = spawnSync(ssh, [...sshArgs, host, `set -e; test -d "$HOME/homebrew/plugins/DeckyGCM" || { echo 'Install the plugin ZIP first.' >&2; exit 1; }; command -v rsync >/dev/null || { echo 'rsync is required in the VM.' >&2; exit 1; }; grep -aoE 'libpython3\\.[0-9]+' "$HOME/homebrew/services/PluginLoader" | sort -u`], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const version = env.DECKY_PYTHON_VERSION || probe.stdout?.match(/libpython(3\.\d+)/)?.[1];
  if (probe.status !== 0 || !/^3\.\d+$/.test(version || "")) throw new Error("Cannot inspect the VM. Check SSH, installed Decky, rsync and DECKY_PYTHON_VERSION.");
  log(`SSH connected; Decky Python ${version}.`);

  let vendorKey = "";
  let stopping = false;
  let session;
  let busy = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // The remote foreground session owns cleanup and sudo's TTY ticket.
    session?.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  async function synchronize() {
    log("Building GCM core and frontend…");
    await run(process.execPath, ["node_modules/rollup/dist/bin/rollup", "-c"], { env: { ...env, PYTHON: python } });
    if (stopping) return;
    const key = createHash("sha256").update(version).update(fs.readFileSync(path.join(repo, "requirements.txt"))).digest("hex").slice(0, 16);
    const vendor = path.join(cache, `vendor-${key}`);
    const dependenciesChanged = vendorKey !== key;
    if (!fs.existsSync(path.join(vendor, ".ready"))) {
      log("Preparing Linux dependencies for the VM…");
      await run(python, ["-m", "pip", "install", "--target", vendor, "--python-version", version, "--implementation", "cp", "--abi", `cp${version.replace(".", "")}`, "--platform", "manylinux_2_28_x86_64", "--platform", "manylinux2014_x86_64", "--only-binary=:all:", "--no-compile", "-r", "requirements.txt"]);
      fs.writeFileSync(path.join(vendor, ".ready"), "");
    }
    if (stopping) return;
    const stage = fs.mkdtempSync(path.join(cache, "upload-"));
    try {
      copyRuntime(repo, stage, dependenciesChanged ? vendor : null);
      // This metadata lets the receiver keep the frontend's watched directory
      // stable and restart the backend only if Python/dependencies changed.
      const receive = `set -eu; dev="${guest}"; test ! -L "$dev"; if test -e "$dev"; then test "$(stat -c %u "$dev")" = "$(id -u)"; fi; mkdir -p -m 700 "$dev"; incoming=$(mktemp -d "$dev/.upload.XXXXXX"); tar -xf - -C "$incoming"; printf '%s\\n' "$incoming" > "$dev/pending.tmp"; mv "$dev/pending.tmp" "$dev/pending"`;
      await new Promise((resolve, reject) => {
        const sender = spawn(tar, ["-cf", "-", "-C", stage, "."], { stdio: ["ignore", "pipe", "inherit"] });
        const receiver = spawn(ssh, [...sshArgs, host, receive], { stdio: ["pipe", "inherit", "inherit"] });
        sender.stdout.pipe(receiver.stdin);
        let remaining = 2;
        for (const child of [sender, receiver]) {
          child.once("error", reject);
          child.once("exit", (code) => code !== 0 ? reject(new Error("Source synchronization failed")) : --remaining === 0 && resolve());
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

  await synchronize();
  // Upload the session script without putting its contents in a shell command.
  await new Promise((resolve, reject) => {
    const child = spawn(ssh, [...sshArgs, host, `cat > "${guest}/session.sh"`], { stdio: ["pipe", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Could not upload development session")));
    child.stdin.end(fs.readFileSync(path.join(repo, "scripts/dev-session.sh"), "utf8").replace(/\r\n/g, "\n"));
  });
  log("Starting live session; enter the VM's sudo password if prompted. Ctrl+C restores the installed plugin.");
  session = spawn(ssh, [...sshArgs, "-tt", host, `bash "${guest}/session.sh"`], { stdio: "inherit" });
  const heartbeat = setInterval(() => {
    if (!stopping) void remote(`touch "${guest}/heartbeat"`).catch(() => {});
  }, 10000);
  const ended = new Promise((resolve, reject) => { session.once("error", reject); session.once("exit", (code) => { stopping = true; resolve(code); }); });
  let settled = fingerprint();
  let pending = settled;
  let changedAt = 0;
  const timer = setInterval(async () => {
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
      console.error(`[dev] ${error.message}; waiting for the next change/retry.`);
    } finally { busy = false; }
  }, 500);
  try { await ended; } finally { clearInterval(timer); clearInterval(heartbeat); stop(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[dev] ${error.message}`); process.exitCode = 1; });
}
