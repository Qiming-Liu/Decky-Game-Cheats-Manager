# AGENTS.md

Notes for an AI coding agent working in this repo. See [README.md](README.md) for what the
plugin does. Project structure, dev loop and conventions are deliberately the same as
[CreamDeck](https://github.com/Qiming-Liu/CreamDeck) — its AGENTS.md has the long-form notes on
on-device testing (CDP on `127.0.0.1:8080`, `pnpm dev`, Big Picture layout gotchas), and they
apply here unchanged.

## Commands

```bash
git submodule update --init
pnpm install
bash scripts/vendor_deps.sh            # Python deps → py_modules/_vendor (git-ignored)
python scripts/build_gcm_core.py        # required before direct backend tests
pnpm run build                         # generates GCM core + rollup → dist/index.js
pnpm run typecheck                     # tsc --noEmit
node --test tests/frontend/*.test.mjs tests/tooling/*.test.mjs             # frontend domain and integration checks
python -m unittest discover -s tests -v
pnpm dev                               # local build → SSH sync → VM live session
```

Run the typecheck and unit tests after every change. Keep test coverage focused on
authentication, data integrity, installation/shutdown, and menu cleanup. Avoid tests
that duplicate upstream behavior or assert implementation details.

## Architecture

- `main.py` — Decky `Plugin` class, the RPC surface the frontend calls via `callable()`.
- `scripts/build_gcm_core.py` — generates ignored `_gcm_core` modules from explicit
  upstream AST nodes, validating dependencies. Never edit `gcm/` or generated files.
- `py_modules/gcm_bridge.py`, `gcm_runtime.py` — generated-core loading and the narrow
  Decky platform boundary. Do not install fake global `config`/`PyQt6` modules.
- `py_modules/trainer_search.py` — serialized upstream search invocation, detached results
  and Decky IDs; business logic lives in the generated GCM worker.
- `py_modules/http_download.py` — invokes upstream retries/ranges/cache logic; validates
  database JSON before publishing. Preserve archive extraction/installation safeguards.
- `py_modules/trainer_db.py` — local copy of GCM's database JSONs (`<settings>/db/`).
- `py_modules/trainer_download.py` — `DownloadManager` owns jobs and workers; download/extract into same-filesystem
  staging and atomically publish complete installations. Limit concurrent jobs to two;
  shutdown signals cancellation and waits for workers. Metadata is written before the
  final rename; committed jobs remain successful if temporary cleanup fails. Jobs keep
  their original staging destination, then publish to the latest library path;
  reject stale displayed directories on download requests.
  Job identity includes the catalog version. Public job records are detached snapshots.
  Hashing and cross-filesystem copying run outside the job lock; final metadata and
  rename share the lock with cancellation and game-association updates.
- `py_modules/trainer_library.py` — persistent shared folder setting, existing-file scans,
  per-trainer metadata and App ID/name filtering. Folder selection migrates completed
  files without overwriting conflicts; keep active download staging in place.
- `py_modules/library_storage.py`, `library_transactions.py` — atomic JSON writes,
  cleanup, staged migration, import and publication. The library facade owns the
  transaction lock. Acquire the library lock before the download job lock during
  publication; never acquire them in reverse order.
- `py_modules/trainer_cache.py` — verified deleted-file cache in owned `.gcm-trash/`.
  Migrate only recognized legacy `trash/` records; preserve ordinary user files.
- `py_modules/trainer_archive.py` — bounded extraction with path/link validation. ZIP uses
  stdlib, 7z/RAR use vendored libarchive-c plus the device's native libarchive.
- `py_modules/steam_library.py`, `vdf_lite.py` — Steam manifest lookup adapted from CreamDeck,
  using Decky's actual user home, including additional Steam libraries.
- `py_modules/data_source.py` — singleton authentication loader and sanitized status/errors.
- `py_modules/gcm_auth_adapter.py` — adapts supplied signer AST without Windows imports.
  Preserve canonical/HMAC/renewal algorithms. `gcm_auth_platform.py` owns private local
  identity/credential storage; `gcm_transport.py` handles TLS and error redaction.
- Raw and generated authentication configurations are Git-ignored. Never print keys,
  credentials, enrollment responses or signed URLs. Tests use the sanitized fixture only.
- `src/hooks/useLibrary.ts`, `useDownloads.ts` — cross-page invalidation and one shared
  download poller. Keep filters and expanded rows local to each page.
- `src/hooks/useSidecar.ts` — launch-option state and trainer selection; keep Steam
  parsing and guarded writes in `src/domain/sidecar.ts`. Frontend trainer actions
  use named request fields through `src/utils/backend.ts`.
- `src/index.tsx` — Quick Access panel (`TrainerSearch`) and the `/game-cheats-manager/:appid`
  route opened from the library context menu (`src/patch.tsx`, from CreamDeck/CheatDeck).

Decky's bundled Python is CPython 3.14 with no pip; third-party packages ship vendored in
`py_modules/_vendor` (built in CI by `scripts/vendor_deps.sh`, never committed).

## Commit style

Concise imperative title (~70 chars), blank line, prose paragraphs explaining *why*.

## VM development

See `scripts/DEV.md`. `pnpm dev` starts the dependency-free Node host watcher directly;
`dev-session.sh` runs in one remote SSH TTY, owns sudo, symlinks and cleanup. VM
connection settings live in ignored `.env`; private keys and cached Linux
wheels live in ignored `.decky-dev/`. Never store passwords in either location.
The guest source mirror is under `/tmp/decky-gcm-dev-<uid>` to avoid filling its
system partition. Keep the watched `dist` directory stable during synchronization.

## Project language

Use English for all project-authored content, including documentation, code comments,
UI text, error messages, and commit messages. Preserve external identifiers and data
when their exact values are required for correct behavior.

## Steam / Decky CDP debugging

### Connection

The user-provided topology exposes Steam's guest-loopback CDP endpoint through an
SSH local forward:

```text
Host 127.0.0.1:18080 -> SSH -> Guest 127.0.0.1:8080
```

Reuse the existing tunnel. No VirtualBox port-forwarding change is needed. If the
tunnel must be recreated, use the existing SSH host configuration and authentication:

```powershell
# Replace the placeholder with the existing SSH host alias before running.
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18080:127.0.0.1:8080 <existing-ssh-host>
```

If the local port is already listening, inspect the existing connection before
starting another tunnel. Do not close the user's existing tunnel when finished.

### Inspect the endpoint and targets

Run on the Windows host in PowerShell:

```powershell
Invoke-RestMethod 'http://127.0.0.1:18080/json/version' -TimeoutSec 8
$targets = Invoke-RestMethod 'http://127.0.0.1:18080/json/list' -TimeoutSec 8
$targets | ForEach-Object {
    $_ | Select-Object id, title, type, url, webSocketDebuggerUrl
}
netstat -ano -p tcp | Select-String ':18080'
```

Use the current `webSocketDebuggerUrl` from `/json/list`; do not cache target IDs.
If it advertises the guest address, replace only the WebSocket host and port with
`127.0.0.1:18080`, preserving the path and target ID.

| Target | Purpose |
| --- | --- |
| `SharedJSContext` | Steam's shared JS context; inspect Decky globals and loaded plugins |
| Steam Big Picture (localized title) | Big Picture page and screenshots |
| `QuickAccess_uid2` | Quick Access menu |
| `MainMenu_uid2` | Main menu |
| `notificationtoasts_uid2` | Notification popups |

Copy localized titles from the current target list when selecting a target. Do not
infer page content from its URL alone: Big Picture and popup targets may use
`about:blank?...` URLs.

### Read-only JavaScript checks

Define this function in host PowerShell. It uses .NET without external packages:

```powershell
function Invoke-SteamCdpRead {
    param([string]$Title='SharedJSContext', [string]$Expression)
    $ErrorActionPreference='Stop'
    $targets=Invoke-RestMethod 'http://127.0.0.1:18080/json/list' -TimeoutSec 10
    $target=@($targets | Where-Object title -eq $Title)[0]
    if (!$target) { throw "Target missing: $Title" }
    $ws=[System.Net.WebSockets.ClientWebSocket]::new()
    $cts=[System.Threading.CancellationTokenSource]::new(15000)
    try {
        [void]$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl,$cts.Token).GetAwaiter().GetResult()
        $msg=@{id=1;method='Runtime.evaluate';params=@{
            expression=$Expression;returnByValue=$true;throwOnSideEffect=$true;timeout=5000
        }} | ConvertTo-Json -Depth 12 -Compress
        $bytes=[Text.Encoding]::UTF8.GetBytes($msg)
        [void]$ws.SendAsync([ArraySegment[byte]]::new($bytes),[System.Net.WebSockets.WebSocketMessageType]::Text,$true,$cts.Token).GetAwaiter().GetResult()
        do {
            $stream=[IO.MemoryStream]::new()
            do {
                $buffer=New-Object byte[] 65536
                $received=$ws.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cts.Token).GetAwaiter().GetResult()
                $stream.Write($buffer,0,$received.Count)
            } until ($received.EndOfMessage)
            $response=[Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
            $stream.Dispose()
        } until ($response.id -eq 1)
        $response | ConvertTo-Json -Depth 30
    } finally { $ws.Dispose(); $cts.Dispose() }
}

Invoke-SteamCdpRead -Expression 'JSON.stringify({title:document.title,deckyHasLoaded:globalThis.deckyHasLoaded})'
Invoke-SteamCdpRead -Expression 'JSON.stringify(DeckyPluginLoader.plugins.map(p=>({name:p.name,version:p.version})))'
```

The default target is `SharedJSContext`. Use `-Title` for another title taken from
the current target list. The function sends this CDP request:

```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": {
    "expression": "JSON.stringify({deckyHasLoaded:globalThis.deckyHasLoaded})",
    "returnByValue": true,
    "throwOnSideEffect": true,
    "timeout": 5000
  }
}
```

Match responses by `id`, assemble WebSocket fragments through `EndOfMessage`, then
parse JSON. Inspect the top-level `error` and `result.exceptionDetails`; receiving
a response does not prove evaluation succeeded. String results from the expressions
above are in `result.result.value`.

Keep object inspection narrow:

```javascript
Object.keys(globalThis).filter(k => /decky|plugin/i.test(k))
Object.keys(DeckyPluginLoader)
DeckyPluginLoader.plugins.map(p => ({name:p.name,version:p.version}))
```

Do not dump authentication data. In particular, do not read or print
`deckyAuthToken`, complete backend connection objects, storage values, or credentials.

### Screenshots, console, network, and React

The following are follow-up debugging methods; they were not all exercised during
the verification below. `Invoke-SteamCdpRead` supports only `Runtime.evaluate`.
Use a separate CDP client or extend the helper for other methods.

- Screenshots: connect to the Big Picture target and send `Page.captureScreenshot`
  with `{"format":"png"}`. Decode `result.data` from Base64 to PNG. A screenshot
  does not require `Page.bringToFront`, navigation, or clicks.
- Console: send `Runtime.enable` on the selected target and listen for
  `Runtime.consoleAPICalled` and `Runtime.exceptionThrown`. Capture coverage begins
  when attached; historical logs are not guaranteed.
- Network: send `Network.enable` and listen for `Network.requestWillBeSent`,
  `Network.responseReceived`, and `Network.loadingFailed`. Record relevant traffic
  only; avoid exporting authentication headers or sensitive response bodies. Do not
  automatically reload the page to collect traffic.
- React: identify the target containing the UI, then inspect the relevant DOM
  node's React fiber properties or an existing `__REACT_DEVTOOLS_GLOBAL_HOOK__`.
  Internal properties vary by version. Do not assume fixed fiber fields or directly
  modify props/state during read-only inspection.
- UI actions: use `Input.dispatchMouseEvent` or `Input.dispatchKeyEvent` when needed
  for reproduction. First record the current screen, target, and expected result.
  Read-only verification does not click, navigate, or reload plugins.

Close CDP WebSockets created for the investigation when finished. Leave Steam and
the user's existing SSH connection running.

### Verified snapshot (2026-10-31)

These observations describe that verification session. Re-query them in later
tasks rather than treating them as permanent configuration:

- Host `127.0.0.1:18080` was reachable; its listening PID belonged to `ssh`.
- `/json/version` reported `Chrome/126.0.6478.183`, protocol `1.3`, and a user agent
  containing `Valve Steam Client`.
- `/json/list` returned six targets: the five categories above and a
  `data:text/html,...` page.
- Read-only JavaScript executed through WebSocket in `SharedJSContext` confirmed
  `deckyHasLoaded === true`.
- `DeckyPluginLoader.plugins` returned `Decky Game Cheats Manager`, version `0.1.1`.
- The earlier name/version, `Game Cheats Manager` / `0.1.0-dev.20261031.1`, no longer
  described the loaded plugin at verification time.
- The historical screenshot at
  `C:\Users\Administrator\AppData\Local\Temp\opencode\steam_vm.png` existed and
  displayed the Steam Big Picture home screen. It is not a live view.
- Verification did not modify the UI, deploy the plugin, or close the tunnel.

Host-side CDP responses alone do not independently establish that the guest listens
only on loopback, the exact SSH forwarding destination, whether VirtualBox settings
were previously changed, or which command deployed the plugin. Inspect guest
listeners, SSH launch arguments, and actual VM configuration when those facts matter.

### Troubleshooting

- Connection refused: check the `18080` listener and existing tunnel before checking
  guest Steam/CDP. Do not immediately change VirtualBox configuration.
- Stale WebSocket target: fetch `/json/list` again and select by current title.
- Missing Decky globals: confirm `SharedJSContext`, check whether loading is still
  in progress, and report the actual exception.
- Unexpected plugin name/version: use runtime `DeckyPluginLoader.plugins` as the
  evidence. Local source, a successful build, or running a deployment command does
  not establish that Steam loaded that build.
- `throwOnSideEffect` rejected an expression: reduce it to simple field reads.
  Do not automatically remove this restriction for read-only verification.
- PowerShell target arrays: expand with `ForEach-Object` before `Select-Object` to
  avoid selecting fields from the array itself and producing null values.
- During verification, the host `node` command had no active version and `python`
  was unavailable. Prefer PowerShell/.NET for basic CDP checks instead of installing
  unrelated dependencies.
