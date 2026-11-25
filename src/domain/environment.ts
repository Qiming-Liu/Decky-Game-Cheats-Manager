// Hints from what a game runs on (py_modules/game_environment.py). Every rule
// reads a measured fact; what it means for trainers is worded as "may", since
// no game has been tried with every trainer. Nothing here names a game.

export interface EnvironmentFacts {
  prelaunch?: { managed: boolean; prefix: boolean; ms_dotnet: boolean };
  runtime?: { wine_mono: string; ms_clr: boolean; elf32: boolean; tool_mono: string; managed_trainers: string[] } | null;
}

export type Hint = "wineMono" | "dotnetPrefix" | "oldWow64" | "brokenMono" | "untracked";

/** Wine Mono releases whose named pipes are broken (.NET trainers cannot reach their own window). */
const BROKEN_MONO = new Set(["11.2.0"]);

/** The hints that apply, most useful first. `untracked`: Steam does not report the running game. */
export function environmentHints(facts: EnvironmentFacts, untracked = false): Hint[] {
  const hints: Hint[] = [];
  const { prelaunch, runtime } = facts;
  if (runtime?.wine_mono && !runtime.ms_clr) hints.push("wineMono");
  else if (!runtime && prelaunch?.managed && !prelaunch.ms_dotnet) hints.push("dotnetPrefix");
  if (runtime?.elf32) hints.push("oldWow64");
  if (runtime && BROKEN_MONO.has(runtime.tool_mono) && runtime.managed_trainers.length) hints.push("brokenMono");
  if (untracked) hints.push("untracked");
  return hints;
}

/** Whether table entries that use Cheat Engine's .NET data collector may need Microsoft's .NET. */
export function collectorAtRisk(facts: EnvironmentFacts): boolean {
  return Boolean(facts.runtime?.wine_mono && !facts.runtime.ms_clr);
}
