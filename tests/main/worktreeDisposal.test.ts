import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createWorktreeService, type WorktreeService } from "../../src/main/worktrees/worktreeService";
import { createGitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { findExecutable } from "../../src/main/executableDiscovery";
import type { ProjectStore } from "../../src/main/projects/projectStore";
import * as snapshot from "../../src/main/worktrees/worktreeSnapshot";

vi.mock("node:fs/promises", async (original) => ({ ...await original<typeof import("node:fs/promises")>() }));
const exec = promisify(execFile), roots: string[] = [], services: WorktreeService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.dispose(); vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const fixture = async () => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "aem-worktree-disposal-"))); roots.push(root);
  const repo = join(root, "repo"), tree = join(root, "trees", "task"), data = join(root, "data");
  const git = async (cwd: string, ...args: string[]) => (await exec("git", ["-c", "core.fsmonitor=false", "-C", cwd, ...args])).stdout;
  await exec("git", ["init", "-b", "main", repo]);
  await fs.writeFile(join(repo, "file.txt"), "base\n");
  await git(repo, "add", "."); await git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "base");
  await git(repo, "worktree", "add", "-b", "task", tree);
  const binary = await findExecutable("git", { environment: process.env, homeDir: homedir(), platform: process.platform }); if (!binary) throw new Error("Git required");
  const runner = createGitCommandRunner({ executablePath: binary });
  const service = createWorktreeService({ appDataRoot: data, homeDir: join(root, "home"),
    projectStore: { listLocalRootPaths: async () => [] } as unknown as ProjectStore, resolveRunner: async () => runner });
  services.push(service); await service.addScanRoot(root);
  const inventory = await service.inventory(), entry = inventory.entries.find((item) => item.path === tree)!;
  const common = entry.commonDir;
  const admin = resolve(tree, (await git(tree, "rev-parse", "--git-dir")).trim());
  return { root, repo, tree, data, git, runner, service, common, admin };
};

it("permanently deletes dirty/ignored/stale-operation contents without backups, full hashes or history analysis", async () => {
  const { root, tree, service, common, admin, runner } = await fixture();
  await fs.writeFile(join(tree, "file.txt"), "discard changed contents\n");
  await fs.writeFile(join(tree, "ignored.tmp"), "discard ignored contents\n");
  await fs.writeFile(join(tree, ".gitignore"), "ignored.tmp\n");
  await fs.writeFile(join(admin, "REBASE_HEAD"), `${"f".repeat(40)}\n`);
  const external = join(root, "external"); await fs.mkdir(external); await fs.writeFile(join(external, "keep.txt"), "untouched");
  await fs.symlink(external, join(tree, "external-link"), "dir");
  const fingerprint = vi.spyOn(snapshot, "fingerprintWorktreeTree").mockRejectedValue(new Error("no full hash"));
  const calls = vi.spyOn(runner, "run");
  const preview = await service.preview(common, tree, true, "permanent");
  const result = await service.remove(preview);
  expect(result).toMatchObject({ mode: "permanent", status: "removed", pendingGitCleanup: false });
  expect(fingerprint).not.toHaveBeenCalled();
  expect(calls.mock.calls.some(([args]) => args.some((arg) => ["status", "merge-base", "fsck", "ls-files"].includes(arg)))).toBe(false);
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.lstat(admin)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(join(external, "keep.txt"), "utf8")).toBe("untouched");
});

it("moves Trash without copying, releases the branch and restores staged/untracked contents without overwriting a reused branch", async () => {
  const { root, repo, tree, service, common, git } = await fixture();
  await fs.writeFile(join(tree, "file.txt"), "staged value\n"); await git(tree, "add", "file.txt");
  await fs.writeFile(join(tree, "local.txt"), "untracked value\n");
  const before = await fs.lstat(tree);
  const copy = vi.spyOn(fs, "cp").mockRejectedValue(new Error("no full copies"));
  const result = await service.remove(await service.preview(common, tree, true, "trash"));
  expect(result).toMatchObject({ mode: "trash", reclaimedSizeBytes: 0 });
  const registered = await git(repo, "worktree", "list", "--porcelain");
  expect(registered).not.toContain(`worktree ${tree}\n`);
  const retained = /worktree (.*\/worktree-trash\/[^\n]+\/files)/.exec(registered)![1];
  expect((await fs.lstat(retained)).ino).toBe(before.ino);
  expect(copy).not.toHaveBeenCalled();
  expect((await service.inventory()).entries.some((entry) => entry.path === retained)).toBe(false);
  const reused = join(root, "reused-branch"); await git(repo, "worktree", "add", reused, "task");
  expect((await service.restore(result.id)).status).toBe("restored");
  expect(await fs.readFile(join(tree, "local.txt"), "utf8")).toBe("untracked value\n");
  expect(await git(tree, "show", ":file.txt")).toBe("staged value\n");
  await expect(git(tree, "symbolic-ref", "-q", "HEAD")).rejects.toThrow();
  expect(await git(reused, "symbolic-ref", "HEAD")).toBe("refs/heads/task\n");
});

it("permanently empties a retained item and refuses restore afterward", async () => {
  const { tree, service, common, admin } = await fixture();
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  expect((await service.listRecovery()).records.some((item) => item.id === moved.id)).toBe(true);
  const removed = await service.remove(await service.previewTrashDeletion(moved.id));
  expect(removed).toMatchObject({ mode: "permanent", status: "removed", pendingGitCleanup: false });
  await expect(fs.lstat(admin)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await service.listRecovery()).records.some((item) => item.id === moved.id)).toBe(false);
  await expect(service.restore(moved.id)).rejects.toThrow("cannot be restored");
});

it("never overwrites a newly occupied original path during restore", async () => {
  const { tree, service, common } = await fixture();
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  await fs.mkdir(tree); await fs.writeFile(join(tree, "new.txt"), "new original content");
  await expect(service.restore(moved.id)).rejects.toThrow("occupied");
  expect(await fs.readFile(join(tree, "new.txt"), "utf8")).toBe("new original content");
});

it("keeps the exact source when a real index lock appears after preview", async () => {
  const { tree, service, common, admin } = await fixture();
  const preview = await service.preview(common, tree, true, "permanent");
  await fs.writeFile(join(admin, "index.lock"), "writer");
  await expect(service.remove(preview)).rejects.toThrow("write lock");
  expect(await fs.readFile(join(tree, "file.txt"), "utf8")).toBe("base\n");
});

it("reports a deleted folder separately from failed registration cleanup and retries only the latter", async () => {
  const { tree, service, common, admin } = await fixture();
  const original = fs.rm.bind(fs);
  vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
    if (String(path) === admin) throw Object.assign(new Error("registration denied"), { code: "EACCES" });
    return original(path, options);
  });
  const result = await service.remove(await service.preview(common, tree, true, "permanent"));
  expect(result.pendingGitCleanup).toBe(true);
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
  vi.restoreAllMocks();
  const retried = await service.remove(await service.previewTrashDeletion(result.id));
  expect(retried.pendingGitCleanup).toBe(false);
  await expect(fs.lstat(admin)).rejects.toMatchObject({ code: "ENOENT" });
});

it("resumes an interrupted Trash move while preserving exact local content", async () => {
  const { tree, data, service, common, admin } = await fixture();
  await fs.writeFile(join(tree, "local.txt"), "only local copy\n");
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  const path = join(data, "worktree-trash", `${moved.id}.json`);
  const journal = JSON.parse(await fs.readFile(path, "utf8"));
  journal.phase = "prepared";
  await fs.writeFile(path, JSON.stringify(journal));
  await fs.writeFile(join(admin, "gitdir"), `${join(tree, ".git")}\n`);
  expect((await service.restore(moved.id)).status).toBe("restored");
  expect(await fs.readFile(join(tree, "local.txt"), "utf8")).toBe("only local copy\n");
});

it("retries a partially deleted private folder even after its .git file is gone, never touching a reused original path", async () => {
  const { tree, service, common } = await fixture();
  const preview = await service.preview(common, tree, true, "permanent"), original = fs.rm.bind(fs);
  let interrupted = false;
  vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
    if (!interrupted && String(path).endsWith("/files")) {
      interrupted = true; await original(join(String(path), ".git")); throw new Error("injected disk interruption");
    }
    return original(path, options);
  });
  await expect(service.remove(preview)).rejects.toThrow("Remaining contents are in Worktree Trash");
  const recovery = (await service.listRecovery("trash")).records[0];
  expect(recovery).toMatchObject({ mode: "permanent", disposalIncomplete: true });
  await fs.mkdir(tree); await fs.writeFile(join(tree, "new.txt"), "new unrelated content");
  vi.restoreAllMocks();
  expect((await service.remove(await service.previewTrashDeletion(recovery.id))).pendingGitCleanup).toBe(false);
  expect(await fs.readFile(join(tree, "new.txt"), "utf8")).toBe("new unrelated content");
});

it("does not silently copy after a same-volume move fails", async () => {
  const { tree, service, common } = await fixture();
  const original = fs.rename.bind(fs);
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    if (String(from) === tree) throw Object.assign(new Error("move unavailable"), { code: "EXDEV" });
    return original(from, to);
  });
  const copy = vi.spyOn(fs, "cp");
  await expect(service.remove(await service.preview(common, tree, true, "trash"))).rejects.toThrow("move unavailable");
  expect(copy).not.toHaveBeenCalled();
  expect(await fs.readFile(join(tree, "file.txt"), "utf8")).toBe("base\n");
});

it("does not let a failed old recovery listing block opening Trash", async () => {
  const { data, service } = await fixture();
  await fs.writeFile(join(data, "worktree-recovery"), "unreadable legacy storage");
  await expect(service.listRecovery("trash")).resolves.toEqual({ records: [], issues: [] });
});

it("can empty its owned Trash contents even if the original repository is no longer available", async () => {
  const { repo, tree, service, common } = await fixture();
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  await fs.rm(repo, { recursive: true });
  const listed = await service.listRecovery("trash");
  expect(listed.records[0].id).toBe(moved.id);
  expect((await service.remove(await service.previewTrashDeletion(moved.id))).pendingGitCleanup).toBe(false);
  expect((await service.listRecovery("trash")).records).toEqual([]);
});

it.each(["trash", "permanent"] as const)("does not require any successful Git command to perform the explicit %s action", async (mode) => {
  const { tree, service, common, runner } = await fixture();
  vi.spyOn(runner, "run").mockRejectedValue(new Error("unrelated Git environment failure"));
  const result = await service.remove(await service.preview(common, tree, true, mode));
  expect(result).toMatchObject({ mode, status: "removed" });
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
  if (mode === "trash") {
    await service.restore(result.id);
    expect(await fs.readFile(join(tree, "file.txt"), "utf8")).toBe("base\n");
  }
});

it("keeps a new HEAD after Preview rather than detaching to the cached old revision", async () => {
  const { tree, service, common, git } = await fixture();
  const preview = await service.preview(common, tree, true, "trash");
  await git(tree, "checkout", "-b", "new-task");
  await fs.writeFile(join(tree, "file.txt"), "new commit after preview\n");
  await git(tree, "add", "file.txt");
  await git(tree, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "new task");
  const head = (await git(tree, "rev-parse", "HEAD")).trim();
  const result = await service.remove(preview);
  expect(result).toMatchObject({ mode: "trash", branch: "new-task", head });
  await service.restore(result.id);
  expect((await git(tree, "rev-parse", "HEAD")).trim()).toBe(head);
  expect(await fs.readFile(join(tree, "file.txt"), "utf8")).toBe("new commit after preview\n");
});

it.each(["prepared", "moved"] as const)("exposes a permanent deletion interrupted at %s for an explicit retry", async (phase) => {
  const { tree, data, service, common } = await fixture();
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  const path = join(data, "worktree-trash", `${moved.id}.json`);
  const journal = JSON.parse(await fs.readFile(path, "utf8"));
  journal.mode = "permanent"; journal.phase = phase;
  await fs.writeFile(path, JSON.stringify(journal));
  expect((await service.listRecovery("trash")).records[0]).toMatchObject({ mode: "permanent", disposalIncomplete: true });
  expect((await service.remove(await service.previewTrashDeletion(moved.id))).pendingGitCleanup).toBe(false);
  expect((await service.listRecovery("trash")).records).toEqual([]);
});

it("retries partial Git metadata deletion without requiring already removed identity files", async () => {
  const { tree, service, common, admin } = await fixture();
  const original = fs.rm.bind(fs);
  vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
    if (String(path) === admin) { await original(join(admin, "gitdir")); await original(join(admin, "commondir")); throw new Error("interrupted admin deletion"); }
    return original(path, options);
  });
  const result = await service.remove(await service.preview(common, tree, true, "permanent"));
  expect(result.pendingGitCleanup).toBe(true);
  vi.restoreAllMocks();
  expect((await service.remove(await service.previewTrashDeletion(result.id))).pendingGitCleanup).toBe(false);
  await expect(fs.lstat(admin)).rejects.toMatchObject({ code: "ENOENT" });
});

it("purges older items without deleting a new Worktree that reused their original path", async () => {
  const { tree, repo, service, common, git } = await fixture();
  const first = await service.remove(await service.preview(common, tree, true, "trash"));
  await git(repo, "worktree", "add", "-b", "second", tree); await service.inventory();
  const second = await service.remove(await service.preview(common, tree, true, "trash"));
  await git(repo, "worktree", "add", "-b", "third", tree); await service.inventory();
  await fs.writeFile(join(tree, "keep.txt"), "new working copy");
  for (const item of [first, second]) await service.remove(await service.previewTrashDeletion(item.id));
  expect(await fs.readFile(join(tree, "keep.txt"), "utf8")).toBe("new working copy");
  expect(await git(tree, "symbolic-ref", "HEAD")).toBe("refs/heads/third\n");
});

it("rejects a directory replaced after Preview without touching the replacement", async () => {
  const { root, tree, service, common } = await fixture();
  const preview = await service.preview(common, tree, true, "permanent");
  await fs.rename(tree, join(root, "original"));
  await fs.mkdir(tree); await fs.writeFile(join(tree, "keep.txt"), "replacement directory");
  await expect(service.remove(preview)).rejects.toThrow();
  expect(await fs.readFile(join(tree, "keep.txt"), "utf8")).toBe("replacement directory");
  expect(await fs.readFile(join(root, "original", "file.txt"), "utf8")).toBe("base\n");
});

it("rejects a journal redirected at an unrelated folder without deleting that folder", async () => {
  const { root, tree, data, service, common } = await fixture();
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  const path = join(data, "worktree-trash", `${moved.id}.json`), external = join(root, "unrelated");
  await fs.mkdir(external); await fs.writeFile(join(external, "keep.txt"), "not authorized");
  const journal = JSON.parse(await fs.readFile(path, "utf8")); journal.storage = external;
  await fs.writeFile(path, JSON.stringify(journal));
  await expect(service.previewTrashDeletion(moved.id)).rejects.toThrow("Unverified");
  expect((await service.listRecovery("trash")).issues).toHaveLength(1);
  expect(await fs.readFile(join(external, "keep.txt"), "utf8")).toBe("not authorized");
});

it.each(["trash", "permanent"] as const)("supports relative Git registration paths for %s", async (mode) => {
  const { tree, service, common, admin, git } = await fixture();
  const pointer = `gitdir: ${relative(tree, admin)}\n`;
  await fs.writeFile(join(tree, ".git"), pointer);
  await fs.writeFile(join(admin, "gitdir"), `${relative(admin, join(tree, ".git"))}\n`);
  expect((await git(tree, "rev-parse", "--show-toplevel")).trim()).toBe(tree);
  const moved = await service.remove(await service.preview(common, tree, true, mode));
  expect(moved).toMatchObject({ mode, status: "removed" });
  if (mode === "trash") {
    expect((await git(moved.retainedPath!, "rev-parse", "--show-toplevel")).trim()).toBe(moved.retainedPath);
    await service.restore(moved.id);
    expect(await fs.readFile(join(tree, ".git"), "utf8")).toBe(pointer);
    expect((await git(tree, "rev-parse", "--show-toplevel")).trim()).toBe(tree);
  }
});

it.each(["trash", "permanent"] as const)("does not let a failed progress observer interrupt %s", async (mode) => {
  const { tree, service, common } = await fixture();
  const result = await service.remove(await service.preview(common, tree, true, mode), () => { throw new Error("observer closed"); });
  expect(result).toMatchObject({ mode, status: "removed" });
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
});
