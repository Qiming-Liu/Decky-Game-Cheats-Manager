import { readLaunchDetails } from "./domain/steam";
import { launcherPrograms, trainerCommand } from "./domain/trainerCommand";
import { checkTrainerLaunch, getLauncher, logFrontend } from "./utils/backend";

/** When a game whose launch options start trainers starts, asks the backend to record how they started. */
async function report(appId: string) {
  try {
    const [details, launcher] = await Promise.all([readLaunchDetails(appId), getLauncher()]);
    const programs = launcherPrograms(trainerCommand(details.options, launcher.home), launcher.path, ...launcher.legacy);
    if (!programs.length) return;
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
    return () => subscription.unregister();
  } catch (error) {
    logFrontend("warning", "Following game starts failed", error);
    return () => {};
  }
}
