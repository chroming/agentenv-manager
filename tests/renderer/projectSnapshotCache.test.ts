// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectEnvironmentSnapshot } from "../../src/shared/types";
import { clearProjectSnapshotCache, projectSnapshotCache, readProjectSnapshot } from "../../src/renderer/projectSnapshotCache";

afterEach(() => { clearProjectSnapshotCache(); vi.restoreAllMocks(); });
const snapshot = (id: string) => ({ projectId: id } as ProjectEnvironmentSnapshot);
const install = (read: ReturnType<typeof vi.fn>) => Object.defineProperty(window, "agentEnv", {
  configurable: true, value: { inspectProject: read }
});

it("shares reads across mounts, expires results and retains them on failure", async () => {
  let finish!: (value: ProjectEnvironmentSnapshot) => void;
  const read = vi.fn(() => new Promise<ProjectEnvironmentSnapshot>((resolve) => { finish = resolve; }));
  install(read);
  const time = vi.spyOn(Date, "now").mockReturnValue(100_000);
  const first = readProjectSnapshot("a");
  expect(readProjectSnapshot("a")).toBe(first);
  finish(snapshot("a"));
  await first;
  await readProjectSnapshot("a");
  expect(read).toHaveBeenCalledOnce();
  time.mockReturnValue(161_000);
  read.mockRejectedValueOnce(new Error("Offline"));
  await expect(readProjectSnapshot("a")).rejects.toThrow("Offline");
  expect(projectSnapshotCache.get("a")).toEqual(snapshot("a"));
});

it("never republishes invalidated or superseded results", async () => {
  const finishes: Array<(value: ProjectEnvironmentSnapshot) => void> = [];
  install(vi.fn(() => new Promise<ProjectEnvironmentSnapshot>((resolve) => finishes.push(resolve))));
  const old = readProjectSnapshot("a");
  const fresh = readProjectSnapshot("a", true);
  const newest = snapshot("a");
  expect(finishes).toHaveLength(1);
  finishes[0](snapshot("old"));
  await old;
  await Promise.resolve();
  finishes[1](newest);
  await fresh;
  expect(projectSnapshotCache.get("a")).toBe(newest);
  const late = readProjectSnapshot("a", true);
  clearProjectSnapshotCache();
  finishes[2](snapshot("late"));
  await late;
  expect(projectSnapshotCache.size).toBe(0);
});
