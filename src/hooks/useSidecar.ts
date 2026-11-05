import { LocalTrainer, trainerExecutable } from "../utils/backend";
import { editSidecar, sidecarPath } from "../domain/sidecar";
import { useLaunchOptions } from "./useLaunchOptions";

export function useSidecar(appId: string, directory: string) {
  const { options, error, refresh, update } = useLaunchOptions(appId);
  const save = (path?: string) => update(current => editSidecar(current, path));
  async function select(trainer: LocalTrainer, filename: string) {
    await save(await trainerExecutable({ appId, directory, entryId: trainer.id, filename }));
  }
  const selected = options === undefined ? undefined : sidecarPath(options);
  function isSelected(trainer: LocalTrainer) {
    const prefix = trainer.path.endsWith("/") ? trainer.path : `${trainer.path}/`;
    return Boolean(selected && (selected === trainer.path || selected.startsWith(prefix)));
  }
  return { ready: options !== undefined, error, selected, refresh, select, use: (path: string) => save(path), clear: () => save(), isSelected };
}
