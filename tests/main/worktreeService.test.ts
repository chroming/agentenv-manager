import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorktreeService, parseWorktreeList } from "../../src/main/worktrees/worktreeService";
import { createGitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { findExecutable } from "../../src/main/executableDiscovery";
import type { ProjectStore } from "../../src/main/projects/projectStore";
import * as snapshot from "../../src/main/worktrees/worktreeSnapshot";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const fixture = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentenv-worktrees-")));
  roots.push(root);
  const repo = join(root, "project");
  const linked = join(root, "_worktrees", "feature");
  await run("git", ["init", repo]);
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
  it("measures cleanup sizes in the fingerprint pass without repeating inventory measurements", async () => {
    const { linked, service } = await fixture();
    const measurements = vi.spyOn(snapshot, "measureWorktreeTree");
    const inventory = await service.inventory();
    const entry = inventory.entries.find((item) => item.path === linked)!;
    measurements.mockClear();
    const preview = await service.preview(entry.commonDir, linked);
    expect(preview.entry.sizeBytes).toBe(5);
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
    expect(preview.entry.sizeBytes).toBe(13);
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
    expect(worktree.sizeBytes).toBeGreaterThan(0);
    expect(worktree.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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

  it("blocks cleanup while Git has an operation in progress", async () => {
    const { linked, service } = await fixture();
    const gitDir = (await run("git", ["-C", linked, "rev-parse", "--git-dir"])).stdout.trim();
    await writeFile(resolve(linked, gitDir, "MERGE_HEAD"), "pending\n");
    const entry = (await service.inventory()).entries.find((item) => item.path === linked)!;
    expect(entry.reasons).toContain("Git operation in progress");
    expect(entry.manualReviewAvailable).toBe(false);
    await expect(service.preview(entry.commonDir, linked, true)).rejects.toThrow("Review this worktree");
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
    await expect(service.preview(previous.commonDir, linked)).rejects.toThrow("Refresh Worktrees");
  });

  it("does not let a superseded scan clear the latest cleanup eligibility", async () => {
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
    const oldOutcome = expect(oldScan).rejects.toThrow("Worktree scan cancelled");
    await vi.waitFor(() => expect(listLocalRootPaths).toHaveBeenCalledOnce());
    const current = await service.inventory();
    releaseOld();
    await oldOutcome;
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
