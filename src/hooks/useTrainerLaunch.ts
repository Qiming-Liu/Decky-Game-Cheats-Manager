import { useEffect, useState } from "react";
import {
  getLauncher, getProtonLogOwned, Launcher, LocalTrainer, logFrontend, logUserAction, setProtonLogOwned, trainerExecutable,
} from "../utils/backend";
import { fileName } from "../domain/paths";
import {
  effectiveSelection, engineState as readEngineState, selectedProgram, selectionIndex, sharedFolders, withoutProgram, withoutTrainer, withProgram,
} from "../domain/selection";
import {
  isTable, launcherCheatEngine, launcherCommand, launcherPrograms, runsLauncher, samePath, setProtonLog, setTrainerCommand, trainerCommand,
} from "../domain/trainerCommand";
import { readCheatEngine, useCheatEngine } from "./useCheatEngine";
import { useLaunchOptions } from "./useLaunchOptions";
import { useSettings } from "./useSettings";

/**
 * The trainers a game starts, read from its launch options: the shared
 * launcher script followed by the programs in order. An older value naming
 * one program directly reads as that program and is replaced on the next change.
 */
/** `confirmTable` is asked before a table is added; false leaves the selection as it is. */
export function useTrainerLaunch(appId: string, directory: string, realDirectory = "",
  confirmTable?: (path: string) => Promise<boolean>) {
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
  // A command the launcher does not run: another tool's, or this plugin's from
  // before the launcher. Steam then starts it as is, and whoever wrote it may
  // remove it. One absolute program can be moved to the launcher.
  const direct = command !== undefined && launcher !== undefined && !runsLauncher(command, launcher.path, ...launcher.legacy);
  const adoptable = direct && selected?.length === 1 && selected[0].startsWith("/");
  // The launch options name the Cheat Engine a table opens with. Once that one
  // is deleted or replaced the table no longer opens, until it is chosen again.
  const written = launcher === undefined ? "" : launcherCheatEngine(command, launcher.path, ...launcher.legacy);
  const engineState = readEngineState(selected, engine, engine !== undefined && samePath(engine.path, written));

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
    // Proton's log goes with the trainers while the setting is on, and leaves with them.
    const log = Boolean(settings?.proton_log) && programs.length > 0;
    const owned = await getProtonLogOwned(appId).catch(() => false);
    let owns = owned;
    await update(current => {
      const written = programs.length
        ? setTrainerCommand(current, launcherCommand(script, programs, cheatEngine), sharedFolders(script, cheatEngine, programs), owner)
        : setTrainerCommand(current, undefined, undefined, owner);
      const result = setProtonLog(written, log, owned);
      owns = result.owned;
      return result.value;
    }, action);
    if (owns !== owned) {
      await setProtonLogOwned(appId, owns).catch(error => logFrontend("error", `Recording PROTON_LOG of app ${appId} failed`, error));
    }
  }
  /** Adds a program, or replaces the selection when only one may run. */
  async function add(path: string, action = `Select program "${fileName(path)}"`) {
    if (isTable(path) && confirmTable && !await confirmTable(path)) return;
    await save(withProgram(selected || [], path, multiple), action);
  }
  async function select(trainer: LocalTrainer, filename: string) {
    const action = `Select trainer "${trainer.name}" (${filename})`;
    let path: string;
    try { path = await trainerExecutable({ appId, directory, entryId: trainer.id, filename }); }
    catch (error) { logUserAction(`${action} for app ${appId}`, error); throw error; }
    await add(path, action);
  }
  return {
    ready: selected !== undefined, error: error || scriptError,
    selected: effectiveSelection(selected || [], multiple), multiple, refresh,
    /** Cheat Engine, which only tables need; undefined until known. */
    cheatEngine: engine,
    /** Why a selected table will not open: its Cheat Engine is gone, or is not the one in use any more. */
    engineState,
    select,
    use: (path: string) => add(path),
    unselect: (trainer: LocalTrainer) => save(withoutTrainer(selected || [], trainer), `Unselect trainer "${trainer.name}"`),
    /** Stops one program; other programs of the same trainer stay selected. */
    removeProgram: (path: string) => save(withoutProgram(selected || [], path), `Unselect program "${fileName(path)}"`),
    /** The selected path of one program inside a trainer, if it is selected. */
    programPath: (trainer: LocalTrainer, filename: string) => selectedProgram(trainer, filename, selected || [], multiple),
    clear: () => save([], "Clear the trainer selection"),
    /** True when the trainer command was not written through the launcher. */
    direct,
    /** Rewrites a direct command for one program through the launcher; undefined when that is not possible. */
    adopt: adoptable ? () => save(selected!, "Start the trainer through the launcher") : undefined,
    indexOf: (trainer: LocalTrainer) => selectionIndex(trainer, selected || [], multiple),
    /** Anywhere in the launch options, even behind the one program that runs. */
    isSelected: (trainer: LocalTrainer) => selectionIndex(trainer, selected || [], true) >= 0,
  };
}
