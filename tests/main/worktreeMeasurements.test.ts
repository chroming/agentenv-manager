import { afterEach, expect, it, vi } from "vitest";
import { createWorktreeMeasurements } from "../../src/main/worktrees/worktreeMeasurements";
import * as snapshot from "../../src/main/worktrees/worktreeSnapshot";
import type { WorktreeInventory } from "../../src/shared/worktrees";

afterEach(() => vi.restoreAllMocks());
const inventory: WorktreeInventory = { scanRoots: [], configuredRoots: [], builtinRoots: [], issues: [], incomplete: false,
  scannedAt: "2026-11-03T00:00:00.000Z", entries: [{ path: "/repo/tree", repositoryPath: "/repo", commonDir: "/repo/.git",
    head: "a".repeat(40), main: false, detached: false, exists: true, state: "candidate", reasons: [], changes: [], ignored: [],
    submodules: false, cleanupReviewAvailable: true, manualReviewAvailable: true, headNeedsProtection: false }] };

it("publishes optional metrics without changing cleanup eligibility or resetting the scan identity", async () => {
  vi.spyOn(snapshot, "measureWorktreeTree").mockResolvedValue({ sizeBytes: 12, modifiedAt: "2024-01-01T00:00:00Z" });
  const publish = vi.fn(async (_inventory: WorktreeInventory) => undefined);
  const queue = createWorktreeMeasurements(new Map(), publish);
  const pending = queue.prepare(inventory, false);
  expect(pending.entries[0]).toMatchObject({ measurementPending: true, cleanupReviewAvailable: true });
  queue.start(pending);
  await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  const result = publish.mock.calls[0][0] as unknown as WorktreeInventory;
  expect(result).toMatchObject({ scannedAt: inventory.scannedAt, measuring: false, measurementRevision: 1 });
  expect(result.entries[0]).toMatchObject({ sizeBytes: 12, cleanupReviewAvailable: true, measurementPending: false });
  queue.cancel(); await queue.drain();
});

it("ignores a measurement that completes after cleanup or a newer scan cancelled it", async () => {
  let finish!: (value: { sizeBytes: number }) => void;
  vi.spyOn(snapshot, "measureWorktreeTree").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const publish = vi.fn(async (_inventory: WorktreeInventory) => undefined);
  const cache = new Map();
  const queue = createWorktreeMeasurements(cache, publish);
  queue.start(queue.prepare(inventory, false));
  queue.cancel();
  await queue.drain();
  finish({ sizeBytes: 99 });
  await new Promise((resolve) => setImmediate(resolve));
  expect(cache.size).toBe(0);
  expect(publish).not.toHaveBeenCalled();
});

it("treats failed statistics as unavailable, not a failed Git inventory or a zero-byte directory", async () => {
  vi.spyOn(snapshot, "measureWorktreeTree").mockRejectedValue(new Error("folder changed while measuring"));
  const publish = vi.fn(async (_inventory: WorktreeInventory) => undefined);
  const queue = createWorktreeMeasurements(new Map(), publish);
  queue.start(queue.prepare(inventory, false));
  await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  const result = publish.mock.calls[0][0] as unknown as WorktreeInventory;
  expect(result).toMatchObject({ incomplete: false, measuring: false });
  expect(result.entries[0]).toMatchObject({ state: "candidate", cleanupReviewAvailable: true, measurementPending: false });
  expect(result.entries[0].sizeBytes).toBeUndefined();
  queue.cancel(); await queue.drain();
});
