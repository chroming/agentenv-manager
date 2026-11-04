import { describe, expect, it } from "vitest";
import { canSelectWorktreeForCleanup, isAutomaticCleanupCandidate, type WorktreeEntry } from "../../src/shared/worktrees";
import { selectRepositoryWorktrees, selectWorktreeManually, toggleAutomaticWorktreeSelection, worktreeEntryKey } from "../../src/renderer/worktreeSelection";

const clean: WorktreeEntry = {
  path: "/repo/tree", repositoryPath: "/repo/main", commonDir: "/repo/main/.git", head: "a".repeat(40),
  main: false, detached: false, exists: true, state: "candidate", reasons: [], changes: [], ignored: [], submodules: false,
  cleanupReviewAvailable: true, manualReviewAvailable: true, headNeedsProtection: false
};
const dirty: WorktreeEntry = { ...clean, path: "/repo/dirty", state: "review", changes: [" M file"], cleanupReviewAvailable: false };

describe("Worktree selection intent", () => {
  it("makes repository-wide choices explicit while preserving other repositories and hard protection", () => {
    const outside = { ...clean, path: "/other/tree" };
    const initial = selectWorktreeManually(toggleAutomaticWorktreeSelection([], [clean]), outside, true);
    const locked = { ...dirty, path: "/locked", locked: "Keep" };
    const selected = selectRepositoryWorktrees(initial, [clean, dirty, locked], true);
    expect(selected).toEqual([
      { key: worktreeEntryKey(outside), origin: "manual" },
      { key: worktreeEntryKey(clean), origin: "manual" },
      { key: worktreeEntryKey(dirty), origin: "manual" },
      { key: worktreeEntryKey(locked), origin: "manual" }
    ]);
    expect(selectRepositoryWorktrees(selected, [clean, dirty, locked], false)).toEqual([{ key: worktreeEntryKey(outside), origin: "manual" }]);
  });
  it("separates manual cleanup permission from automatic selection", () => {
    expect(canSelectWorktreeForCleanup(dirty)).toBe(true);
    expect(isAutomaticCleanupCandidate(dirty)).toBe(false);
    expect(isAutomaticCleanupCandidate(clean)).toBe(true);
    expect(toggleAutomaticWorktreeSelection([], [dirty, clean])).toEqual([{ key: worktreeEntryKey(clean), origin: "automatic" }]);
  });

  it("retains manual intent while adding automatically eligible trees without duplicate identities", () => {
    const second = { ...clean, path: "/repo/second" };
    const manual = selectWorktreeManually(selectWorktreeManually([], dirty, true), clean, true);
    const selected = toggleAutomaticWorktreeSelection(manual, [clean, dirty, second]);
    expect(selected).toEqual([...manual, { key: worktreeEntryKey(second), origin: "automatic" }]);
    expect(selected.find((value) => value.key === worktreeEntryKey(clean))?.origin).toBe("manual");
  });

  it("clears only clean entries in the automatic control's scope, preserving manual dirty and out-of-scope picks", () => {
    const outside = { ...clean, path: "/other/tree" };
    const manual = selectWorktreeManually(selectWorktreeManually([], dirty, true), outside, true);
    const selected = toggleAutomaticWorktreeSelection(manual, [clean, dirty]);
    expect(toggleAutomaticWorktreeSelection(selected, [clean, dirty])).toEqual(manual);
    expect(toggleAutomaticWorktreeSelection(manual, [dirty])).toBe(manual);
  });

  it("changes authorization only when the user explicitly selects the individual tree", () => {
    const automatic = toggleAutomaticWorktreeSelection([], [clean]);
    expect(automatic[0].origin).toBe("automatic");
    const changed = { ...dirty, path: clean.path };
    const explicit = selectWorktreeManually(automatic, changed, true);
    expect(explicit).toEqual([{ key: worktreeEntryKey(clean), origin: "manual" }]);
    expect(selectWorktreeManually(explicit, changed, false)).toEqual([]);
  });

  it.each([
    { main: true }, { keptReason: "Keep" }, { repositoryKeptReason: "Keep" }, { exists: false }
  ])("does not manually select protected trees: %j", (flags) => {
    const entry = { ...dirty, ...flags };
    expect(canSelectWorktreeForCleanup(entry)).toBe(false);
    expect(isAutomaticCleanupCandidate(entry)).toBe(false);
    expect(selectWorktreeManually([], entry, true)).toEqual([]);
  });
  it.each([{ locked: "Keep" }, { submodules: true }, { manualReviewAvailable: false },
    { prunable: "Missing metadata" }, { head: undefined }, { state: "unavailable" as const }])("allows manual intent despite cached Git state: %j", (flags) => {
    const entry = { ...dirty, ...flags };
    expect(canSelectWorktreeForCleanup(entry)).toBe(true);
    expect(isAutomaticCleanupCandidate(entry)).toBe(false);
    expect(selectWorktreeManually([], entry, true)).toEqual([{ key: worktreeEntryKey(entry), origin: "manual" }]);
  });
});
