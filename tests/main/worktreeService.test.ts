import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createWorktreeService, parseWorktreeList } from "../../src/main/worktrees/worktreeService";
import { createGitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { findExecutable } from "../../src/main/executableDiscovery";
import type { ProjectStore } from "../../src/main/projects/projectStore";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
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
        if (!interrupted && args[0] === "worktree" && args[1] === "remove") {
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
        if (!interrupted && args[0] === "rev-parse" && args[1] === "--git-dir" && options?.cwd === linked) {
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
