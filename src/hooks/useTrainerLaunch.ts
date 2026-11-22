import { useEffect, useState } from "react";
import { getLauncher, Launcher, LocalTrainer, logFrontend, logUserAction, trainerExecutable } from "../utils/backend";
import {
  isTable, launcherCheatEngine, launcherCommand, launcherPrograms, samePath, setTrainerCommand, trainerCommand,
} from "../domain/trainerCommand";
import { readCheatEngine, useCheatEngine } from "./useCheatEngine";
import { useLaunchOptions } from "./useLaunchOptions";
import { useSettings } from "./useSettings";

const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * The trainers a game starts, read from its launch options: the shared
 * launcher script followed by the programs in order. An older value naming
 * one program directly reads as that program and is replaced on the next change.
 */
export function useTrainerLaunch(appId: string, directory: string, realDirectory = "") {
  const { options, error, refresh, update } = useLaunchOptions(appId);
  const settings = useSettings();
  const engine = useCheatEngine();
  const [launcher, setLauncher] = useState<Launcher>();
  const [scriptError, setScriptError] = useState("");
  // Fetching the script also rewrites it for the current settings.
  useEffect(() => {
    let active = true;
    getLauncher().then(result => {
      if (!active) return;
      setLauncher(result);
    })
      .catch(cause => {
        logFrontend("error", "Preparing the launcher script failed", cause);
        if (active) setScriptError(cause instanceof Error ? cause.message : "unknownError");
      });
    return () => { active = false; };
  }, [settings?.allow_multiple, settings?.launch_delay]);

  const script = launcher?.path;
  const command = options === undefined || launcher === undefined ? undefined : trainerCommand(options, launcher.home);
  const selected = options === undefined || launcher === undefined ? undefined : launcherPrograms(command, launcher.path, ...launcher.legacy);
  const multiple = Boolean(settings?.allow_multiple);
  // The launch options name the Cheat Engine a table opens with. Once that one
  // is deleted or replaced the table no longer opens, until it is chosen again.
  const written = launcher === undefined ? "" : launcherCheatEngine(command, launcher.path, ...launcher.legacy);
  const engineState: "" | "missing" | "moved" = !selected?.some(isTable) || engine === undefined ? ""
    : !engine.installed ? "missing" : samePath(engine.path, written) ? "" : "moved";

  /**
   * Writes the selection; `action` is what the user did, for the log. Tables
   * open through Cheat Engine, whose folder the game must see as well.
   */
  async function save(programs: string[], action: string) {
    let cheatEngine = "";
    let missing = script === undefined || launcher === undefined ? "optionsNotLoaded" : "";
    if (!missing && programs.some(isTable)) {
      // The status is read now if it has not arrived yet; programs never wait for it.
      try { cheatEngine = (engine ?? await readCheatEngine()).path; }
      catch (error) { logUserAction(`${action} for app ${appId}`, error); throw error; }
      if (!cheatEngine) missing = "cheat_engine_missing";
    }
    if (script === undefined || launcher === undefined || missing) {
      const error = new Error(missing);
      logUserAction(`${action} for app ${appId}`, error);
      throw error;
    }
    const owner = { script, scripts: launcher.legacy, libraries: [directory, realDirectory].filter(Boolean), home: launcher.home };
    const folders = [folderOf(script), ...(cheatEngine ? [folderOf(cheatEngine)] : []), ...programs.map(folderOf)];
    await update(current => programs.length
      ? setTrainerCommand(current, launcherCommand(script, programs, cheatEngine), [...new Set(folders)], owner)
      : setTrainerCommand(current, undefined, undefined, owner), action);
  }
  /** Adds a program, or replaces the selection when only one may run. */
  async function add(path: string, action = `Select program "${fileName(path)}"`) {
    const current = (selected || []).filter(item => item !== path);
    await save(multiple ? [...current, path] : [path], action);
  }
  async function select(trainer: LocalTrainer, filename: string) {
    const action = `Select trainer "${trainer.name}" (${filename})`;
    let path: string;
    try { path = await trainerExecutable({ appId, directory, entryId: trainer.id, filename }); }
    catch (error) { logUserAction(`${action} for app ${appId}`, error); throw error; }
    await add(path, action);
  }
  const inside = (trainer: LocalTrainer, item: string) => {
    const prefix = trainer.path.endsWith("/") ? trainer.path : `${trainer.path}/`;
    return item === trainer.path || item.startsWith(prefix);
  };
  function indexOf(trainer: LocalTrainer) {
    return (selected || []).findIndex(item => inside(trainer, item));
  }
  /** The selected path of one program inside a trainer, if it is selected. */
  function programPath(trainer: LocalTrainer, filename: string) {
    const target = `${trainer.path.replace(/\/$/, "")}/${filename}`;
    return (multiple ? selected : selected?.slice(0, 1))?.find(item => item === target || (item === trainer.path && trainer.path.endsWith(`/${filename}`)));
  }
  return {
    ready: selected !== undefined, error: error || scriptError,
    selected: (multiple ? selected : selected?.slice(0, 1)) || [], multiple, refresh,
    /** Cheat Engine, which only tables need; undefined until known. */
    cheatEngine: engine,
    /** Why a selected table will not open: its Cheat Engine is gone, or is not the one in use any more. */
    engineState,
    select,
    use: (path: string) => add(path),
    unselect: (trainer: LocalTrainer) => save((selected || []).filter(item => !inside(trainer, item)), `Unselect trainer "${trainer.name}"`),
    /** Stops one program; other programs of the same trainer stay selected. */
    removeProgram: (path: string) => save((selected || []).filter(item => item !== path), `Unselect program "${fileName(path)}"`),
    programPath,
    clear: () => save([], "Clear the trainer selection"),
    indexOf: (trainer: LocalTrainer) => { const index = indexOf(trainer); return multiple || index === 0 ? index : -1; },
    isSelected: (trainer: LocalTrainer) => indexOf(trainer) >= 0,
  };
}
