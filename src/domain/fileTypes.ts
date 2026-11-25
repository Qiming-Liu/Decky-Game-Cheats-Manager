// The kinds of file a trainer can start with. The lists are shared with the backend.
import files from "../../py_modules/data/library.json";

const endsWith = (extensions: readonly string[]) =>
  new RegExp(`(?:${extensions.map(extension => extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i");

const TABLE_FILE = endsWith(files.table_extensions);
const LAUNCHABLE_FILE = endsWith([...files.program_extensions, ...files.table_extensions]);

/** A Cheat Engine table, which the launcher opens through Cheat Engine. */
export const isTableFile = (file: string): boolean => TABLE_FILE.test(file);
/** A program, script or table: anything that can start beside the game. */
export const isLaunchableFile = (file: string): boolean => LAUNCHABLE_FILE.test(file);
export const isScriptFile = (file: string): boolean => /\.bat$/i.test(file);

/** The extensions the file picker offers, without their dots. */
export const PICKER_EXTENSIONS: string[] =
  [...files.program_extensions, ...files.table_extensions].map(extension => extension.replace(/^\./, ""));
