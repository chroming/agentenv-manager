import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorktreeService as makeWorktreeService, parseWorktreeList, type WorktreeService } from "../../src/main/worktrees/worktreeService";
import { createGitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { findExecutable } from "../../src/main/executableDiscovery";
import type { ProjectStore } from "../../src/main/projects/projectStore";
import * as snapshot from "../../src/main/worktrees/worktreeSnapshot";

const run = promisify(execFile);
const roots: string[] = [];
const services: WorktreeService[] = [];
const createWorktreeService = (...args: Parameters<typeof makeWorktreeService>) => {
  const service = makeWorktreeService(...args); services.push(service); return service;
};
const measuredInventory = async (service: WorktreeService) => {
  await vi.waitFor(async () => expect((await service.cachedInventory()).inventory?.measuring).toBe(false));
  return (await service.cachedInventory()).inventory!;
};
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const fixture = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentenv-worktrees-")));
  roots.push(root);
  const repo = join(root, "project");
  const linked = join(root, "_worktrees", "feature");
  await run("git", ["init", "-b", "main", repo]);
  await writeFile(join(repo, "README.md"), "base\n");
  await run("git", ["-C", repo, "add", "README.md"]);
  await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "base"]);
  await run("git", ["-C", repo, "worktree", "add", "-b", "feature", linked]);
  const gitPath = await findExecutable("git", {
    environment: process.env, homeDir: homedir(), platform: process.platform
  });
  if (!gitPath) throw new Error("Git is required for the worktree fixture");
  const runner = createGitCommandRunner({ executablePath: gitPath });
  const service = createWorktreeService({
    appDataRoot: join(root, "data"),
    homeDir: join(root, "home"),
    projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
    resolveRunner: async () => runner
  });
  await service.addScanRoot(root);
  return { root, repo, linked, runner, service };
};

describe("worktree inventory and cleanup", () => {
  it("omits registered directories that are confirmed missing rather than listing unusable cleanup rows", async () => {
    const { linked, service } = await fixture();
    await service.inventory();
    await rm(linked, { recursive: true });
    expect((await service.inventory()).entries.some((entry) => entry.path === linked)).toBe(false);
  });

  it("rechecks retained directory presence when Git listing fails and still allows explicit cleanup of an existing one", async () => {
    const { linked, service, runner } = await fixture();
    const inventory = await service.inventory(), entry = inventory.entries.find((item) => item.path === linked)!;
    const runGit = runner.run.bind(runner);
    vi.spyOn(runner, "run").mockImplementation(async (args, options) => {
      if (args.includes("worktree") && args.includes("list")) throw new Error("unavailable Git listing");
      return runGit(args, options);
    });
    expect((await service.inventory("background")).entries.find((item) => item.path === linked)).toMatchObject({ exists: true, state: "unavailable" });
    expect((await service.preview(entry.commonDir, linked, true, "permanent")).mode).toBe("permanent");
    await rm(linked, { recursive: true });
    expect((await service.inventory("background")).entries.some((item) => item.path === linked)).toBe(false);
  });

  it("removes and restores local content even when REBASE_HEAD already points to missing history", async () => {
    const { linked, service } = await fixture();
    const gitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    const object = "f".repeat(40);
    await writeFile(join(gitDir, "REBASE_HEAD"), `${object}\n`);
    await writeFile(join(linked, "local.txt"), "retain local work\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    expect(removed.status).toBe("removed");
    expect(removed.unavailableOperationObjects).toEqual([{ field: "REBASE_HEAD", object }]);
    expect(removed.verificationWarnings).toBeUndefined();
    expect((await service.listRecovery()).records[0].unavailableOperationObjects).toEqual(removed.unavailableOperationObjects);
    await expect(lstat(linked)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await service.restore(removed.id)).status).toBe("restored");
    const restoredGitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    expect(await readFile(join(restoredGitDir, "REBASE_HEAD"), "utf8")).toBe(`${object}\n`);
    expect(await readFile(join(linked, "local.txt"), "utf8")).toBe("retain local work\n");
  });

  it("cleans a staged worktree without repairing or checking an unrelated broken commit-graph", async () => {
    const { repo, linked, service, runner } = await fixture();
    await writeFile(join(linked, "README.md"), "recover this staged value\n");
    await run("git", ["-C", linked, "add", "README.md"]);
    const graph = join(repo, ".git", "objects", "info", "commit-graph");
    await mkdir(join(graph, ".."), { recursive: true });
    await writeFile(graph, "invalid unrelated commit-graph cache\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const calls = vi.spyOn(runner, "run");
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    expect(removed.status).toBe("removed");
    expect(calls.mock.calls.some(([args]) => args.includes("fsck"))).toBe(false);
    expect((await service.restore(removed.id)).status).toBe("restored");
    expect((await run("git", ["-C", linked, "show", ":README.md"])).stdout).toBe("recover this staged value\n");
    expect(await readFile(graph, "utf8")).toBe("invalid unrelated commit-graph cache\n");
  });

  it.each(["unchanged", "working files", "index", "operation metadata"])("migrates a verified legacy full checkout but refuses changed %s", async (change) => {
    const { root, repo, linked, service } = await fixture();
    await writeFile(join(linked, "README.md"), "staged recovery payload\n");
    await run("git", ["-C", linked, "add", "README.md"]);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    await run("git", ["-C", repo, "worktree", "add", linked, "feature"]);
    const journalPath = join(root, "data", "worktree-recovery", `${removed.id}.json`);
    const legacy = JSON.parse(await readFile(journalPath, "utf8"));
    legacy.status = "restoring";
    legacy.restoreAttemptHash = await snapshot.hashWorktreeTree(linked);
    for (const field of ["restoreAttemptGitHash", "restoreRegistration", "operationHash", "protectedRefs", "gitStatusHash"]) delete legacy[field];
    await writeFile(journalPath, JSON.stringify(legacy));
    const gitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    if (change === "working files") await writeFile(join(linked, "README.md"), "new external contents\n");
    if (change === "index") {
      await writeFile(join(linked, "README.md"), "new external index\n");
      await run("git", ["-C", linked, "add", "README.md"]);
      await run("git", ["-C", linked, "restore", "--source=HEAD", "--worktree", "README.md"]);
    }
    if (change === "operation metadata") await writeFile(join(gitDir, "MERGE_MSG"), "new external operation data\n");
    const indexBefore = await readFile(join(gitDir, "index"));
    const bodyBefore = await readFile(join(linked, "README.md"), "utf8");
    if (change === "unchanged") {
      expect((await service.restore(removed.id)).status).toBe("restored");
      expect(await readFile(join(linked, "README.md"), "utf8")).toBe("staged recovery payload\n");
      expect((await run("git", ["-C", linked, "show", ":README.md"])).stdout).toBe("staged recovery payload\n");
    } else {
      await expect(service.restore(removed.id)).rejects.toThrow(/unverified|changed|legacy/i);
      expect(await readFile(join(gitDir, "index"))).toEqual(indexBefore);
      expect(await readFile(join(linked, "README.md"), "utf8")).toBe(bodyBefore);
      if (change === "operation metadata") expect(await readFile(join(gitDir, "MERGE_MSG"), "utf8")).toBe("new external operation data\n");
    }
  });

  it("rejects a restore admin-directory substitution before writing another worktree", async () => {
    const { root, repo, linked, service, runner } = await fixture();
    const head = (await run("git", ["-C", linked, "rev-parse", "HEAD"])).stdout.trim();
    const gitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    await writeFile(join(gitDir, "MERGE_HEAD"), `${head}\n`);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    const other = join(root, "other");
    await run("git", ["-C", repo, "worktree", "add", "--no-checkout", "--detach", other, head]);
    const otherGitDir = resolve(other, (await run("git", ["-C", other, "rev-parse", "--git-dir"])).stdout.trim());
    const otherHead = await readFile(join(otherGitDir, "HEAD"));
    const original = runner.run.bind(runner);
    vi.spyOn(runner, "run").mockImplementation(async (args, options) => {
      const result = await original(args, options);
      if (options?.cwd === linked && args.includes("rev-parse") && args.includes("--git-dir")) {
        await writeFile(join(linked, ".git"), `gitdir: ${otherGitDir}\n`);
        await writeFile(join(otherGitDir, "gitdir"), `${join(linked, ".git")}\n`);
        return { ...result, stdout: `${otherGitDir}\n` };
      }
      return result;
    });
    await expect(service.restore(removed.id)).rejects.toThrow(/registration|identity|changed/i);
    await expect(lstat(join(otherGitDir, "index"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(otherGitDir, "MERGE_HEAD"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(otherGitDir, "HEAD"))).toEqual(otherHead);
  });

  it.each(["MERGE_HEAD", "ORIG_HEAD"])("does not remove when required %s object resolution times out", async (marker) => {
    const { repo, linked, service, runner } = await fixture();
    const required = (await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
      "commit-tree", "HEAD^{tree}", "-m", `required-${marker}`])).stdout.trim();
    const gitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    await writeFile(join(gitDir, marker), `${required}\n`);
    await writeFile(join(linked, "local.txt"), "keep newest local bytes\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const original = runner.run.bind(runner);
    const spy = vi.spyOn(runner, "run").mockImplementation(async (args, options) => {
      if (args.includes("rev-parse") && args.some((arg) => arg.startsWith(`${required}^{`))) throw new Error("required object resolution timeout");
      return original(args, options);
    });
    await expect(service.remove(await service.preview(entry.commonDir, linked, true))).rejects.toThrow("required object resolution timeout");
    expect(spy.mock.calls.some(([args]) => args.includes("worktree") && args.includes("remove"))).toBe(false);
    expect(await readFile(join(linked, "local.txt"), "utf8")).toBe("keep newest local bytes\n");
  });

  it.each(["MERGE_HEAD", "rebase-merge"])("allows manual review of paused %s metadata", async (marker) => {
    const { linked, service } = await fixture();
    const gitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    if (marker === "rebase-merge") await mkdir(join(gitDir, marker));
    else await writeFile(join(gitDir, marker), (await run("git", ["-C", linked, "rev-parse", "HEAD"])).stdout);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.manualReviewAvailable).toBe(true);
    expect(entry.cleanupReviewAvailable).toBe(false);
    await expect(service.preview(entry.commonDir, linked, true)).resolves.toMatchObject({ backupRequired: true });
  });

  it("resolves preview without fingerprinting or measuring the working directory", async () => {
    const { linked, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    await measuredInventory(service);
    const fingerprint = vi.spyOn(snapshot, "fingerprintWorktreeTree").mockRejectedValue(new Error("preview traversed the whole tree"));
    const measure = vi.spyOn(snapshot, "measureWorktreeTree");
    await expect(service.preview(entry.commonDir, linked)).resolves.toMatchObject({ entry: { path: linked } });
    expect(fingerprint).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });

  it.each(["merge", "rebase"])("recovers a real paused %s, conflict index and operation commits after restart and GC", async (operation) => {
    const { root, repo, linked, service, runner } = await fixture();
    const commit = async (cwd: string, body: string) => {
      await writeFile(join(cwd, "README.md"), body);
      await run("git", ["-C", cwd, "add", "README.md"]);
      await run("git", ["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", body.trim()]);
    };
    await commit(linked, "feature\n");
    await commit(repo, "main\n");
    await expect(run("git", ["-C", linked, operation, "main"])).rejects.toThrow();
    const gitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    const marker = operation === "merge" ? "MERGE_HEAD" : "rebase-merge/orig-head";
    const metadata = await readFile(join(gitDir, marker), "utf8");
    const origHead = await readFile(join(gitDir, "ORIG_HEAD"), "utf8");
    const before = (await run("git", ["-C", linked, "status", "--porcelain=v1", "-z"])).stdout;
    const stages = (await run("git", ["-C", linked, "ls-files", "--stage"])).stdout;
    const body = await readFile(join(linked, "README.md"), "utf8");
    const mainBefore = (await run("git", ["-C", repo, "status", "--porcelain=v1", "-z"])).stdout;
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.manualReviewAvailable).toBe(true);
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    expect(removed.operationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(removed.backupHash).toBe(removed.sourceHash);
    await run("git", ["-C", repo, "branch", "-D", "feature"]);
    await run("git", ["-C", repo, "reflog", "expire", "--expire=now", "--all"]);
    await run("git", ["-C", repo, "gc", "--prune=now"]);
    const restarted = createWorktreeService({ appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore, resolveRunner: async () => runner });
    await restarted.restore(removed.id);
    const restoredGitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    expect(await readFile(join(restoredGitDir, marker), "utf8")).toBe(metadata);
    expect(await readFile(join(restoredGitDir, "ORIG_HEAD"), "utf8")).toBe(origHead);
    expect((await run("git", ["-C", linked, "status", "--porcelain=v1", "-z"])).stdout).toBe(before);
    expect((await run("git", ["-C", linked, "ls-files", "--stage"])).stdout).toBe(stages);
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe(body);
    await run("git", ["-C", linked, operation, "--abort"]);
    expect((await run("git", ["-C", repo, "status", "--porcelain=v1", "-z"])).stdout).toBe(mainBefore);
  });

  it.each(["--skip-worktree", "--assume-unchanged"])("backs up otherwise hidden %s edits without slowing the clean refs-only path", async (flag) => {
    const { root, repo, linked, service } = await fixture();
    await run("git", ["-C", linked, "update-index", flag, "README.md"]);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.manualReviewAvailable).toBe(true);
    expect(entry.cleanupReviewAvailable).toBe(false);
    await expect(service.preview(entry.commonDir, linked)).rejects.toThrow("Review this worktree");
    const preview = await service.preview(entry.commonDir, linked, true);
    expect(preview.backupRequired).toBe(true);
    expect(preview.forceRequired).toBe(false);
    await writeFile(join(linked, "README.md"), "newest authorized hidden contents\n");
    const removed = await service.remove(preview);
    expect(await readFile(join(root, "data", "worktree-recovery", removed.id, "files", "README.md"), "utf8"))
      .toBe("newest authorized hidden contents\n");
    expect(removed.reclaimedSizeBytes).toBe(0);
    await service.restore(removed.id);
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("newest authorized hidden contents\n");
    expect((await run("git", ["-C", repo, "status", "--porcelain=v1"])).stdout).toBe("");
  });

  it("does not block linked cleanup solely because the main tree has paused operation metadata", async () => {
    const { repo, linked, service } = await fixture();
    const mainHead = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout;
    await writeFile(join(repo, ".git", "MERGE_HEAD"), mainHead);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked));
    expect(removed.status).toBe("removed");
    expect(removed.backupHash).toBeUndefined();
    expect(removed.reclaimedSizeBytes).toBe(5);
    expect(await readFile(join(repo, ".git", "MERGE_HEAD"), "utf8")).toBe(mainHead);
  });

  it("protects only otherwise-unreachable staged objects in a single tree and restores them after GC", async () => {
    const { repo, linked, service, runner } = await fixture();
    for (let i = 0; i < 60; ++i) await writeFile(join(linked, `tracked-${i}`), `tracked ${i}\n`);
    await run("git", ["-C", linked, "add", "."]);
    await run("git", ["-C", linked, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "tracked files"]);
    await writeFile(join(linked, "README.md"), "unique staged blob\n");
    await run("git", ["-C", linked, "add", "README.md"]);
    await writeFile(join(linked, "README.md"), "different working bytes\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const spy = vi.spyOn(runner, "run");
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    // The recovery tree is one ref; ORIG_HEAD may require a separate operation
    // commit ref depending on Git's worktree initialization behavior.
    expect(removed.protectedRefs!.length).toBeLessThanOrEqual(2);
    const types = await Promise.all(removed.protectedRefs!.map(async ({ object }) =>
      (await run("git", ["-C", repo, "cat-file", "-t", object])).stdout.trim()));
    expect(types.filter((type) => type === "tree")).toHaveLength(1);
    expect(types.every((type) => type === "tree" || type === "commit")).toBe(true);
    expect(spy.mock.calls.filter(([args]) => args[0] === "update-ref").length).toBeLessThanOrEqual(3);
    expect(spy.mock.calls.filter(([args]) => args.includes("ls-tree"))).toHaveLength(1);
    await run("git", ["-C", repo, "reflog", "expire", "--expire=now", "--all"]);
    await run("git", ["-C", repo, "gc", "--prune=now"]);
    await service.restore(removed.id);
    expect((await run("git", ["-C", linked, "show", ":README.md"])).stdout).toBe("unique staged blob\n");
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("different working bytes\n");
  });

  it("rejects a writer lock created by the removing progress observer without deleting it", async () => {
    const { linked, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const gitDir = resolve(linked, (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim());
    // A synchronous observer starts an external lock before the final safety read.
    const fs = await import("node:fs");
    await expect(service.remove(await service.preview(entry.commonDir, linked), (phase, file) => {
      if (phase === "removing" && !file) fs.writeFileSync(join(gitDir, "HEAD.lock"), "external writer\n");
    })).rejects.toThrow("Git write lock is present (HEAD.lock)");
    expect(await readFile(join(gitDir, "HEAD.lock"), "utf8")).toBe("external writer\n");
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
  });

  it("refuses a linked Git pointer redirected to main before creating any recovery writes", async () => {
    const { repo, linked, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const mainIndex = await readFile(join(repo, ".git", "index"));
    await writeFile(join(linked, ".git"), `gitdir: ${join(repo, ".git")}\n`);
    await expect(service.preview(entry.commonDir, linked, true)).rejects.toThrow("Unverified linked Worktree Git registration");
    expect(await readFile(join(repo, ".git", "index"))).toEqual(mainIndex);
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("base\n");
  });

  it("returns actionable rows before size measurement finishes and does not wait for it to remove a tree", async () => {
    const { linked, service } = await fixture();
    let release!: (value: undefined) => void;
    const pending = new Promise<undefined>((resolve) => { release = resolve; });
    vi.spyOn(snapshot, "measureWorktreeTree").mockImplementation(() => pending);
    const scan = service.inventory();
    let ready = false;
    void scan.then(() => { ready = true; });
    try {
      await vi.waitFor(() => expect(ready).toBe(true), { timeout: 1500 });
      const inventory = await scan;
      const entry = inventory.entries.find((item) => item.path === linked)!;
      expect(entry.cleanupReviewAvailable).toBe(true);
      expect(entry.sizeBytes).toBeUndefined();
      expect(inventory.measuring).toBe(true);
      const result = await service.remove(await service.preview(entry.commonDir, linked));
      expect(result.status).toBe("removed");
    } finally { release(undefined); await scan; }
    await new Promise((resolve) => setImmediate(resolve));
    expect((await service.cachedInventory()).inventory).toBeUndefined();
  });
  it("prepares a repository batch with one registration read and independent per-tree safety checks", async () => {
    const { root, repo, linked, service, runner } = await fixture();
    const second = join(root, "second");
    await run("git", ["-C", repo, "worktree", "add", "-b", "second", second]);
    await writeFile(join(second, "note"), "keep local content\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const reads = vi.spyOn(runner, "run");
    const serialStarted = performance.now();
    await service.preview(entry.commonDir, linked, false);
    await service.preview(entry.commonDir, second, true);
    const serialMs = performance.now() - serialStarted;
    expect(reads.mock.calls.filter(([args]) => args.includes("worktree") && args.includes("list"))).toHaveLength(2);
    reads.mockClear();
    const progress = vi.fn();
    const started = performance.now();
    const prepared = await service.previewBatch([
      { commonDir: entry.commonDir, path: linked, allowDirty: false },
      { commonDir: entry.commonDir, path: second, allowDirty: true },
      { commonDir: entry.commonDir, path: repo, allowDirty: true }
    ], progress);
    console.info(`Worktree preview fixture: serial=${Math.round(serialMs)}ms for two trees, batch=${Math.round(performance.now() - started)}ms for two trees + protected main; registration reads 2 -> ${reads.mock.calls.filter(([args]) => args.includes("worktree") && args.includes("list")).length}`);
    expect(reads.mock.calls.filter(([args]) => args.includes("worktree") && args.includes("list"))).toHaveLength(1);
    expect(prepared.map((item) => item.path)).toEqual([linked, second, repo]);
    expect(prepared[0].preview?.backupRequired).toBe(false);
    expect(prepared[1].preview?.backupRequired).toBe(true);
    expect(prepared[2].error).toContain("Review this worktree");
    expect(progress.mock.calls.map(([count]) => count)).toEqual([1, 2, 3]);
    for (const [, path, result] of progress.mock.calls) {
      expect(result).toEqual(prepared.find((item) => item.path === path));
      expect(result).not.toBe(prepared.find((item) => item.path === path));
    }
    await writeFile(join(second, "note"), "changed after preview\n");
    await expect(service.remove(prepared[1].preview!)).rejects.toThrow("changed after review");
    const fresh = await service.preview(entry.commonDir, second, true);
    const stages: string[] = [];
    const updates: import("../../src/shared/worktrees").WorktreeFileProgress[] = [];
    const removed = await service.remove(fresh, (phase, fileProgress) => {
      if (!fileProgress) stages.push(phase);
      else updates.push(fileProgress);
      throw new Error("observer failed");
    });
    expect(stages).toEqual(["preparing", "backing-up", "removing", "verifying"]);
    expect(new Set(updates.map((value) => value.step))).toEqual(new Set(["fingerprinting", "copying", "verifying-source", "verifying-backup"]));
    await service.restore(removed.id);
    expect(await readFile(join(second, "note"), "utf8")).toBe("changed after preview\n");
  });

  it("streams only completed previews, isolates hostile observers and preserves final request order", async () => {
    const { repo, linked, service, runner } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const runGit = runner.run.bind(runner);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const held = vi.spyOn(runner, "run").mockImplementation(async (args, options) => {
      if (options?.cwd === linked && args.includes("status")) await gate;
      return runGit(args, options);
    });
    const observations: Array<{ completed: number; path: string; result: import("../../src/shared/worktrees").WorktreeCleanupPreparation }> = [];
    let finished = false;
    const pending = service.previewBatch([
      { commonDir: entry.commonDir, path: linked, allowDirty: false },
      { commonDir: entry.commonDir, path: repo, allowDirty: true }
    ], (completed, path, result) => {
      expect(result?.path).toBe(path);
      observations.push({ completed, path, result: structuredClone(result!) });
      result!.path = "/observer-tampered";
      if (result!.preview) result!.preview.fingerprint = "invalid";
      if (completed === 1) return Promise.reject(new Error("async hostile callback"));
      throw new Error("hostile callback");
    }).then((results) => { finished = true; return results; });
    let results: Awaited<typeof pending>;
    try {
      await vi.waitFor(() => expect(observations).toHaveLength(1));
      expect(observations[0]).toMatchObject({ completed: 1, path: repo, result: { path: repo, error: expect.any(String) } });
      expect(finished).toBe(false);
    } finally { release(); results = await pending; held.mockRestore(); }
    expect(observations.map((value) => value.completed)).toEqual([1, 2]);
    expect(observations[1].result.preview?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(results.map((result) => result.path)).toEqual([linked, repo]);
    expect(results[0].preview).toEqual(observations[1].result.preview);
    expect((await service.remove(results[0].preview!, async () => { throw new Error("async hostile callback"); })).status).toBe("removed");
  });
  it("keeps a repository across restart and new worktrees without erasing individual decisions", async () => {
    const { root, repo, linked, service, runner } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const preview = await service.preview(entry.commonDir, linked);
    await service.setKeep(entry.commonDir, linked, "Individual decision");
    await service.setRepositoryKeep(entry.commonDir, "Repository decision");
    await expect(service.remove(preview)).rejects.toThrow();
    const extra = join(root, "extra");
    await run("git", ["-C", repo, "worktree", "add", "-b", "extra", extra]);
    const restarted = createWorktreeService({ appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore, resolveRunner: async () => runner });
    const kept = await restarted.inventory();
    expect(kept.entries.find((item) => item.path === extra)).toMatchObject({ state: "kept", repositoryKeptReason: "Repository decision" });
    await expect(restarted.preview(entry.commonDir, extra)).rejects.toThrow();
    await restarted.setRepositoryKeep(entry.commonDir);
    const unkept = await restarted.inventory();
    expect(unkept.entries.find((item) => item.path === linked)).toMatchObject({ state: "kept", keptReason: "Individual decision" });
    expect(unkept.entries.find((item) => item.path === extra)).toMatchObject({ state: "candidate", repositoryKeptReason: undefined });
  });

  it("retains unreadable repository rows without retaining cleanup authorization", async () => {
    const { linked, runner, service } = await fixture();
    const previous = await service.inventory();
    const entry = previous.entries.find((item) => item.path === linked)!;
    const runGit = runner.run.bind(runner);
    const fail = vi.spyOn(runner, "run").mockImplementation(async (args, options) => {
      if (args.includes("worktree") && args.includes("list")) throw new Error("Temporary read failure");
      return runGit(args, options);
    });
    const partial = await service.inventory("background");
    expect(partial.incomplete).toBe(true);
    expect(partial.entries.find((item) => item.path === linked)).toMatchObject({
      state: "unavailable", cleanupReviewAvailable: false, manualReviewAvailable: false
    });
    expect((await service.cachedInventory()).fresh).toBe(false);
    await expect(service.preview(entry.commonDir, linked)).rejects.toThrow("Temporary read failure");
    fail.mockRestore();
    expect((await service.inventory()).entries.find((item) => item.path === linked)?.state).toBe("candidate");
  });

  it("refreshes known registrations without repeating discovery or size measurement", async () => {
    const { root, repo, service } = await fixture();
    const measure = vi.spyOn(snapshot, "measureWorktreeTree");
    await service.inventory();
    await measuredInventory(service);
    const reads = measure.mock.calls.length;
    const extra = join(root, "extra");
    await run("git", ["-C", repo, "worktree", "add", "-b", "extra", extra]);
    const refreshed = await service.inventory("background");
    await measuredInventory(service);
    expect(refreshed.entries.some((entry) => entry.path === extra)).toBe(true);
    expect(measure.mock.calls.length).toBe(reads + 1);
    await service.inventory();
    await measuredInventory(service);
    expect(measure.mock.calls.length).toBe(reads + 3);
  });

  it("shares concurrent scans and persists a display-only inventory across restart", async () => {
    const { root, linked, runner, service } = await fixture();
    const first = service.inventory();
    expect(service.inventory()).toBe(first);
    const inventory = await first;
    expect(await service.cachedInventory()).toMatchObject({ inventory, fresh: true, scanning: false });
    const restarted = createWorktreeService({ appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner });
    expect(await restarted.cachedInventory()).toMatchObject({ inventory: JSON.parse(JSON.stringify(inventory)), fresh: false });
    const entry = inventory.entries.find((item) => item.path === linked)!;
    await expect(restarted.preview(entry.commonDir, linked)).resolves.toMatchObject({ entry: { path: linked, cleanupReviewAvailable: true } });
    await service.setKeep(entry.commonDir, linked, "Keep");
    expect(await service.cachedInventory()).toMatchObject({ fresh: false });
    expect((await service.inventory("background")).entries.find((item) => item.path === linked)?.state).toBe("kept");
  });

  it("revalidates cached rows on demand after restart instead of trusting old cleanup state", async () => {
    const { root, repo, linked, runner, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const restarted = createWorktreeService({ appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner });
    await writeFile(join(linked, "README.md"), "fresh changes after cached scan\n");
    const analysis = await restarted.readAnalysis(entry.commonDir, linked);
    expect(analysis.documents.find((doc) => doc.id === "local-diff")?.content).toContain("fresh changes after cached scan");
    await expect(restarted.preview(entry.commonDir, linked)).rejects.toThrow("Review this worktree before cleanup");
    expect((await restarted.preview(entry.commonDir, linked, true)).entry.changes).toContain(" M README.md");
    await run("git", ["-C", linked, "restore", "README.md"]);
    await run("git", ["-C", repo, "worktree", "remove", linked]);
    await expect(restarted.readAnalysis(entry.commonDir, linked)).rejects.toThrow("no longer registered");
  });

  it("allows cached analysis while a refresh is reading project roots", async () => {
    const { root, linked, runner, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    let release!: (paths: string[]) => void;
    const rootsReady = new Promise<string[]>((resolve) => { release = resolve; });
    const restarted = createWorktreeService({ appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: () => rootsReady } as unknown as ProjectStore,
      resolveRunner: async () => runner });
    const scan = restarted.inventory();
    try {
      await expect(restarted.readAnalysis(entry.commonDir, linked)).resolves.toHaveProperty("documents");
    } finally {
      release([]);
      await scan;
    }
  });

  it("does not infer integration from a sibling branch, tag or recovery reference", async () => {
    const { repo, linked, service } = await fixture();
    await writeFile(join(linked, "README.md"), "unfinished\n");
    await run("git", ["-C", linked, "add", "."]);
    await run("git", ["-C", linked, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "unfinished"]);
    await run("git", ["-C", repo, "branch", "sibling", "feature"]);
    await run("git", ["-C", repo, "tag", "experiment", "feature"]);
    await run("git", ["-C", repo, "update-ref", "refs/agentenv/worktree-recovery/fixture", "feature"]);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.state).toBe("review");
    expect(entry.integration).toMatchObject({ ref: "refs/heads/main", merged: false });
    expect(entry.cleanupReviewAvailable).toBe(true);
    const removed = await service.remove(await service.preview(entry.commonDir, linked));
    expect(removed.status).toBe("removed");
  });

  it("keeps unknown and missing integration targets individually reviewable, never batch-ready", async () => {
    const { repo, linked, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    await service.setIntegrationRef(entry.commonDir, "refs/heads/main");
    await run("git", ["-C", repo, "branch", "-m", "main", "development"]);
    const stale = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(stale.integration).toMatchObject({ ref: "refs/heads/main", explicit: true });
    expect(stale.integration?.head).toBeUndefined();
    expect(stale.state).toBe("review");
    expect((await service.preview(entry.commonDir, linked)).entry.cleanupReviewAvailable).toBe(true);
    await service.setIntegrationRef(entry.commonDir);
    const unknown = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(unknown.integration?.ref).toBeUndefined();
    expect(unknown.state).toBe("review");
  });

  it("does not require the unrelated main checkout to be clean", async () => {
    const { repo, linked, service } = await fixture();
    await writeFile(join(repo, "README.md"), "unrelated main edits\n");
    await writeFile(join(repo, "private.txt"), "untracked main note\n");
    const status = (await run("git", ["-C", repo, "status", "--porcelain=v1"])).stdout;
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked));
    expect(removed.verificationWarnings).toBeUndefined();
    expect((await run("git", ["-C", repo, "status", "--porcelain=v1"])).stdout).toBe(status);
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("unrelated main edits\n");
    expect(await readFile(join(repo, "private.txt"), "utf8")).toBe("untracked main note\n");
  });

  it("removes and restores a clean linked Worktree owned by a bare repository", async () => {
    const { root, repo, runner } = await fixture();
    const bare = join(root, "bare.git"), linked = join(root, "bare-tree");
    await run("git", ["clone", "--bare", repo, bare]);
    await run("git", ["-C", bare, "worktree", "add", "-b", "bare-feature", linked, "main"]);
    const service = createWorktreeService({
      appDataRoot: join(root, "bare-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    await service.addScanRoot(linked);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked));
    expect(removed.verificationWarnings).toBeUndefined();
    await service.restore(removed.id);
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
  });

  it("rejects a Git lock created after Backup while preserving original files", async () => {
    const { root, linked, runner } = await fixture();
    let injected = false;
    const service = createWorktreeService({
      appDataRoot: join(root, "lock-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => ({ ...runner, run: async (args, options) => {
        const result = await runner.run(args, options);
        if (!injected && args[0] === "update-ref") {
          injected = true;
          const gitDir = (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim();
          await writeFile(join(resolve(linked, gitDir), "index.lock"), "external lock\n");
        }
        return result;
      } })
    });
    await service.addScanRoot(root);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    await expect(service.remove(await service.preview(entry.commonDir, linked))).rejects.toThrow("Git write lock is present (index.lock)");
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
  });

  it("uses and persists an explicit integration target without fetching or changing Git refs", async () => {
    const { repo, linked, service } = await fixture();
    await writeFile(join(linked, "README.md"), "release work\n");
    await run("git", ["-C", linked, "add", "."]);
    await run("git", ["-C", linked, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "release"]);
    await run("git", ["-C", repo, "branch", "release", "feature"]);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    await service.setIntegrationRef(entry.commonDir, "refs/heads/release");
    const updated = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(updated.state).toBe("candidate");
    expect(updated.integration).toMatchObject({ explicit: true, ref: "refs/heads/release", merged: true });
    await service.setIntegrationRef(entry.commonDir, "refs/heads/feature");
    expect((await service.inventory()).entries.find((item) => item.path === linked)?.state).toBe("review");
    await service.setIntegrationRef(entry.commonDir);
    expect((await service.inventory()).entries.find((item) => item.path === linked)?.state).toBe("review");
    await expect(service.setIntegrationRef(entry.commonDir, "refs/heads/nonexistent")).rejects.toThrow("unavailable");
  });

  it("invalidates review when the integration target changes but Worktree HEAD and files do not", async () => {
    const { repo, linked, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const preview = await service.preview(entry.commonDir, linked);
    await writeFile(join(repo, "README.md"), "main changed\n");
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "main changed"]);
    await expect(service.remove(preview)).rejects.toThrow("changed after review");
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
  });

  it("rejects an index-only change after Preview even when dirty paths and working bytes are unchanged", async () => {
    const { linked, service } = await fixture();
    await writeFile(join(linked, "README.md"), "staged before\n");
    await run("git", ["-C", linked, "add", "."]);
    await writeFile(join(linked, "README.md"), "working\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const preview = await service.preview(entry.commonDir, linked, true);
    await writeFile(join(linked, "README.md"), "staged after\n");
    await run("git", ["-C", linked, "add", "."]);
    await writeFile(join(linked, "README.md"), "working\n");
    await expect(service.remove(preview)).rejects.toThrow("changed after review");
    expect((await run("git", ["-C", linked, "show", ":README.md"])).stdout).toBe("staged after\n");
    expect((await service.listRecovery()).records).toEqual([]);
  });

  it("rejects staged-state changes after backup without removing the original Worktree", async () => {
    const { root, linked, runner } = await fixture();
    await writeFile(join(linked, "README.md"), "staged before\n");
    await run("git", ["-C", linked, "add", "."]);
    await writeFile(join(linked, "README.md"), "working\n");
    let injected = false;
    const service = createWorktreeService({
      appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => ({ ...runner, run: async (args, options) => {
        const result = await runner.run(args, options);
        if (!injected && args[0] === "update-ref") {
          injected = true;
          await writeFile(join(linked, "README.md"), "new index-only value\n");
          await run("git", ["-C", linked, "add", "."]);
          await writeFile(join(linked, "README.md"), "working\n");
        }
        return result;
      } })
    });
    await service.addScanRoot(root);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    await expect(service.remove(await service.preview(entry.commonDir, linked, true))).rejects.toThrow("changed after backup");
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("working\n");
    expect((await run("git", ["-C", linked, "show", ":README.md"])).stdout).toBe("new index-only value\n");
  });

  it("reports post-removal ref changes without losing the completed removal or overwriting another writer", async () => {
    const { root, repo, linked, runner } = await fixture();
    const service = createWorktreeService({
      appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => ({ ...runner, run: async (args, options) => {
        const result = await runner.run(args, options);
        if (args.includes("worktree") && args.includes("remove")) await run("git", ["-C", repo, "branch", "new-external-branch"]);
        return result;
      } })
    });
    await service.addScanRoot(root);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked));
    expect(removed.status).toBe("removed");
    expect(removed.verificationWarnings?.[0]).toContain("references changed");
    expect((await service.listRecovery()).records[0].verificationWarnings).toEqual(removed.verificationWarnings);
    expect((await run("git", ["-C", repo, "branch", "--list", "new-external-branch"])).stdout).toContain("new-external-branch");
  });
  it("collects fresh bounded analysis evidence without changing Git or working files", async () => {
    const { repo, linked, service, runner } = await fixture();
    await writeFile(join(linked, "README.md"), "committed implementation\n");
    await run("git", ["-C", linked, "add", "."]);
    await run("git", ["-C", linked, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "Useful implementation"]);
    await writeFile(join(linked, "README.md"), "unfinished fix\n");
    await writeFile(join(linked, "private.txt"), "must not send untracked body\n");
    const entry = (await service.inventory()).entries.find((value) => value.path === linked)!;
    const before = await run("git", ["-C", linked, "status", "--porcelain"]);
    const calls = vi.spyOn(runner, "run");
    const input = await service.readAnalysis(entry.commonDir, linked);
    expect(input.documents.find((doc) => doc.id === "commits")?.content).toContain("Useful implementation");
    expect(input.documents.find((doc) => doc.id === "committed-diff")?.content).toContain("committed implementation");
    expect(input.documents.find((doc) => doc.id === "local-diff")?.content).toContain("unfinished fix");
    expect(JSON.stringify(input)).not.toContain("must not send untracked body");
    expect(JSON.stringify(input)).not.toContain(repo);
    expect(input.partial).toBe(true);
    expect(calls.mock.calls.filter(([args]) => args.includes("diff")).every(([args]) => args.includes("--no-ext-diff") && args.includes("--no-textconv"))).toBe(true);
    expect((await run("git", ["-C", linked, "status", "--porcelain"])).stdout).toBe(before.stdout);
    expect(await readFile(join(linked, "private.txt"), "utf8")).toBe("must not send untracked body\n");
    await writeFile(join(linked, "README.md"), "changed again\n");
    expect((await service.readAnalysis(entry.commonDir, linked)).documents.find((doc) => doc.id === "local-diff")?.content).toContain("changed again");
  });

  it("rejects undiscovered, main and removed trees before exposing analysis data", async () => {
    const { repo, linked, service } = await fixture();
    await expect(service.readAnalysis(join(repo, ".git"), linked)).rejects.toThrow("Refresh Worktrees");
    const entries = (await service.inventory()).entries;
    const main = entries.find((value) => value.main)!;
    await expect(service.readAnalysis(main.commonDir, main.path)).rejects.toThrow("unavailable for analysis");
    const entry = entries.find((value) => value.path === linked)!;
    await run("git", ["-C", repo, "worktree", "remove", linked]);
    await expect(service.readAnalysis(entry.commonDir, linked)).rejects.toThrow("no longer registered");
  });
  it("measures exact cleanup sizes only during execution without repeating inventory measurements", async () => {
    const { linked, service } = await fixture();
    const measurements = vi.spyOn(snapshot, "measureWorktreeTree");
    const inventory = await service.inventory();
    const entry = inventory.entries.find((item) => item.path === linked)!;
    measurements.mockClear();
    const preview = await service.preview(entry.commonDir, linked);
    expect(preview.entry.sizeBytes === undefined || preview.entry.sizeBytes === 5).toBe(true);
    const removed = await service.remove(preview);
    expect(measurements).not.toHaveBeenCalled();
    expect(removed.sourceSizeBytes).toBe(5);
    expect(removed.reclaimedSizeBytes).toBe(5);
    expect((await service.listRecovery()).records[0].reclaimedSizeBytes).toBe(5);
  });

  it("does not count retained recovery copies as freed space", async () => {
    const { linked, service } = await fixture();
    await writeFile(join(linked, "notes.txt"), "unsaved\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const preview = await service.preview(entry.commonDir, linked, true);
    const removed = await service.remove(preview);
    expect(preview.entry.sizeBytes === undefined || preview.entry.sizeBytes === 13).toBe(true);
    expect(removed.sourceSizeBytes).toBe(13);
    expect(removed.reclaimedSizeBytes).toBe(0);
    expect(await readFile(join(linked, "notes.txt"), "utf8").catch(() => "removed")).toBe("removed");
    await service.restore(removed.id);
    expect(await readFile(join(linked, "notes.txt"), "utf8")).toBe("unsaved\n");
  });

  it("does not launch failed Git probes for ordinary scan containers", async () => {
    const { repo, linked, runner, service } = await fixture();
    const commands = vi.spyOn(runner, "run");
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toEqual([repo, linked]);
    expect(inventory.issues).toEqual([]);
    expect(commands.mock.calls.filter(([args, options]) => args.includes("rev-parse") &&
      options?.cwd && ![repo, linked, join(repo, ".git")].includes(options.cwd))).toEqual([]);
  });

  it("keeps scanning below an invalid Git marker and explains the affected location", async () => {
    const { root, repo, runner } = await fixture();
    const location = join(root, "stale-container");
    await mkdir(join(location, ".git"), { recursive: true });
    const nested = join(location, "valid-project");
    await run("git", ["clone", "--local", repo, nested]);
    const service = createWorktreeService({
      appDataRoot: join(root, "invalid-marker-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [location] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toContain(nested);
    expect(inventory.issues).toEqual([expect.stringContaining(`${location}: Git metadata is unavailable`)]);
    expect(inventory.issues.join("\n")).not.toMatch(/fatal: not a git repository/i);
    expect(inventory.incomplete).toBe(true);
  });

  it("avoids submodule process startup when the worktree has no submodule declarations", async () => {
    const { runner, service } = await fixture();
    const commands = vi.spyOn(runner, "run");
    const inventory = await service.inventory();
    expect(inventory.entries.every((entry) => !entry.submodules)).toBe(true);
    expect(commands.mock.calls.filter(([args]) => args.includes("submodule"))).toEqual([]);
  });

  it("inspects independent worktrees concurrently with a bounded process count", async () => {
    const { repo, runner, service } = await fixture();
    for (let index = 0; index < 5; index++) {
      await run("git", ["-C", repo, "worktree", "add", "-b", `parallel-${index}`, join(repo, "..", `parallel-${index}`)]);
    }
    const original = runner.run.bind(runner);
    let active = 0;
    let maximum = 0;
    vi.spyOn(runner, "run").mockImplementation(async (args, options) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        if (args.includes("status")) await new Promise((resolve) => setTimeout(resolve, 20));
        return await original(args, options);
      } finally { active--; }
    });
    const started = performance.now();
    const inventory = await service.inventory();
    console.info(`WORKTREE_SCAN_FIXTURE=${JSON.stringify({ durationMs: Math.round(performance.now() - started), entries: inventory.entries.length, maximumGitProcesses: maximum })}`);
    expect(inventory.entries).toHaveLength(7);
    expect(inventory.incomplete).toBe(false);
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(4);
  });

  it("includes an explicitly selected repository subfolder without probing unrelated containers", async () => {
    const { root, repo, linked, runner } = await fixture();
    const source = join(repo, "src", "nested");
    await mkdir(source, { recursive: true });
    const commands = vi.spyOn(runner, "run");
    const service = createWorktreeService({
      appDataRoot: join(root, "subfolder-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [source] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toEqual([repo, linked]);
    expect(inventory.incomplete).toBe(false);
    expect(commands.mock.calls.some(([, options]) => options?.cwd === source)).toBe(false);
  });

  it("protects index submodules even if their declarations and checkout are missing", async () => {
    const { root, repo, linked, service } = await fixture();
    const head = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    await run("git", ["-C", linked, "update-index", "--add", "--cacheinfo", `160000,${head},missing-module`]);
    const inventory = await service.inventory();
    const entry = inventory.entries.find((item) => item.path === linked)!;
    expect(entry.submodules).toBe(true);
    expect(entry.manualReviewAvailable).toBe(false);
    expect(entry.reasons).toContain("Contains submodules");
    await expect(service.preview(entry.commonDir, entry.path, true)).rejects.toThrow("Contains submodules");
    expect(await readFile(join(root, "project", "README.md"), "utf8")).toBe("base\n");
  });

  it("waits for cancelled inspection workers and never starts queued Git checks", async () => {
    const { repo, runner, service } = await fixture();
    for (let index = 0; index < 5; index++) {
      await run("git", ["-C", repo, "worktree", "add", "-b", `cancel-${index}`, join(repo, "..", `cancel-${index}`)]);
    }
    const original = runner.run.bind(runner);
    let ready!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let statuses = 0;
    vi.spyOn(runner, "run").mockImplementation(async (args, options) => {
      active++;
      try {
        if (args.includes("status")) {
          if (++statuses === 4) ready();
          await gate;
        }
        return await original(args, options);
      } finally { active--; }
    });
    const pending = service.inventory();
    const cancelled = expect(pending).rejects.toThrow("Worktree scan cancelled");
    await started;
    service.cancelScan();
    release();
    await cancelled;
    expect(statuses).toBe(4);
    expect(active).toBe(0);
  });

  it("parses Git's stable NUL-separated format", () => {
    expect(parseWorktreeList("worktree /tmp/main\0HEAD abc\0branch refs/heads/main\0\0worktree /tmp/other\0HEAD def\0detached\0locked testing\0\0"))
      .toEqual([
        { path: "/tmp/main", head: "abc", branch: "main", detached: false, locked: undefined, prunable: undefined },
        { path: "/tmp/other", head: "def", branch: undefined, detached: true, locked: "testing", prunable: undefined }
      ]);
  });

  it("discovers a linked tree without adding a Workspace, then removes and restores it", async () => {
    const { root, repo, linked, service } = await fixture();
    const inventory = await service.inventory();
    expect(inventory.incomplete).toBe(false);
    expect(inventory.entries).toHaveLength(2);
    const worktree = inventory.entries.find((entry) => entry.path === linked)!;
    expect(worktree.main).toBe(false);
    expect(worktree.cleanupReviewAvailable).toBe(true);
    const measured = (await measuredInventory(service)).entries.find((entry) => entry.path === linked)!;
    expect(measured.sizeBytes).toBeGreaterThan(0);
    expect(measured.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(inventory.entries.find((entry) => entry.path === repo)?.main).toBe(true);
    const preview = await service.preview(worktree.commonDir, linked);
    expect(preview.backupRequired).toBe(false);
    const removed = await service.remove(preview);
    expect(removed.status).toBe("removed");
    expect(removed.backupHash).toBeUndefined();
    await expect(lstat(join(root, "data", "worktree-recovery", removed.id, "files"))).rejects.toThrow();
    expect((await run("git", ["-C", repo, "worktree", "list", "--porcelain"])).stdout).not.toContain(linked);
    expect((await run("git", ["-C", repo, "rev-parse", "refs/heads/feature"])).stdout.trim()).toBe(worktree.head);
    const restored = await service.restore(removed.id);
    expect(restored.status).toBe("restored");
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
  });

  it("finds existing Superpowers and common worktree folders without saving them as user locations", async () => {
    const { root, repo, linked } = await fixture();
    const homeDir = join(root, "home");
    const superpowersRoot = join(homeDir, ".config", "superpowers", "worktrees");
    await mkdir(superpowersRoot, { recursive: true });
    const superpowersTree = join(superpowersRoot, "project", "feature-two");
    await run("git", ["-C", repo, "worktree", "add", "-b", "feature-two", superpowersTree]);
    const gitPath = await findExecutable("git", {
      environment: process.env, homeDir: homedir(), platform: process.platform
    });
    if (!gitPath) throw new Error("Git is required for the worktree fixture");
    const service = createWorktreeService({
      appDataRoot: join(root, "builtin-data"), homeDir,
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => createGitCommandRunner({ executablePath: gitPath })
    });
    const inventory = await service.inventory();
    expect(inventory.builtinRoots).toContain(superpowersRoot);
    expect(inventory.configuredRoots).toEqual([]);
    expect(inventory.entries.map((entry) => entry.path)).toContain(superpowersTree);
    expect(inventory.entries.map((entry) => entry.path)).toContain(linked);
  });

  it("keeps dirty or stale worktrees and does not discard their files", async () => {
    const { linked, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const preview = await service.preview(entry.commonDir, linked);
    await writeFile(join(linked, "important.txt"), "keep this\n");
    await expect(service.remove(preview)).rejects.toThrow("changed after review");
    expect(await readFile(join(linked, "important.txt"), "utf8")).toBe("keep this\n");
    await expect(service.preview(entry.commonDir, linked)).rejects.toThrow("Review this worktree");
  });

  it.each([
    [".codex", "worktrees"], [".claude", "worktrees"], [".cursor", "worktrees"],
    ["orca", "workspaces"], ["Documents", "Git"], ["Projects"]
  ])("automatically discovers existing %s/%s locations without saving a Workspace", async (...parts) => {
    const { root, repo, linked, runner } = await fixture();
    const homeDir = join(root, "home");
    const container = join(homeDir, ...parts.filter(Boolean));
    const worktree = join(container, "project", "review");
    await run("git", ["-C", repo, "worktree", "add", "-b", "automatic-location", worktree]);
    const service = createWorktreeService({
      appDataRoot: join(root, "automatic-data"), homeDir,
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const inventory = await service.inventory();
    expect(inventory.builtinRoots).toContain(container);
    expect(inventory.configuredRoots).toEqual([]);
    expect(inventory.scanRoots).not.toContain(homeDir);
    expect(inventory.entries.map((entry) => entry.path)).toContain(worktree);
    expect(inventory.entries.map((entry) => entry.path)).toContain(linked);
    expect(inventory.incomplete).toBe(false);
    await expect(lstat(join(root, "automatic-data", "worktree-locations.json"))).rejects.toThrow();
  });

  it("finds repositories in conventional containers and includes registered trees outside the scope", async () => {
    const { root, repo, runner } = await fixture();
    const homeDir = join(root, "home");
    const container = join(homeDir, "Github");
    const clone = join(container, "team", "app");
    await mkdir(join(container, "team"), { recursive: true });
    await run("git", ["clone", "--local", repo, clone]);
    const outside = join(root, "elsewhere", "review");
    await run("git", ["-C", clone, "worktree", "add", "-b", "review", outside]);
    const service = createWorktreeService({
      appDataRoot: join(root, "automatic-data"), homeDir,
      projectStore: { listLocalRootPaths: async () => [clone] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([clone, outside]));
    expect(inventory.entries).toHaveLength(2);
    expect(inventory.builtinRoots.filter((path) => path === container)).toHaveLength(1);
    expect(inventory.scanRoots).not.toContain(outside);
  });

  it("canonicalizes aliased manual and Workspace locations before probing", async () => {
    const { root, repo, linked, runner } = await fixture();
    const alias = join(root, "repo-alias");
    await symlink(repo, alias, "dir");
    const runGit = vi.spyOn(runner, "run");
    const service = createWorktreeService({
      appDataRoot: join(root, "alias-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [repo, alias] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    await service.addScanRoot(alias);
    const inventory = await service.inventory();
    expect(inventory.scanRoots).toEqual([repo]);
    expect(inventory.configuredRoots).toEqual([repo]);
    expect(inventory.entries.map((entry) => entry.path)).toEqual([repo, linked]);
    expect(runGit.mock.calls.filter(([args]) => args.includes("worktree"))).toHaveLength(1);
  });

  it("visits later roots before an earlier container can consume the directory budget", async () => {
    const { root, repo, runner } = await fixture();
    const broad = join(root, "many-folders");
    await mkdir(broad);
    for (let offset = 0; offset < 5001; offset += 250) {
      await Promise.all(Array.from({ length: Math.min(250, 5001 - offset) }, (_, index) => mkdir(join(broad, String(offset + index)))));
    }
    const later = join(root, "later-container");
    const clone = join(later, "team", "project");
    await mkdir(join(later, "team"), { recursive: true });
    await run("git", ["clone", "--local", repo, clone]);
    const linked = join(root, "later-linked");
    await run("git", ["-C", clone, "worktree", "add", "-b", "later", linked]);
    const service = createWorktreeService({
      appDataRoot: join(root, "bounded-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [later] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    await service.addScanRoot(broad);
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toContain(linked);
    expect(inventory.incomplete).toBe(true);
    expect(inventory.issues).toEqual([expect.stringContaining("directory limit")]);
    expect(inventory.issues[0]).toContain(broad);
    expect(inventory.issues[0]).toContain("Registered Worktrees from discovered repositories are already included");
  }, 20_000);

  it("removes legacy aliased scan locations without touching their folders", async () => {
    const { root, repo, runner } = await fixture();
    const alias = join(root, "legacy-alias");
    await symlink(repo, alias, "dir");
    const appDataRoot = join(root, "legacy-data");
    await mkdir(appDataRoot);
    await writeFile(join(appDataRoot, "worktree-locations.json"), JSON.stringify({ formatVersion: 1, scanRoots: [alias], kept: {} }));
    const service = createWorktreeService({
      appDataRoot, homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    expect((await service.inventory()).configuredRoots).toEqual([repo]);
    await service.removeScanRoot(repo);
    expect((await service.inventory()).scanRoots).toEqual([]);
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("base\n");
  });

  it("does not turn an automatic location linked to Home into a whole-Home scan", async () => {
    const { root, runner } = await fixture();
    const homeDir = join(root, "home");
    await mkdir(homeDir);
    await symlink(homeDir, join(homeDir, "worktrees"), "dir");
    const service = createWorktreeService({
      appDataRoot: join(root, "safe-data"), homeDir,
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const inventory = await service.inventory();
    expect(inventory.scanRoots).toEqual([]);
    expect(inventory.incomplete).toBe(true);
    expect(inventory.issues[0]).toContain("resolves to Home");
  });

  it("continues discovering nested repositories, not only the first repository in a location", async () => {
    const { root, repo, service } = await fixture();
    const nested = join(repo, "tools", "nested-project");
    await mkdir(join(repo, "tools"));
    await run("git", ["clone", "--local", repo, nested]);
    const nestedTree = join(root, "nested-worktree");
    await run("git", ["-C", nested, "worktree", "add", "-b", "nested", nestedTree]);
    const inventory = await service.inventory();
    expect(inventory.entries).toHaveLength(4);
    expect(inventory.entries.find((entry) => entry.path === nestedTree)?.repositoryPath).toBe(nested);
    expect(inventory.incomplete).toBe(false);
  });

  it("discovers repositories beyond seven container levels without a depth warning", async () => {
    const { root, repo, runner } = await fixture();
    const location = join(root, "deep-container");
    const nested = join(location, ...Array.from({ length: 8 }, (_, index) => `level-${index}`));
    await mkdir(join(nested, ".."), { recursive: true });
    await run("git", ["clone", "--local", repo, nested]);
    const service = createWorktreeService({
      appDataRoot: join(root, "depth-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    await service.addScanRoot(location);
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toEqual([nested]);
    expect(inventory.incomplete).toBe(false);
    expect(inventory.issues).toEqual([]);
  });

  it("does not mistake deep tracked source folders for incomplete Worktree discovery", async () => {
    const { repo, linked, service, runner } = await fixture();
    const source = join(repo, "src", ...Array.from({ length: 10 }, (_, index) => `level-${index}`));
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "source.txt"), "tracked source\n");
    await run("git", ["-C", repo, "add", "src"]);
    const commands = vi.spyOn(runner, "run");
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toEqual([repo, linked]);
    expect(inventory.incomplete).toBe(false);
    expect(inventory.issues).toEqual([]);
    expect(commands.mock.calls.filter(([args]) => args.includes("worktree") && args.includes("list"))).toHaveLength(1);
  });

  it("finds ignored nested repositories and their deeply located registered trees", async () => {
    const { root, repo, runner } = await fixture();
    await writeFile(join(repo, ".gitignore"), "nested/\n.worktrees/\n");
    const nested = join(repo, "nested", "team", "project");
    await mkdir(join(nested, ".."), { recursive: true });
    await run("git", ["clone", "--local", repo, nested]);
    const nestedTree = join(root, "elsewhere", ...Array.from({ length: 12 }, (_, index) => `level-${index}`), "review");
    await run("git", ["-C", nested, "worktree", "add", "-b", "nested-review", nestedTree]);
    const localTree = join(repo, ".worktrees", "local-review");
    await run("git", ["-C", repo, "worktree", "add", "-b", "local-review", localTree]);
    const service = createWorktreeService({
      appDataRoot: join(root, "ignored-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [repo] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([nested, nestedTree, localTree]));
    expect(inventory.incomplete).toBe(false);
    expect(inventory.issues).toEqual([]);
  });

  it("discovers a declared submodule under tracked source paths without crawling that source", async () => {
    const { root, repo, runner } = await fixture();
    const submodulePath = ["modules", ...Array.from({ length: 9 }, (_, index) => `level-${index}`), "dependency"].join("/");
    await run("git", ["-C", repo, "-c", "protocol.file.allow=always", "submodule", "add", repo, submodulePath]);
    const submodule = join(repo, submodulePath);
    const submoduleTree = join(root, "submodule-review");
    await run("git", ["-C", submodule, "worktree", "add", "-b", "dependency-review", submoduleTree]);
    const service = createWorktreeService({
      appDataRoot: join(root, "submodule-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [repo] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const inventory = await service.inventory();
    expect(inventory.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([submodule, submoduleTree]));
    expect(inventory.issues).toEqual([]);
    expect(inventory.incomplete).toBe(false);
    const main = inventory.entries.find((entry) => entry.path === submodule)!;
    expect(main.main).toBe(true);
    expect(main.cleanupReviewAvailable).toBe(false);
    await expect(service.preview(main.commonDir, main.path)).rejects.toThrow("Main working tree");
  });

  it("does not expand an automatic container to a Home-level Git repository", async () => {
    const { root, runner } = await fixture();
    const homeDir = join(root, "home");
    await run("git", ["init", homeDir]);
    const container = join(homeDir, "Github");
    await mkdir(container);
    const service = createWorktreeService({
      appDataRoot: join(root, "home-repo-data"), homeDir,
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const inventory = await service.inventory();
    expect(inventory.scanRoots).toEqual([container]);
    expect(inventory.entries).toEqual([]);
    expect(inventory.incomplete).toBe(true);
    expect(inventory.issues[0]).toContain("repository root is Home");
  });

  it("does not refresh the Git index while passively inspecting a worktree", async () => {
    const { linked, service, runner } = await fixture();
    const index = (await runner.run(["rev-parse", "--git-path", "index"], { cwd: linked })).stdout.trim();
    const original = await readFile(index);
    const timestamp = (await lstat(index)).mtimeMs;
    const later = new Date(Date.now() + 2000);
    await utimes(join(linked, "README.md"), later, later);
    const runGit = vi.spyOn(runner, "run");
    await service.inventory();
    expect(await readFile(index)).toEqual(original);
    expect((await lstat(index)).mtimeMs).toBe(timestamp);
    expect(runGit.mock.calls.find(([args]) => args.includes("status"))?.[1]?.env).toEqual({ GIT_OPTIONAL_LOCKS: "0" });
    expect(runGit.mock.calls.filter(([args]) => args.includes("status")).every(([args]) => args.includes("core.fsmonitor=false"))).toBe(true);
  });

  it("never treats a user-kept tree as a cleanup candidate", async () => {
    const { linked, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    await service.setKeep(entry.commonDir, linked, "active test scene");
    const kept = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(kept.state).toBe("kept");
    await expect(service.preview(entry.commonDir, linked)).rejects.toThrow("Review this worktree");
  });

  it("reports when cleanup would leave a saved Workspace pointing at a removed folder", async () => {
    const { root, linked } = await fixture();
    const alias = join(root, "workspace-alias");
    await symlink(linked, alias, "dir");
    let savedRoots = [join(linked, "nested", "project")];
    const gitPath = await findExecutable("git", {
      environment: process.env, homeDir: homedir(), platform: process.platform
    });
    if (!gitPath) throw new Error("Git is required for the worktree fixture");
    const service = createWorktreeService({
      appDataRoot: join(root, "workspace-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => savedRoots } as unknown as ProjectStore,
      resolveRunner: async () => createGitCommandRunner({ executablePath: gitPath })
    });
    await service.addScanRoot(root);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect((await service.preview(entry.commonDir, linked)).savedWorkspace).toBe(true);
    savedRoots = [alias];
    expect((await service.preview(entry.commonDir, linked)).savedWorkspace).toBe(true);
  });

  it("does not offer Restore when cleanup stopped before removing a changed original", async () => {
    const { root, linked, runner } = await fixture();
    let changed = false;
    const service = createWorktreeService({
      appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => ({ ...runner, run: async (args, options) => {
        const result = await runner.run(args, options);
        if (!changed && args[0] === "update-ref") {
          changed = true;
          await writeFile(join(linked, "README.md"), "external change\n");
        }
        return result;
      } })
    });
    await service.addScanRoot(root);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    await expect(service.remove(await service.preview(entry.commonDir, linked)))
      .rejects.toThrow("changed after backup");
    const pending = (await service.listRecovery()).records[0];
    expect(pending.status).toBe("prepared");
    await expect(service.restore(pending.id)).rejects.toThrow("Cleanup is incomplete");
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("external change\n");
    await writeFile(join(linked, "README.md"), "base\n");
    expect((await service.listRecovery()).records[0].status).toBe("unchanged");
  });

  it("resumes a partial restore only while its files remain unchanged", async () => {
    const { root, linked, runner, service } = await fixture();
    await writeFile(join(linked, "note.txt"), "important\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    let interrupted = false;
    const resuming = createWorktreeService({
      appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => ({ ...runner, run: async (args, options) => {
        const result = await runner.run(args, options);
        if (!interrupted && args[0] === "worktree" && args[1] === "add") {
          interrupted = true;
          throw new Error("Simulated interruption after checkout");
        }
        return result;
      } })
    });
    await expect(resuming.restore(removed.id)).rejects.toThrow("Simulated interruption");
    expect((await resuming.listRecovery()).records[0]).toMatchObject({
      status: "restoring", restoreAttemptHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
    await writeFile(join(linked, "external.txt"), "do not overwrite\n");
    await expect(resuming.restore(removed.id)).rejects.toThrow("unverified files");
    expect(await readFile(join(linked, "external.txt"), "utf8")).toBe("do not overwrite\n");
    await rm(join(linked, "external.txt"));
    expect((await resuming.restore(removed.id)).status).toBe("restored");
    expect(await readFile(join(linked, "note.txt"), "utf8")).toBe("important\n");
  });

  it("recognizes a removal completed before its result was recorded", async () => {
    const { root, linked, runner } = await fixture();
    let interrupted = false;
    const service = createWorktreeService({
      appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => ({ ...runner, run: async (args, options) => {
        const result = await runner.run(args, options);
        if (!interrupted && args.includes("worktree") && args.includes("remove")) {
          interrupted = true;
          throw new Error("Simulated interruption after removal");
        }
        return result;
      } })
    });
    await service.addScanRoot(root);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    await expect(service.remove(await service.preview(entry.commonDir, linked)))
      .rejects.toThrow("needs recovery");
    const record = (await service.listRecovery()).records[0];
    expect(record.status).toBe("removed");
    expect((await service.restore(record.id)).status).toBe("restored");
    expect(await readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
  });

  it("can finish restoring staged files after an interrupted index copy", async () => {
    const { root, linked, runner, service } = await fixture();
    await writeFile(join(linked, "README.md"), "staged\n");
    await run("git", ["-C", linked, "add", "README.md"]);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    let interrupted = false;
    const resuming = createWorktreeService({
      appDataRoot: join(root, "data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => ({ ...runner, run: async (args, options) => {
        if (!interrupted && args.includes("rev-parse") && args.includes("--git-dir") && options?.cwd === linked) {
          interrupted = true;
          throw new Error("Simulated interruption before index copy");
        }
        return runner.run(args, options);
      } })
    });
    await expect(resuming.restore(removed.id)).rejects.toThrow("Simulated interruption");
    expect((await resuming.listRecovery()).records[0].status).toBe("restoring");
    expect((await resuming.restore(removed.id)).status).toBe("restored");
    expect((await run("git", ["-C", linked, "status", "--porcelain=v1"])).stdout).toContain("M  README.md");
  });

  it("requires explicit dirty review and restores both files and staged state", async () => {
    const { linked, service } = await fixture();
    await writeFile(join(linked, "README.md"), "staged change\n");
    await run("git", ["-C", linked, "add", "README.md"]);
    await writeFile(join(linked, "untracked.txt"), "private note\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.state).toBe("review");
    expect(entry.manualReviewAvailable).toBe(true);
    await expect(service.preview(entry.commonDir, linked)).rejects.toThrow("Review this worktree");
    const preview = await service.preview(entry.commonDir, linked, true);
    expect(preview.forceRequired).toBe(true);
    expect(preview.backupRequired).toBe(true);
    const removed = await service.remove(preview);
    expect(removed.status).toBe("removed");
    expect(removed.backupHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await service.listRecovery()).records.at(0)?.indexHash).toMatch(/^[0-9a-f]{64}$/);
    await service.restore(removed.id);
    expect(await readFile(join(linked, "untracked.txt"), "utf8")).toBe("private note\n");
    const status = (await run("git", ["-C", linked, "status", "--porcelain=v1"])).stdout;
    expect(status).toContain("M  README.md");
    expect(status).toContain("?? untracked.txt");
  });

  it("keeps locked trees out of cleanup", async () => {
    const { linked, repo, service } = await fixture();
    await run("git", ["-C", repo, "worktree", "lock", "--reason", "active test", linked]);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.state).toBe("kept");
    expect(entry.locked).toBe("active test");
    await expect(service.preview(entry.commonDir, linked, true)).rejects.toThrow("Review this worktree");
  });

  it("protects a detached commit with a recovery ref before removal", async () => {
    const { linked, repo, service } = await fixture();
    await run("git", ["-C", linked, "checkout", "--detach"]);
    await writeFile(join(linked, "work.txt"), "unmerged commit\n");
    await run("git", ["-C", linked, "add", "work.txt"]);
    await run("git", ["-C", linked, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "detached work"]);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.headNeedsProtection).toBe(true);
    await expect(service.preview(entry.commonDir, linked)).rejects.toThrow("Review this worktree");
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    expect(removed.protectedRef).toMatch(/^refs\/agentenv\/worktree-recovery\//);
    expect((await run("git", ["-C", repo, "rev-parse", removed.protectedRef!])).stdout.trim()).toBe(entry.head);
    await service.restore(removed.id);
    expect(await readFile(join(linked, "work.txt"), "utf8")).toBe("unmerged commit\n");
  });

  it("backs up ignored files before an individually approved cleanup", async () => {
    const { linked, service } = await fixture();
    await writeFile(join(linked, ".gitignore"), "secret.env\n");
    await writeFile(join(linked, "secret.env"), "local-only\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.ignored).toContain("secret.env");
    expect(entry.state).toBe("review");
    const removed = await service.remove(await service.preview(entry.commonDir, linked, true));
    await service.restore(removed.id);
    expect(await readFile(join(linked, "secret.env"), "utf8")).toBe("local-only\n");
  });

  it.each(["index.lock", "HEAD.lock"])("blocks cleanup while Git has an active %s writer", async (marker) => {
    const { linked, service } = await fixture();
    const gitDir = (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim();
    await writeFile(resolve(linked, gitDir, marker), "pending\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.reasons).toContain("Git operation in progress: active writer lock");
    expect(entry.manualReviewAvailable).toBe(false);
    await expect(service.preview(entry.commonDir, linked, true)).rejects.toThrow("Review this worktree");
    expect(await readFile(resolve(linked, gitDir, marker), "utf8")).toBe("pending\n");
  });

  it("blocks cleanup of a worktree containing an independent nested repository", async () => {
    const { linked, service } = await fixture();
    const nested = join(linked, "scratch", "nested");
    await mkdir(join(linked, "scratch"));
    await run("git", ["init", nested]);
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.reasons).toContain("Contains a nested repository");
    expect(entry.manualReviewAvailable).toBe(false);
    await expect(service.preview(entry.commonDir, linked, true)).rejects.toThrow("Review this worktree");
  });

  it("cancels an in-flight inventory before it publishes a partial result", async () => {
    const { service, linked } = await fixture();
    const previous = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const pending = service.inventory();
    service.cancelScan();
    await expect(pending).rejects.toThrow("Worktree scan cancelled");
    await expect(service.preview(previous.commonDir, linked)).resolves.toMatchObject({ entry: { path: linked } });
  });

  it("joins an in-flight scan and retains its cleanup eligibility", async () => {
    const { root, linked, runner } = await fixture();
    let releaseOld!: () => void;
    const oldRead = new Promise<void>((resolve) => { releaseOld = resolve; });
    const listLocalRootPaths = vi.fn()
      .mockImplementationOnce(async () => { await oldRead; return [root]; })
      .mockResolvedValue([root]);
    const service = createWorktreeService({
      appDataRoot: join(root, "concurrent-data"), homeDir: join(root, "home"),
      projectStore: { listLocalRootPaths } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const oldScan = service.inventory();
    await vi.waitFor(() => expect(listLocalRootPaths).toHaveBeenCalledOnce());
    const joined = service.inventory();
    expect(joined).toBe(oldScan);
    releaseOld();
    const current = await joined;
    expect(listLocalRootPaths).toHaveBeenCalledOnce();
    const entry = current.entries.find((item) => item.path === linked)!;
    expect((await service.preview(entry.commonDir, linked)).entry.path).toBe(linked);
  });

  it("cancels a scan even when no scan locations exist and can scan again", async () => {
    const { root, runner } = await fixture();
    const service = createWorktreeService({
      appDataRoot: join(root, "empty-data"), homeDir: join(root, "empty-home"),
      projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore,
      resolveRunner: async () => runner
    });
    const pending = service.inventory();
    service.cancelScan();
    await expect(pending).rejects.toMatchObject({ name: "WorktreeScanCancelledError" });
    expect((await service.inventory()).entries).toEqual([]);
  });

  it("rejects a preview that tries to suppress the required full backup", async () => {
    const { linked, service } = await fixture();
    await writeFile(join(linked, "important.txt"), "local work\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const preview = await service.preview(entry.commonDir, linked, true);
    await expect(service.remove({ ...preview, backupRequired: false })).rejects.toThrow("review expired");
    expect(await readFile(join(linked, "important.txt"), "utf8")).toBe("local work\n");
  });

  it("restores the saved commit detached if the original branch moved", async () => {
    const { repo, linked, service } = await fixture();
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    const removed = await service.remove(await service.preview(entry.commonDir, linked));
    await writeFile(join(repo, "README.md"), "new main commit\n");
    await run("git", ["-C", repo, "add", "README.md"]);
    await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "later"]);
    const later = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    await run("git", ["-C", repo, "update-ref", "refs/heads/feature", later]);
    await service.restore(removed.id);
    expect((await run("git", ["-C", linked, "rev-parse", "HEAD"])).stdout.trim()).toBe(entry.head);
    expect((await run("git", ["-C", repo, "rev-parse", "refs/heads/feature"])).stdout.trim()).toBe(later);
    expect((await run("git", ["-C", linked, "branch", "--show-current"])).stdout.trim()).toBe("");
  });
});
