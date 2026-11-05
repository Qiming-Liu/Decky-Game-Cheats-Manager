import { LaunchOptions, LaunchOptionDefinition } from "./options";
import { parseLiteralWord } from "./parser";

const command = "PROTON_REMOTE_DEBUG_CMD";
const filesystem = "PRESSURE_VESSEL_FILESYSTEMS_RW";
export const SIDECAR_NAMES: readonly string[] = [command, filesystem];
const environment = (name: string, value: string): LaunchOptionDefinition => ({ kind: "environment", name, value });
export const sidecarPath = (source: string) => {
  const value = LaunchOptions.parse(source).getEnvironment(command);
  // Earlier versions quoted the path a second time; read those values too.
  return value !== undefined && /^'.*'$/.test(value) ? parseLiteralWord(value) ?? value : value;
};
export function editSidecar(source: string, path?: string): string {
  const options = LaunchOptions.parse(source);
  if (!options.editable) throw new Error("These launch options cannot be edited safely. Review them in Steam Properties.");
  if (options.hasEnvironment(filesystem) && options.getEnvironment(filesystem) === undefined)
    throw new Error("The shared-folder setting contains a dynamic value and cannot be edited safely.");
  const edits: Parameters<LaunchOptions["edit"]>[0][number][] = [
    { kind: "disable", definition: environment(command, "") },
  ];
  if (path) {
    if (!path.startsWith("/") || /[\x00-\x1f:]/.test(path)) throw new Error("Choose a valid absolute Linux program path without colons.");
    const directory = path.slice(0, path.lastIndexOf("/")) || "/";
    const existing = options.getEnvironment(filesystem);
    const directories = existing ? existing.split(":") : [];
    if (!directories.includes(directory)) directories.push(directory);
    edits.push({ kind: "enable", definition: environment(command, path) });
    edits.push({ kind: "enable", definition: environment(filesystem, directories.join(":")) });
  }
  // Keep shared directories on disable: another launch tool may also use them.
  const result = options.edit(edits);
  if (!result.ok) throw new Error("Could not update launch options safely.");
  return result.value.toString();
}
