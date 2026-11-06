import config from "../data/unsupported-compat-tools.json";

// Steam only exposes the compatibility tool's display name (no build date),
// so support is decided by name against the list in the config file.
const unsupported = config.unsupported.map(entry => new RegExp(entry.match, "i"));

/** True when the named compatibility tool is known to break trainers. */
export function isCompatToolUnsupported(displayName: string | null | undefined): boolean {
  const name = (displayName || "").trim();
  return name !== "" && unsupported.some(pattern => pattern.test(name));
}
