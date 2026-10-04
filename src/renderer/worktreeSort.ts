import type { WorktreeEntry } from "../shared/worktrees";
import type { WorktreeSort } from "../shared/uiState";

export const worktreeName = (path: string) =>
  path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? path;

const byName = (left: string, right: string) =>
  worktreeName(left).localeCompare(worktreeName(right), undefined, { numeric: true }) ||
  left.localeCompare(right);

const modified = (entry: WorktreeEntry) => {
  const value = Date.parse(entry.modifiedAt ?? "");
  return Number.isFinite(value) ? value : undefined;
};

const size = (entry: WorktreeEntry) =>
  entry.sizeBytes !== undefined && Number.isFinite(entry.sizeBytes) && entry.sizeBytes >= 0
    ? entry.sizeBytes : undefined;

const rank = (entry: WorktreeEntry) => {
  if (entry.state === "kept" || entry.keptReason || entry.locked) return 2;
  if (entry.cleanupReviewAvailable) return 0;
  return entry.state === "unavailable" ? 3 : 1;
};

const compareMetric = (left: number | undefined, right: number | undefined, ascending = false) => {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return ascending ? left - right : right - left;
};

export const sortWorktreeGroups = (
  groups: Array<[string, WorktreeEntry[]]>, sort: WorktreeSort
): Array<[string, WorktreeEntry[]]> => {
  const compareEntries = (left: WorktreeEntry, right: WorktreeEntry) => {
    if (left.main !== right.main) return left.main ? -1 : 1;
    const order = sort === "size-desc" ? compareMetric(size(left), size(right))
      : sort === "modified-desc" || sort === "modified-asc"
        ? compareMetric(modified(left), modified(right), sort === "modified-asc")
        : sort === "status" ? rank(left) - rank(right) : 0;
    return order || byName(left.path, right.path);
  };
  return groups.map(([id, entries]): [string, WorktreeEntry[]] =>
    [id, [...entries].sort(compareEntries)]
  ).sort((left, right) => {
    const order = sort === "name" ? 0 : compareMetric(
      worktreeGroupMetric(left[1], sort), worktreeGroupMetric(right[1], sort), sort === "modified-asc" || sort === "status"
    );
    return order || byName(left[1][0].repositoryPath, right[1][0].repositoryPath) ||
      left[0].localeCompare(right[0]);
  });
};

export const worktreeGroupMetric = (entries: WorktreeEntry[], sort: WorktreeSort) => {
  const linked = entries.filter((entry) => !entry.main);
  if (!linked.length || sort === "name") return undefined;
  if (sort === "status") return Math.min(...linked.map(rank));
  const values = linked.map(sort === "size-desc" ? size : modified);
  // A partial measurement is not a trustworthy group total or time range.
  if (values.some((value) => value === undefined)) return undefined;
  const known = values as number[];
  return sort === "size-desc" ? known.reduce((total, value) => total + value, 0)
    : sort === "modified-asc" ? Math.min(...known) : Math.max(...known);
};
