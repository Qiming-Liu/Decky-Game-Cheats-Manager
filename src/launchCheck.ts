import { readLaunchDetails } from "./domain/steam";
import { launcherPrograms, trainerCommand } from "./domain/trainerCommand";
import { checkTrainerLaunch, getGameWindow, getLauncher, logFrontend } from "./utils/backend";

// A trainer or Cheat Engine that opens after the game can take the screen.
// For a while after the start, the game is put back in front the first time
// that happens; later switches are the player's own.
const FRONT_SECONDS = 180;
const FRONT_POLL = 2000;
const timers = new Set<number>();

declare const SteamUIStore: { WindowStore: { SetFocusedAppWindowID(appId: number, windowId: number): void } };

function keepGameInFront(appId: string, programs: string[]) {
  const until = Date.now() + FRONT_SECONDS * 1000;
  const timer = window.setInterval(async () => {
    try {
      if (Date.now() > until) { stop(); return; }
      const result = await getGameWindow(appId, programs);
      if (!result.success || !result.game || !result.trainer_in_front || !timers.has(timer)) return;
      stop();
      SteamUIStore.WindowStore.SetFocusedAppWindowID(Number(appId), result.game);
      logFrontend("info", `Put the game back in front of its trainer for app ${appId}`);
    } catch (error) {
      stop();
      logFrontend("warning", `Putting the game in front for app ${appId} failed`, error);
    }
  }, FRONT_POLL);
  const stop = () => { window.clearInterval(timer); timers.delete(timer); };
  timers.add(timer);
}

/** When a game whose launch options start trainers starts, asks the backend to record how they started. */
async function report(appId: string) {
  try {
    const [details, launcher] = await Promise.all([readLaunchDetails(appId), getLauncher()]);
    const programs = launcherPrograms(trainerCommand(details.options, launcher.home), launcher.path, ...launcher.legacy);
    if (!programs.length) return;
    keepGameInFront(appId, programs);
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
      if (notification.bRunning) void report(String(notification.unAppID));
    });
    return () => {
      subscription.unregister();
      for (const timer of timers) window.clearInterval(timer);
      timers.clear();
    };
  } catch (error) {
    logFrontend("warning", "Following game starts failed", error);
    return () => {};
  }
}
