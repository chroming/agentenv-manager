import { describe, expect, it } from "vitest";
import type { WorktreeCleanupPreview, WorktreeEntry } from "../../src/shared/worktrees";
import { applyWorktreePreparation, type WorktreeReviewItem } from "../../src/renderer/worktreePreparation";

const entry: WorktreeEntry = {
  path: "/projects/tree", repositoryPath: "/projects/app", commonDir: "/projects/app/.git",
  head: "a".repeat(40), branch: "task", main: false, detached: false, exists: true,
  state: "candidate", reasons: [], changes: [], ignored: [], submodules: false,
  cleanupReviewAvailable: true, manualReviewAvailable: true, headNeedsProtection: false
};
const preview = (changes: Partial<WorktreeEntry> = {}): WorktreeCleanupPreview => ({
  previewId: "prepared", entry: { ...entry, ...changes }, fingerprint: "b".repeat(64),
  checkedAt: "2026-11-03T00:00:00Z", backupRequired: false, forceRequired: false, savedWorkspace: false
});

describe("applyWorktreePreparation", () => {
  it("ignores another path without changing the pending item", () => {
    const item: WorktreeReviewItem = { entry, origin: "automatic" };
    expect(applyWorktreePreparation(item, { path: "/other", preview: preview() })).toBe(item);
  });

  it.each(["automatic", "manual"] as const)("retains %s origin while replacing stale preview data with an error", (origin) => {
    const item = { entry, origin, preview: preview() };
    expect(applyWorktreePreparation(item, { path: entry.path, error: "Git operation in progress" }))
      .toEqual({ entry, origin, preview: undefined, error: "Git operation in progress" });
  });

  it.each([{ path: "/other/tree" }, { commonDir: "/other/.git" }])("rejects a preview for a different directory identity: %j", (changes) => {
    const item: WorktreeReviewItem = { entry, origin: "manual", preview: preview() };
    expect(applyWorktreePreparation(item, { path: entry.path, preview: preview(changes) })).toMatchObject({
      entry, origin: "manual", preview: undefined, error: expect.stringContaining("does not match the selected directory")
    });
  });

  it.each<Partial<WorktreeEntry>>([
    { changes: [" M README.md"] }, { ignored: ["cache/"] }, { detached: true },
    { headNeedsProtection: true }, { state: "review" }, { reasons: ["New work"] },
    { cleanupReviewAvailable: false }
  ])("never widens an automatic selection after fresh checks: %j", (changes) => {
    const result = applyWorktreePreparation({ entry, origin: "automatic" }, { path: entry.path, preview: preview(changes) });
    expect(result).toMatchObject({ entry, origin: "automatic", preview: undefined,
      error: expect.stringContaining("changed after automatic selection") });
  });

  it.each<Partial<WorktreeEntry>>([
    { main: true }, { locked: "Testing" }, { exists: false }, { submodules: true },
    { keptReason: "Keep" }, { repositoryKeptReason: "Keep" }, { manualReviewAvailable: false },
    { prunable: "Repair registration" }, { head: undefined }, { state: "unavailable" }
  ])("rejects a freshly protected manual pick: %j", (changes) => {
    const result = applyWorktreePreparation({ entry, origin: "manual" }, { path: entry.path, preview: preview(changes) });
    expect(result).toMatchObject({ entry, origin: "manual", preview: undefined,
      error: expect.stringContaining("now protected") });
  });

  it("replaces failed manual review with its fresh dirty preview without losing origin", () => {
    const ready = { ...preview({ state: "review", changes: [" M README.md"], sizeBytes: 2048 }), backupRequired: true, forceRequired: true };
    const result = applyWorktreePreparation({ entry, origin: "manual", error: "Earlier failure" }, { path: entry.path, preview: ready });
    expect(result).toEqual({ entry: ready.entry, origin: "manual", preview: ready, error: undefined });
  });

  it("accepts a fresh automatic preview and clears earlier diagnostics without mutating inputs", () => {
    const item: WorktreeReviewItem = { entry, origin: "automatic", error: "Earlier failure" };
    const ready = preview({ sizeBytes: 4096 });
    expect(applyWorktreePreparation(item, { path: entry.path, preview: ready }))
      .toEqual({ entry: ready.entry, origin: "automatic", preview: ready, error: undefined });
    expect(item.error).toBe("Earlier failure");
    expect(entry.sizeBytes).toBeUndefined();
  });
});
