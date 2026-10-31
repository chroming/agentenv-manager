import { canSelectWorktreeForCleanup, isAutomaticCleanupCandidate, type WorktreeEntry } from "../shared/worktrees";

export type WorktreeSelectionOrigin = "automatic" | "manual";
export interface WorktreeSelection { key: string; origin: WorktreeSelectionOrigin }
export const worktreeEntryKey = (entry: WorktreeEntry) => `${entry.commonDir}\0${entry.path}`;

export const selectWorktreeManually = (current: WorktreeSelection[], entry: WorktreeEntry, checked: boolean): WorktreeSelection[] => {
  const key = worktreeEntryKey(entry);
  if (!checked) return current.filter((value) => value.key !== key);
  if (!canSelectWorktreeForCleanup(entry)) return current;
  return [...current.filter((value) => value.key !== key), { key, origin: "manual" }];
};

export const toggleAutomaticWorktreeSelection = (current: WorktreeSelection[], entries: WorktreeEntry[]): WorktreeSelection[] => {
  const keys = new Set(entries.filter(isAutomaticCleanupCandidate).map(worktreeEntryKey));
  if (!keys.size) return current;
  const selected = new Set(current.map((value) => value.key));
  if ([...keys].every((key) => selected.has(key))) return current.filter((value) => !keys.has(value.key));
  return [...current, ...[...keys].filter((key) => !selected.has(key)).map((key) => ({ key, origin: "automatic" as const }))];
};
