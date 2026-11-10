import { LaunchOptions, LaunchOptionDefinition, renderWord } from "./options";
import { parseLiteralWord, parseRawWords } from "./parser";

const command = "PROTON_REMOTE_DEBUG_CMD";
const filesystem = "PRESSURE_VESSEL_FILESYSTEMS_RW";
export const TRAINER_NAMES: readonly string[] = [command, filesystem];
const environment = (name: string, value: string, raw?: string): LaunchOptionDefinition =>
  ({ kind: "environment", name, value, ...(raw === undefined ? {} : { raw }) });
// SteamOS-style systems reach the same home through /home and /var/home.
const canonical = (path: string) => path.startsWith("/var/home/") ? path.slice(4) : path;
const within = (path: string, folder: string) => canonical(path).startsWith(`${canonical(folder)}/`);

/**
 * The command run beside the game. Steam runs launch options through a shell,
 * so a value written as `~/"..."` names a path in `home`, the user's home directory.
 */
export const trainerCommand = (source: string, home = "") => {
  const options = LaunchOptions.parse(source);
  const value = options.getEnvironment(command);
  if (value === undefined) {
    const written = options.getEnvironmentSource(command);
    const rest = written?.startsWith("~/") && home ? parseLiteralWord(written.slice(1)) : undefined;
    return rest === undefined ? undefined : home + rest;
  }
  // Earlier versions quoted the path a second time; read those values too.
  return /^'.*'$/.test(value) ? parseLiteralWord(value) ?? value : value;
};
const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const windowsPath = (path: string) => `Z:${path.split("/").join("\\")}`;
// Batch files expand %, so such paths cannot be passed; quotes end the
// argument, and backslashes would read as folder separators.
const passable = (path: string) => path.startsWith("/") && !/[\x00-\x1f:%"\\]/.test(path);

/**
 * The command that starts `programs` in order through the launcher script.
 * Proton splits the value into words and runs them with Wine. The script lives
 * in the trainer library, so programs inside it are passed relative to the
 * script's folder; others as full Windows paths.
 */
export function launcherCommand(script: string, programs: string[]): string {
  if (!programs.length || !programs.every(passable)) throw new Error("Choose a valid absolute Linux program path without colons.");
  const root = folderOf(script);
  const argument = (program: string) => within(program, root)
    ? canonical(program).slice(canonical(root).length + 1).split("/").join("\\") : windowsPath(program);
  return [script, ...programs.map(argument)].map(renderWord).join(" ");
}

/**
 * The programs a command starts: the launcher's arguments, or one program
 * named directly. `scripts` are the launcher's current path first, then
 * earlier ones still recognized (they took full Windows paths only).
 */
export function launcherPrograms(command: string | undefined, ...scripts: string[]): string[] {
  if (!command) return [];
  const words = parseRawWords(command)?.map(parseLiteralWord);
  if (!words || words.some(word => word === undefined)) return [command];
  const script = scripts.find(item => item && canonical(item) === canonical(words[0]!));
  if (script) {
    const root = folderOf(script);
    return (words.slice(1) as string[]).map(word => /^Z:\\/i.test(word)
      ? word.slice(2).split("\\").join("/") : `${root}/${word.split("\\").join("/")}`);
  }
  return words.length === 1 ? [words[0]!] : [command];
}

/** The value written as `~/"..."` when it starts in the home directory. */
function homeWord(value: string, home: string): string | undefined {
  if (!home || !within(value, home)) return undefined;
  return `~/${renderWord(canonical(value).slice(canonical(home).length + 1))}`;
}

const inside = (folder: string, root: string) => {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return root.startsWith("/") && folder.startsWith(prefix);
};

/**
 * Roots the Steam Linux Runtime container already shares with every game
 * (home directories, removable media and common mount points), so folders
 * under them need no `PRESSURE_VESSEL_FILESYSTEMS_RW` entry. `/var/home` is
 * where SteamOS-style systems keep the real home directories.
 */
const SHARED_ROOTS = ["/home", "/var/home", "/media", "/mnt", "/run/media", "/opt", "/srv"];
export const sharedByDefault = (folder: string) => SHARED_ROOTS.some(root => folder === root || inside(folder, root));

/**
 * Sets the command run beside the game, sharing `folders` (by default the
 * command's own folder) with the game when the container would not see them
 * anyway. No command removes it.
 *
 * The plugin's own entries are taken out first: folders the previous
 * command's programs needed, the launcher's folder, and folders inside the
 * trainer `libraries` (only trainers live there; pass the library both as
 * configured and resolved). Every other entry stays, and an empty variable
 * is removed. A path in the owner's `home` is written as `~/...`.
 */
export function setTrainerCommand(source: string, path?: string, folders?: string[],
  owner: { script?: string; scripts?: string[]; libraries?: string[]; home?: string } = {}): string {
  const options = LaunchOptions.parse(source);
  if (!options.editable) throw new Error("These launch options cannot be edited safely. Review them in Steam Properties.");
  if (options.hasEnvironment(filesystem) && options.getEnvironment(filesystem) === undefined)
    throw new Error("The shared-folder setting contains a dynamic value and cannot be edited safely.");
  const edits: Parameters<LaunchOptions["edit"]>[0][number][] = [
    { kind: "disable", definition: environment(command, "") },
  ];
  const shared = path ? folders ?? [folderOf(path)] : [];
  if (path) {
    if (/[\x00-\x1f]/.test(path) || !shared.every(folder => folder.startsWith("/") && !/[\x00-\x1f:]/.test(folder)))
      throw new Error("Choose a valid absolute Linux program path without colons.");
    // A plain program path is shared through its folder, which cannot hold a colon.
    if (!folders && (!path.startsWith("/") || path.includes(":")))
      throw new Error("Choose a valid absolute Linux program path without colons.");
  }
  const needed = shared.filter(folder => !sharedByDefault(folder));
  const scripts = [owner.script ?? "", ...owner.scripts ?? []];
  const previous = launcherPrograms(trainerCommand(source, owner.home), ...scripts)
    .filter(program => program.startsWith("/")).map(folderOf);
  for (const script of scripts) if (script) previous.push(folderOf(script));
  const ours = (folder: string) => !needed.includes(folder)
    && (previous.includes(folder) || (owner.libraries ?? []).some(library => inside(folder, library)));
  const existing = options.getEnvironment(filesystem);
  const directories = existing ? existing.split(":").filter(folder => folder && !ours(folder)) : [];
  for (const directory of needed) if (!directories.includes(directory)) directories.push(directory);
  if (existing !== undefined || directories.length) {
    if (directories.join(":") !== existing) edits.push(directories.length
      ? { kind: "enable", definition: environment(filesystem, directories.join(":")) }
      : { kind: "disable", definition: environment(filesystem, "") });
  }
  if (path) edits.push({ kind: "enable", definition: environment(command, path, homeWord(path, owner.home ?? "")) });
  const result = options.edit(edits);
  if (!result.ok) throw new Error("Could not update launch options safely.");
  return result.value.toString();
}
