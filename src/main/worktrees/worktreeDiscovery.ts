import { join } from "node:path";

// Existing conventional containers only; discovery never starts at all Home.
export const worktreeDiscoveryCandidates = (home: string): string[] => [
  [".config", "superpowers", "worktrees"],
  [".codex", "worktrees"],
  [".claude", "worktrees"],
  [".cursor", "worktrees"],
  ["orca", "workspaces"],
  ["_worktrees"], [".worktrees"], ["worktrees"], ["Worktrees"],
  ["Github"], ["GitHub"], ["github"], ["git"], ["Git"],
  ["Projects"], ["projects"], ["Code"], ["Developer"], ["src"],
  ["dev"], ["Development"], ["Repos"], ["repos"], ["repositories"],
  ["Documents", "Git"], ["Documents", "Github"], ["Documents", "GitHub"],
  ["Documents", "Projects"], ["Documents", "Code"]
].map((parts) => join(home, ...parts));
