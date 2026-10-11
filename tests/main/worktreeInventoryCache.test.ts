import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createWorktreeInventoryCache } from "../../src/main/worktrees/worktreeInventoryCache";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "worktree-cache-"));
  roots.push(root);
  return join(root, "inventory.json");
};
const inventory = { scanRoots: [], configuredRoots: [], builtinRoots: [], entries: [],
  issues: [], incomplete: false, scannedAt: "2026-10-08T00:00:00.000Z" };

it("expires in memory and keeps disk snapshots stale across restarts", async () => {
  const path = await fixture();
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const cache = createWorktreeInventoryCache(path);
  await cache.save(inventory);
  expect((await cache.read()).fresh).toBe(true);
  now.mockReturnValue(301001);
  expect(await cache.read()).toEqual({ inventory, fresh: false });
  expect(await createWorktreeInventoryCache(path).read()).toEqual({ inventory, fresh: false });
  await cache.invalidate();
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("ignores corrupt and structurally invalid cache files", async () => {
  const path = await fixture();
  for (const contents of ["{", JSON.stringify({ version: 1, inventory: { entries: [{}] } }), "null"]) {
    await writeFile(path, contents);
    expect(await createWorktreeInventoryCache(path).read()).toEqual({ inventory: undefined, fresh: false });
  }
});

it("does not mark an incomplete inventory fresh", async () => {
  const cache = createWorktreeInventoryCache(await fixture());
  await cache.save({ ...inventory, incomplete: true, issues: ["Unreadable repository"] });
  expect((await cache.read()).fresh).toBe(false);
});

it("does not block mutations when a cache file cannot be removed", async () => {
  const path = await fixture();
  await mkdir(path);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const cache = createWorktreeInventoryCache(path);
  await expect(cache.invalidate()).resolves.toBeUndefined();
  expect(await cache.read()).toEqual({ inventory: undefined, fresh: false });
  expect(warning).toHaveBeenCalledOnce();
});
