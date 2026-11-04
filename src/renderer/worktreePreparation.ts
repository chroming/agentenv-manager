import { canSelectWorktreeForCleanup, isAutomaticCleanupCandidate, type WorktreeCleanupPreparation, type WorktreeCleanupPreview, type WorktreeEntry } from "../shared/worktrees";
import type { WorktreeSelectionOrigin } from "./worktreeSelection";

export interface WorktreeReviewItem {
  trashId?: string;
  entry: WorktreeEntry;
  origin: WorktreeSelectionOrigin;
  preview?: WorktreeCleanupPreview;
  error?: string;
}

export function applyWorktreePreparation(item: WorktreeReviewItem, result: WorktreeCleanupPreparation): WorktreeReviewItem {
  if (result.path !== item.entry.path) return item;
  if (!result.preview) return { ...item, preview: undefined, error: result.error || "Could not prepare" };
  const entry = result.preview.entry;
  if (entry.path !== item.entry.path || entry.commonDir !== item.entry.commonDir) {
    return { ...item, preview: undefined, error: "The prepared Worktree does not match the selected directory. Retry its review." };
  }
  if (!result.preview.mode && item.origin !== "manual" && !isAutomaticCleanupCandidate(entry)) {
    return { ...item, preview: undefined, error: "This Worktree changed after automatic selection. Refresh and select it individually to include it." };
  }
  if (!canSelectWorktreeForCleanup(entry) || !result.preview.mode && (!entry.manualReviewAvailable || entry.locked || entry.prunable || entry.submodules || !entry.head || entry.state === "unavailable")) return { ...item, preview: undefined,
    error: "This Worktree is now protected. Refresh to review its current state." };
  return { ...item, entry, preview: result.preview, error: undefined };
}
