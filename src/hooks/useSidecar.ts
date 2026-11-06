import { useEffect, useState } from "react";
import { getLauncher, LocalTrainer, trainerExecutable } from "../utils/backend";
import { editSidecar, isTable, launcherCommand, launcherPrograms, sidecarPath } from "../domain/sidecar";
import { useCheatEngine } from "./useCheatEngine";
import { useLaunchOptions } from "./useLaunchOptions";
import { useSettings } from "./useSettings";

const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

/**
 * The trainers a game starts, read from its launch options: the shared
 * launcher script followed by the programs in order. An older value naming
 * one program directly reads as that program and is replaced on the next change.
 */
export function useSidecar(appId: string, directory: string) {
  const { options, error, refresh, update } = useLaunchOptions(appId);
  const settings = useSettings();
  const engine = useCheatEngine();
  const [script, setScript] = useState<string>();
  const [scriptError, setScriptError] = useState("");
  // Fetching the script also rewrites it for the current settings.
  useEffect(() => {
    let active = true;
    getLauncher().then(launcher => { if (active) setScript(launcher.path); })
      .catch(cause => { if (active) setScriptError(cause instanceof Error ? cause.message : "unknownError"); });
    return () => { active = false; };
  }, [settings?.allow_multiple, settings?.launch_delay]);

  const command = options === undefined ? undefined : sidecarPath(options);
  const selected = options === undefined || script === undefined ? undefined : launcherPrograms(command, script);
  const multiple = Boolean(settings?.allow_multiple);

  // Tables open through Cheat Engine, whose folder the game must see as well.
  async function save(programs: string[]) {
    if (script === undefined) throw new Error("optionsNotLoaded");
    const cheatEngine = programs.some(isTable) ? engine?.path || "" : "";
    if (programs.some(isTable) && !cheatEngine) throw new Error("cheat_engine_missing");
    const folders = [folderOf(script), ...(cheatEngine ? [folderOf(cheatEngine)] : []), ...programs.map(folderOf)];
    await update(current => programs.length
      ? editSidecar(current, launcherCommand(script, programs, cheatEngine), [...new Set(folders)])
      : editSidecar(current));
  }
  /** Adds a program, or replaces the selection when only one may run. */
  async function add(path: string) {
    const current = (selected || []).filter(item => item !== path);
    await save(multiple ? [...current, path] : [path]);
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
    ready: selected !== undefined && engine !== undefined, error: error || scriptError,
    selected: (multiple ? selected : selected?.slice(0, 1)) || [], multiple, refresh,
    /** Cheat Engine, which every table needs; undefined until known. */
    cheatEngine: engine,
    select: async (trainer: LocalTrainer, filename: string) =>
      add(await trainerExecutable({ appId, directory, entryId: trainer.id, filename })),
    use: add,
    unselect: (trainer: LocalTrainer) => save((selected || []).filter(item => !inside(trainer, item))),
    /** Stops one program; other programs of the same trainer stay selected. */
    removeProgram: (path: string) => save((selected || []).filter(item => item !== path)),
    programPath,
    clear: () => save([]),
    indexOf: (trainer: LocalTrainer) => { const index = indexOf(trainer); return multiple || index === 0 ? index : -1; },
    isSelected: (trainer: LocalTrainer) => indexOf(trainer) >= 0,
  };
}
