import { useEffect, useState } from "react";
import { LocalTrainer, trainerExecutable } from "../utils/backend";
import { readLaunchOptions, saveSidecar, sidecarPath } from "../domain/sidecar";

export function useSidecar(appId: string, directory: string) {
  const [options, setOptions] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setOptions(undefined);
    setError("");
    readLaunchOptions(appId).then(value => { if (active) setOptions(value); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "unknownError"); });
    return () => { active = false; };
  }, [appId]);

  async function refresh() { setOptions(await readLaunchOptions(appId)); }
  async function save(path?: string) {
    if (options === undefined) throw new Error("Launch options are not loaded yet.");
    setOptions(await saveSidecar(appId, options, path));
  }
  async function select(trainer: LocalTrainer, filename: string) {
    const path = await trainerExecutable({ appId, directory, entryId: trainer.id, filename });
    await save(path);
  }
  function isSelected(trainer: LocalTrainer) {
    const selected = options === undefined ? undefined : sidecarPath(options);
    const prefix = trainer.path.endsWith("/") ? trainer.path : `${trainer.path}/`;
    return Boolean(selected && (selected === trainer.path || selected.startsWith(prefix)));
  }
  return { ready: options !== undefined, error, refresh, select, clear: () => save(), isSelected };
}
