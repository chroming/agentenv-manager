import type { WorktreeEntry } from "../shared/worktrees";

export const worktreeStatus = (entry: WorktreeEntry): {
  message: string; values?: Record<string, string | number>; tone: "neutral" | "warning";
} => {
  const neutral = (message: string) => ({ message, tone: "neutral" as const });
  if (entry.keptReason || entry.repositoryKeptReason) return neutral("Ignored");
  if (entry.locked) return neutral("Git locked");
  if (!entry.exists) return neutral("Folder unavailable");
  if (entry.prunable) return neutral("Registration needs repair");
  if (entry.reasons.includes("Git operation in progress")) return neutral("Git operation in progress");
  if (entry.reasons.includes("Unresolved Git conflicts")) return { message: "Unresolved Git conflicts", tone: "warning" };
  if (entry.submodules) return neutral("Contains submodules");
  if (entry.reasons.includes("Contains a nested repository")) return neutral("Contains a nested repository");
  if (entry.state === "unavailable") return neutral("Could not inspect Worktree");
  if (entry.changes.length) return { message: "{{count}} local changes", values: { count: entry.changes.length }, tone: "warning" };
  if (entry.ignored.length) return { message: "Ignored files present", tone: "warning" };
  if (entry.detached || entry.headNeedsProtection) return neutral("Detached HEAD");
  if (entry.state === "review") return neutral(entry.integration && (!entry.integration.merged || entry.integration.ref === `refs/heads/${entry.branch}`)
    || entry.reasons.some((reason) => /integration target|target branch/.test(reason)) ? "Integration not confirmed" : "Review required");
  return neutral("No local changes");
};

export const worktreeDisplayPath = (entry: WorktreeEntry): string => {
  const path = entry.path.replaceAll("\\", "/");
  const repository = entry.repositoryPath.replaceAll("\\", "/").replace(/\/$/, "");
  return path.startsWith(`${repository}/`) ? path.slice(repository.length + 1) : entry.path;
};
