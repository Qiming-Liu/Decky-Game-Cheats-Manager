# VM live development

Install the plugin ZIP in Decky once, enable SSH in the VM, and configure SSH key
login from the host. The guest needs `bash`, `rsync`, `sudo`, `flock`, and Decky.
On Windows, run `pnpm dev` using Git Bash (installed with Git) on PATH.

Copy `.env.example` to `.env` and fill in your own SSH destination. `.env` is
Git-ignored and is never synchronized to the VM or included in plugin packages.
The blank template contains no personal hostnames, ports or usernames.

- `DECKY_HOST`: SSH host alias or `user@host`.
- `DECKY_PORT`: SSH port (defaults to the standard SSH port).
- `DECKY_SSH_IDENTITY`: optional SSH private key path.
- `DECKY_SSH_KNOWN_HOSTS`: optional pinned known-hosts file.
- `PYTHON`: optional host Python executable; Python needs pip.
- `DECKY_PYTHON_VERSION`: optional override for guest interpreter detection.

Relative paths are resolved from the repository root; `~/` is supported. Process
environment variables override values in `.env`. Do not store SSH/sudo passwords.
SSH uses a key; sudo may prompt once at startup. Requires Node 20.12 or later.

Run:

```bash
pnpm dev
```

The command checks SSH and Decky, builds the GCM core and frontend, prepares Linux
wheels for the guest's Python, and uploads the source through SSH. A remote TTY
session backs up the installed plugin, creates symlinks to a guest source mirror,
enables `LIVE_RELOAD`, and restarts Decky.

Local edits are debounced for one second, rebuilt and synchronized automatically.
Deleted source files are removed from the mirror. Unchanged files retain their
timestamps. Decky's recursive watcher does not follow the development symlinks,
so after applying an upload the session touches the `main.py` symlink itself
to request Decky's native plugin reload. This also handles rsync's atomic renames.
Python or dependency changes restart Decky; frontend changes use the native plugin
reload, which reloads both the plugin backend and frontend.
Startup and backend restarts wait for Decky's ten-second watcher startup delay
before requesting a reload, so Steam also receives the initial development build.
An already-mounted Steam page can require leaving and reopening the page.

After changing `scripts/dev-session.sh`, restart `pnpm dev` to load the updated
remote session script. Ordinary source edits do not require restarting it.

Ctrl+C or SSH disconnection restores the installed plugin and removes this
session's systemd override. A host heartbeat also ends abandoned sessions. Only
one development session can own the VM plugin at a time. Source and dependency
mirrors use the guest's `/tmp`; each startup repopulates them after reboot.
