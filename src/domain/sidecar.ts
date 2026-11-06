import { LaunchOptions, LaunchOptionDefinition, renderWord } from "./options";
import { parseLiteralWord, parseRawWords } from "./parser";

const command = "PROTON_REMOTE_DEBUG_CMD";
const filesystem = "PRESSURE_VESSEL_FILESYSTEMS_RW";
export const SIDECAR_NAMES: readonly string[] = [command, filesystem];
const environment = (name: string, value: string): LaunchOptionDefinition => ({ kind: "environment", name, value });
export const sidecarPath = (source: string) => {
  const value = LaunchOptions.parse(source).getEnvironment(command);
  // Earlier versions quoted the path a second time; read those values too.
  return value !== undefined && /^'.*'$/.test(value) ? parseLiteralWord(value) ?? value : value;
};
const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const windowsPath = (path: string) => `Z:${path.split("/").join("\\")}`;
const unixPath = (path: string) => /^Z:\\/i.test(path) ? path.slice(2).split("\\").join("/") : path;
// Batch files expand %, so such paths cannot be passed; quotes end the argument.
const passable = (path: string) => path.startsWith("/") && !/[\x00-\x1f:%"]/.test(path);

/**
 * The command that starts `programs` in order through the shared launcher
 * script. Proton splits the value into words and runs them with Wine.
 */
export function launcherCommand(script: string, programs: string[]): string {
  if (!programs.length || !programs.every(passable)) throw new Error("Choose a valid absolute Linux program path without colons.");
  return [script, ...programs.map(windowsPath)].map(renderWord).join(" ");
}

/** The programs a command starts: the launcher's arguments, or one program named directly. */
export function launcherPrograms(command: string | undefined, script: string): string[] {
  if (!command) return [];
  const words = parseRawWords(command)?.map(parseLiteralWord);
  if (!words || words.some(word => word === undefined)) return [command];
  if (words[0] === script) return (words.slice(1) as string[]).map(unixPath);
  return words.length === 1 ? [words[0]!] : [command];
}

/**
 * Sets the command run beside the game, sharing `folders` (by default the
 * command's own folder) with the game. No command removes it.
 */
export function editSidecar(source: string, path?: string, folders?: string[]): string {
  const options = LaunchOptions.parse(source);
  if (!options.editable) throw new Error("These launch options cannot be edited safely. Review them in Steam Properties.");
  if (options.hasEnvironment(filesystem) && options.getEnvironment(filesystem) === undefined)
    throw new Error("The shared-folder setting contains a dynamic value and cannot be edited safely.");
  const edits: Parameters<LaunchOptions["edit"]>[0][number][] = [
    { kind: "disable", definition: environment(command, "") },
  ];
  if (path) {
    const shared = folders ?? [folderOf(path)];
    if (/[\x00-\x1f]/.test(path) || !shared.every(folder => folder.startsWith("/") && !/[\x00-\x1f:]/.test(folder)))
      throw new Error("Choose a valid absolute Linux program path without colons.");
    // A plain program path is shared through its folder, which cannot hold a colon.
    if (!folders && (!path.startsWith("/") || path.includes(":")))
      throw new Error("Choose a valid absolute Linux program path without colons.");
    const existing = options.getEnvironment(filesystem);
    const directories = existing ? existing.split(":") : [];
    for (const directory of shared) if (!directories.includes(directory)) directories.push(directory);
    edits.push({ kind: "enable", definition: environment(command, path) });
    edits.push({ kind: "enable", definition: environment(filesystem, directories.join(":")) });
  }
  // Keep shared directories on disable: another launch tool may also use them.
  const result = options.edit(edits);
  if (!result.ok) throw new Error("Could not update launch options safely.");
  return result.value.toString();
}
