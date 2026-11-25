import timing from "./data/timing.json";
import { readLaunchDetails } from "./domain/steam";
import { launcherPrograms, trainerCommand } from "./domain/trainerCommand";
import { checkTrainerLaunch, getGameWindow, getLauncher, getTrainerStatus, logFrontend } from "./utils/backend";

// A trainer or Cheat Engine that opens after the game can take the screen.
// For a while after the start, the game is put back in front the first time
// that happens; later switches are the player's own. A trainer's dialog in
// front (Cheat Engine asking something) is left there: it waits for an answer.
const timers = new Set<number>();

declare const SteamUIStore: { WindowStore: { SetFocusedAppWindowID(appId: number, windowId: number): void } };

function keepGameInFront(appId: string, programs: string[]) {
  const until = Date.now() + timing.game_in_front_seconds * 1000;
  let dialogLogged = false;
  const timer = window.setInterval(async () => {
    try {
      if (Date.now() > until) { stop(); return; }
      const result = await getGameWindow(appId, programs);
      if (result.success && result.dialog_in_front && !dialogLogged) {
        dialogLogged = true;
        logFrontend("info", `A trainer's dialog is in front of app ${appId}; the game stays behind it`);
      }
      if (!result.success || !result.game || !result.trainer_in_front || !timers.has(timer)) return;
      stop();
      SteamUIStore.WindowStore.SetFocusedAppWindowID(Number(appId), result.game);
      logFrontend("info", `Put the game back in front of its trainer for app ${appId}`);
    } catch (error) {
      stop();
      logFrontend("warning", `Putting the game in front for app ${appId} failed`, error);
    }
  }, timing.game_in_front_poll_ms);
  const stop = () => { window.clearInterval(timer); timers.delete(timer); };
  timers.add(timer);
}

// Steam keeps gamescope on the window it was told to show, so a message box a
// trainer opens later stays hidden behind the trainer, and the trainer, which
// the box disables, ignores every tap. While the game runs, such a box is
// brought forward when its trainer is in front; once it is answered, the
// trainer comes back. A box left open while the player went back to the game
// waits until the trainer is in front again.
const dialogWatchers = new Map<string, () => void>();

function followTrainerDialogs(appId: string, programs: string[]) {
  dialogWatchers.get(appId)?.();
  let shown = 0, back = 0, waiting = false, busy = false, failed = false;
  const logged = new Set<number>();
  const focus = (window: number) => SteamUIStore.WindowStore.SetFocusedAppWindowID(Number(appId), window);
  const timer = window.setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await getGameWindow(appId, programs);
      if (!result.success || dialogWatchers.get(appId) !== stop) return;
      const open = result.trainer_windows ?? [];
      if (result.hidden_dialog) {
        shown = result.hidden_dialog;
        back = result.focused ?? 0;
        waiting = false;
        focus(shown);
        if (!logged.has(shown)) {
          logged.add(shown);
          logFrontend("info", `Brought a trainer's dialog in front of its trainer for app ${appId}`);
        }
        return;
      }
      if (!shown) return;
      if (result.focused === shown) { waiting = true; return; }
      if (waiting && !open.includes(shown) && open.includes(back)) focus(back);
      shown = back = 0;
      waiting = false;
    } catch (error) {
      if (!failed) logFrontend("warning", `Following trainer dialogs for app ${appId} failed`, error);
      failed = true;
    } finally {
      busy = false;
    }
  }, timing.trainer_dialog_poll_ms);
  const stop = () => {
    window.clearInterval(timer);
    if (dialogWatchers.get(appId) === stop) dialogWatchers.delete(appId);
  };
  dialogWatchers.set(appId, stop);
}

const REAPER_ATTEMPTS = 6;
const REAPER_RETRY_MS = 2000;

/** When a game whose launch options start trainers starts, asks the backend to record how they started. */
async function report(appId: string, launched = false) {
  try {
    const [details, launcher] = await Promise.all([readLaunchDetails(appId), getLauncher()]);
    const programs = launcherPrograms(trainerCommand(details.options, launcher.home), launcher.path, ...launcher.legacy);
    if (!programs.length) {
      // A game can report another Steam ID than the shortcut that started it;
      // Steam's reaper still names the app that was launched.
      // Steam may report the start before that reaper runs: look a few times.
      for (let attempt = 0; !launched && attempt < REAPER_ATTEMPTS; attempt++) {
        const others = ((await getTrainerStatus("")).reapers ?? []).filter(other => other !== appId);
        if (others.length) {
          logFrontend("info", `App ${appId} starts no trainers; Steam's reaper runs app ${others.join(", ")}`);
          for (const other of others) await report(other, true);
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, REAPER_RETRY_MS));
      }
      return;
    }
    keepGameInFront(appId, programs);
    followTrainerDialogs(appId, programs);
    const result = await checkTrainerLaunch(appId, programs, details.compatTool);
    if (!result.success) logFrontend("warning", `Checking the trainer launch for app ${appId} failed`, result.error);
  } catch (error) {
    logFrontend("warning", `Checking the trainer launch for app ${appId} failed`, error);
  }
}

/** Follows game starts for the plugin's lifetime; returns the function that stops. */
export default function watchTrainerLaunches(): () => void {
  try {
    const subscription = SteamClient.GameSessions.RegisterForAppLifetimeNotifications(notification => {
      const appId = String(notification.unAppID);
      if (notification.bRunning) void report(appId);
      else dialogWatchers.get(appId)?.();
    });
    return () => {
      subscription.unregister();
      for (const timer of timers) window.clearInterval(timer);
      timers.clear();
      for (const stop of [...dialogWatchers.values()]) stop();
    };
  } catch (error) {
    logFrontend("warning", "Following game starts failed", error);
    return () => {};
  }
}
