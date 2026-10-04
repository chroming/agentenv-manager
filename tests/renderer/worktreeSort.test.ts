import { describe, expect, it } from "vitest";
import { sortWorktreeGroups, worktreeGroupMetric } from "../../src/renderer/worktreeSort";
import type { WorktreeEntry } from "../../src/shared/worktrees";
import type { WorktreeSort } from "../../src/shared/uiState";

const entry = (name: string, overrides: Partial<WorktreeEntry> = {}): WorktreeEntry => ({
  path: `/worktrees/${name}`, repositoryPath: "/repos/app", commonDir: "/repos/app/.git",
  main: false, detached: false, exists: true, state: "candidate", reasons: [], changes: [],
  ignored: [], submodules: false, cleanupReviewAvailable: true, manualReviewAvailable: true,
  headNeedsProtection: false, ...overrides
});
const ordered = (entries: WorktreeEntry[], sort: WorktreeSort) =>
  sortWorktreeGroups([["app", entries]], sort)[0][1].map((item) => item.path);

describe("Worktree display sorting", () => {
  it("exposes the exact group values used for ordering, excluding main and incomplete measurements", () => {
    const rows = [entry("main", { main: true, sizeBytes: 99999 }),
      entry("zero", { sizeBytes: 0, modifiedAt: "2026-09-01" }),
      entry("one", { sizeBytes: 100, modifiedAt: "2026-10-04" })];
    expect(worktreeGroupMetric(rows, "size-desc")).toBe(100);
    expect(worktreeGroupMetric(rows, "modified-asc")).toBe(Date.parse("2026-09-01"));
    expect(worktreeGroupMetric(rows, "modified-desc")).toBe(Date.parse("2026-10-04"));
    expect(worktreeGroupMetric([...rows, entry("unknown")], "size-desc")).toBeUndefined();
    expect(worktreeGroupMetric([], "modified-desc")).toBeUndefined();
  });
  it("uses natural folder names, not branch or discovery order", () => {
    expect(ordered([entry("task-10"), entry("task-2"), entry("task-1")], "name"))
      .toEqual(["/worktrees/task-1", "/worktrees/task-2", "/worktrees/task-10"]);
  });

  it.each(["name", "size-desc", "modified-desc", "modified-asc", "status"] as const)(
    "keeps main first without mutating the inventory in %s", (sort) => {
      const rows = [entry("a"), entry("z", { main: true, sizeBytes: 999 })];
      const before = structuredClone(rows);
      expect(ordered(rows, sort)[0]).toBe("/worktrees/z");
      expect(rows).toEqual(before);
    }
  );

  it("puts invalid and unknown times last in both directions", () => {
    const rows = [entry("unknown"), entry("invalid", { modifiedAt: "invalid" }),
      entry("new", { modifiedAt: "2026-10-04T10:00:00Z" }),
      entry("old", { modifiedAt: "2026-09-01T10:00:00Z" })];
    expect(ordered(rows, "modified-desc")).toEqual([
      "/worktrees/new", "/worktrees/old", "/worktrees/invalid", "/worktrees/unknown"
    ]);
    expect(ordered(rows, "modified-asc")).toEqual([
      "/worktrees/old", "/worktrees/new", "/worktrees/invalid", "/worktrees/unknown"
    ]);
  });

  it("keeps zero sizes valid and unknown sizes last", () => {
    expect(ordered([entry("unknown"), entry("zero", { sizeBytes: 0 }),
      entry("large", { sizeBytes: 100 }), entry("invalid", { sizeBytes: -1 })], "size-desc"))
      .toEqual(["/worktrees/large", "/worktrees/zero", "/worktrees/invalid", "/worktrees/unknown"]);
  });

  it("prioritizes actual review eligibility without granting cleanup to dirty or kept trees", () => {
    const rows = [entry("kept", { state: "kept", keptReason: "Keep" }),
      entry("missing", { state: "unavailable", cleanupReviewAvailable: false }),
      entry("dirty", { state: "review", cleanupReviewAvailable: false, changes: [" M file"] }),
      entry("clean", { state: "review" })];
    expect(ordered(rows, "status")).toEqual([
      "/worktrees/clean", "/worktrees/dirty", "/worktrees/kept", "/worktrees/missing"
    ]);
    expect(rows[2].cleanupReviewAvailable).toBe(false);
  });

  const groups = (): Array<[string, WorktreeEntry[]]> => [
    ["b", [entry("b-main", { main: true, repositoryPath: "/repos/b", sizeBytes: 9999 }),
      entry("b1", { repositoryPath: "/repos/b", sizeBytes: 6, modifiedAt: "2026-09-01" }),
      entry("b2", { repositoryPath: "/repos/b", sizeBytes: 6, modifiedAt: "2026-10-04" })]],
    ["a", [entry("a1", { repositoryPath: "/repos/a", sizeBytes: 10, modifiedAt: "2026-10-01" })]],
    ["unknown", [entry("x", { repositoryPath: "/repos/unknown" })]],
    ["partial", [entry("p1", { repositoryPath: "/repos/partial", sizeBytes: 1000 }),
      entry("p2", { repositoryPath: "/repos/partial" })]]
  ];

  it.each([
    ["name", ["a", "b", "partial", "unknown"]],
    ["size-desc", ["b", "a", "partial", "unknown"]],
    ["modified-desc", ["b", "a", "partial", "unknown"]],
    ["modified-asc", ["b", "a", "partial", "unknown"]]
  ] as Array<[WorktreeSort, string[]]>)("orders groups by %s without counting main or partial totals", (sort, ids) => {
    expect(sortWorktreeGroups(groups(), sort).map(([id]) => id)).toEqual(ids);
  });

  it("breaks duplicate names and equal metrics by full path deterministically", () => {
    const rows = [entry("task", { path: "/z/task", sizeBytes: 20 }),
      entry("task", { path: "/a/task", sizeBytes: 20 })];
    expect(ordered(rows, "size-desc")).toEqual(["/a/task", "/z/task"]);
  });

  it("orders repository groups by their first cleanup priority", () => {
    const rows: Array<[string, WorktreeEntry[]]> = [
      ["kept", [entry("kept", { state: "kept" })]],
      ["review", [entry("dirty", { state: "review", cleanupReviewAvailable: false })]],
      ["missing", [entry("gone", { state: "unavailable", cleanupReviewAvailable: false })]],
      ["clean", [entry("ready")]]
    ];
    expect(sortWorktreeGroups(rows, "status").map(([id]) => id))
      .toEqual(["clean", "review", "kept", "missing"]);
  });

  it("handles empty, single and 500-row inventories deterministically", () => {
    expect(sortWorktreeGroups([], "status")).toEqual([]);
    expect(ordered([entry("one")], "name")).toEqual(["/worktrees/one"]);
    const rows = Array.from({ length: 500 }, (_, index) =>
      entry(`task-${499 - index}`, { sizeBytes: index })
    );
    const result = ordered(rows, "name");
    expect(result).toHaveLength(500);
    expect(result[0]).toBe("/worktrees/task-0");
    expect(result.at(-1)).toBe("/worktrees/task-499");
    expect(ordered(rows, "size-desc")[0]).toBe("/worktrees/task-0");
    expect(rows[0].path).toBe("/worktrees/task-499");
  });
});
