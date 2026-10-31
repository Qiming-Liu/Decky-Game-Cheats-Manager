#!/usr/bin/env bash
# One privileged session owns setup and cleanup, including after its SSH TTY closes.
set -euo pipefail
if (( EUID != 0 )); then exec sudo -- bash "$0"; fi
GUEST_UID="${SUDO_UID:?Start this script as the SSH user}"
GUEST_HOME="$(getent passwd "$GUEST_UID" | cut -d: -f6)"
DEV="/tmp/decky-gcm-dev-$GUEST_UID"
PLUGIN="$GUEST_HOME/homebrew/plugins/DeckyGCM"
OVERRIDE="/etc/systemd/system/plugin_loader.service.d/90-gcm-remote-dev.conf"
ENTRIES=(dist py_modules main.py package.json plugin.json)
test ! -L "$DEV" && [[ $(stat -c %u "$DEV") == "$GUEST_UID" ]]
exec 9>"$DEV/session.lock"
flock -n 9 || { echo '[dev] Another development session is running.' >&2; exit 1; }
test -d "$PLUGIN" || { echo '[dev] Install the ZIP first.' >&2; exit 1; }
linked=0
cleanup() {
    trap - EXIT HUP INT TERM
    set +e
    echo '[dev] Restoring the installed plugin…'
    if (( linked )); then
        systemctl stop plugin_loader
        for name in "${ENTRIES[@]}"; do
            target="$PLUGIN/$name"
            backup="$target.dev-backup"
            if [[ -L "$target" && $(readlink "$target") == "$DEV/current/$name" ]]; then
                rm -- "$target"
                if [[ -e "$backup" || -L "$backup" ]]; then mv -- "$backup" "$target"; fi
            elif [[ ! -e "$target" && ! -L "$target" && ( -e "$backup" || -L "$backup" ) ]]; then
                mv -- "$backup" "$target"
            fi
        done
        rm -f -- "$OVERRIDE"
        systemctl daemon-reload
        systemctl start plugin_loader
    fi
}
trap cleanup EXIT
trap 'exit 0' HUP INT TERM

backend_signature() {
    if [[ -d "$DEV/current/py_modules" ]]; then
        find "$DEV/current/py_modules" "$DEV/current/main.py" "$DEV/current/package.json" "$DEV/current/plugin.json" -type f ! -name '*.pyc' ! -path '*/__pycache__/*' -print0 | sort -z | xargs -0 sha256sum | sha256sum
    fi
}

reload_after_start() {
    # Decky v3 waits ten seconds before enabling its watcher. A service
    # restart alone can leave Steam running the previous frontend module.
    sleep 11
    touch -h -- "$PLUGIN/main.py"
}

apply_pending() {
    [[ -f "$DEV/pending" ]] || return 0
    mv -- "$DEV/pending" "$DEV/processing"
    IFS= read -r incoming < "$DEV/processing"
    [[ "$incoming" == "$DEV"/.upload.* && -d "$incoming" && ! -L "$incoming" ]] || { echo '[dev] Invalid upload path.' >&2; exit 1; }
    mkdir -p "$DEV/current"
    previous=$(backend_signature)
    # Keep the mirror stable. Vendor is omitted on ordinary edits, so retain
    # it while removing deleted source files.
    rsync -rc --delete --exclude='/py_modules/_vendor/' "$incoming/" "$DEV/current/"
    if [[ -d "$incoming/py_modules/_vendor" ]]; then
        mkdir -p "$DEV/current/py_modules/_vendor"
        rsync -rc --delete "$incoming/py_modules/_vendor/" "$DEV/current/py_modules/_vendor/"
    fi
    current=$(backend_signature)
    rm -rf -- "$incoming"
    rm -f -- "$DEV/processing"
    if (( linked )) && [[ "$previous" != "$current" ]]; then
        echo '[dev] Backend changed; restarting Decky…'
        systemctl restart plugin_loader
        reload_after_start
    elif (( linked )); then
        # Decky's recursive watcher does not follow our dist symlink, and
        # rsync publishes files by rename. Notify it through the main.py link
        # in the watched plugin directory, after the whole upload is applied.
        # -h changes the link itself rather than its unwatched /tmp target.
        touch -h -- "$PLUGIN/main.py"
        echo '[dev] Frontend synchronized; Decky live reload requested.'
    fi
}

apply_pending
[[ -f "$DEV/current/main.py" ]] || { echo '[dev] Initial source upload is missing.' >&2; exit 1; }
systemctl stop plugin_loader
linked=1
for name in "${ENTRIES[@]}"; do
    target="$PLUGIN/$name"
    backup="$target.dev-backup"
    if [[ -L "$target" && $(readlink "$target") == "$DEV/current/$name" ]]; then continue; fi
    [[ ! -e "$backup" && ! -L "$backup" ]] || { echo "[dev] Existing backup requires recovery: $backup" >&2; exit 1; }
    if [[ -e "$target" || -L "$target" ]]; then mv -- "$target" "$backup"; fi
    ln -s -- "$DEV/current/$name" "$target"
done
mkdir -p -- "$(dirname "$OVERRIDE")"
printf '[Service]\nEnvironment=LIVE_RELOAD=1\n' | tee "$OVERRIDE" >/dev/null
systemctl daemon-reload
systemctl start plugin_loader
reload_after_start
touch "$DEV/heartbeat"
chown "$GUEST_UID" "$DEV/heartbeat"
echo '[dev] Live session ready. Source changes sync automatically; Ctrl+C restores the installed version.'
while sleep 1; do
    if (( $(date +%s) - $(stat -c %Y "$DEV/heartbeat") > 60 )); then
        echo '[dev] Host heartbeat expired.'
        exit 1
    fi
    apply_pending
done
