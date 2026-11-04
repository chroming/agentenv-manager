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
import { canSelectWorktreeForCleanup, isAutomaticCleanupCandidate } from "../../src/shared/worktrees";

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
  const projectStore = { listLocalRootPaths: vi.fn<() => Promise<string[]>>().mockResolvedValue([]) };
  const service = createWorktreeService({ appDataRoot: data, homeDir: join(root, "home"),
    projectStore: projectStore as unknown as ProjectStore, resolveRunner: async () => runner });
  services.push(service); await service.addScanRoot(root);
  const inventory = await service.inventory(), entry = inventory.entries.find((item) => item.path === tree)!;
  const common = entry.commonDir;
  const admin = resolve(tree, (await git(tree, "rev-parse", "--git-dir")).trim());
  return { root, repo, tree, data, git, runner, service, common, admin, projectStore };
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

it("deletes the selected directory without touching a Git lock that appears after preview", async () => {
  const { tree, service, common, admin } = await fixture();
  const preview = await service.preview(common, tree, true, "permanent");
  await fs.writeFile(join(admin, "index.lock"), "writer");
  expect((await service.remove(preview)).status).toBe("removed");
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(join(admin, "index.lock"), "utf8")).toBe("writer");
});

it.each(["trash", "permanent"] as const)("completes explicit %s with an existing Git writer lock without altering Git metadata", async (mode) => {
  const { tree, service, common, admin, repo } = await fixture();
  await fs.writeFile(join(admin, "index.lock"), "active writer");
  const head = await fs.readFile(join(admin, "HEAD"), "utf8"), backlink = await fs.readFile(join(admin, "gitdir"), "utf8");
  const preview = await service.preview(common, tree, true, mode);
  expect(preview.gitWriteInProgress).toBe(true);
  const result = await service.remove(preview);
  expect(result).toMatchObject({ mode, status: "removed" });
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(join(admin, "index.lock"), "utf8")).toBe("active writer");
  expect(await fs.readFile(join(admin, "HEAD"), "utf8")).toBe(head);
  expect(await fs.readFile(join(admin, "gitdir"), "utf8")).toBe(backlink);
  expect(await fs.readFile(join(repo, "file.txt"), "utf8")).toBe("base\n");
  if (mode === "trash") {
    await service.restore(result.id);
    expect(await fs.readFile(join(tree, "file.txt"), "utf8")).toBe("base\n");
    expect(await fs.readFile(join(admin, "index.lock"), "utf8")).toBe("active writer");
  }
});

it("deletes retained contents while leaving a newly busy Git registration for optional cleanup", async () => {
  const { tree, service, common, admin } = await fixture();
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  await fs.writeFile(join(admin, "HEAD.lock"), "active writer");
  const result = await service.remove(await service.previewTrashDeletion(moved.id));
  expect(result).toMatchObject({ mode: "permanent", status: "removed", pendingGitCleanup: true });
  await expect(fs.lstat(moved.retainedPath!)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await service.listRecovery("trash")).records).toEqual([]);
  expect((await service.listRecovery("all")).records.find((record) => record.id === moved.id)?.pendingGitCleanup).toBe(true);
  expect(await fs.readFile(join(admin, "HEAD.lock"), "utf8")).toBe("active writer");
  await fs.rm(join(admin, "HEAD.lock"));
  const retried = await service.remove(await service.previewTrashDeletion(moved.id));
  expect(retried.pendingGitCleanup).toBe(false);
  expect(retried.reclaimedSizeBytes).toBe(0);
});

it.each(["trash", "permanent"] as const)("prepares %s even when optional Workspace metadata is unreadable", async (mode) => {
  const { tree, service, common, projectStore } = await fixture();
  projectStore.listLocalRootPaths.mockRejectedValue(new Error("unreadable Workspace metadata"));
  const preview = await service.preview(common, tree, true, mode);
  expect(preview.workspaceImpactUnknown).toBe(true);
  expect((await service.remove(preview)).mode).toBe(mode);
});

it("prepares a batch once with bounded, unavailable Workspace information instead of stalling cleanup", async () => {
  const { tree, repo, root, service, common, projectStore, git } = await fixture();
  const second = join(root, "second");
  await git(repo, "worktree", "add", "-b", "second", second); await service.inventory();
  projectStore.listLocalRootPaths.mockClear().mockImplementation(() => new Promise(() => {}));
  const started = Date.now();
  const batch = await service.previewBatch([tree, second].map((path) => ({ commonDir: common, path, mode: "permanent", allowDirty: true })));
  expect(Date.now() - started).toBeLessThan(2000);
  expect(projectStore.listLocalRootPaths).toHaveBeenCalledTimes(1);
  for (const item of batch) {
    expect(item.preview?.workspaceImpactUnknown).toBe(true);
    expect((await service.remove(item.preview!)).mode).toBe("permanent");
  }
});

it("does not wait for an unresponsive preparation observer", async () => {
  const { tree, service, common } = await fixture();
  const batch = await service.previewBatch([{ commonDir: common, path: tree, mode: "permanent", allowDirty: true }], () => new Promise(() => {}));
  expect(batch[0].preview?.mode).toBe("permanent");
});

it("skips optional Git writes if a writer starts after the selected directory is moved", async () => {
  const { tree, service, common, admin } = await fixture();
  const preview = await service.preview(common, tree, true, "trash");
  const backlink = await fs.readFile(join(admin, "gitdir"), "utf8"), original = fs.rename.bind(fs);
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    await original(from, to);
    if (String(from) === tree) await fs.writeFile(join(admin, "HEAD.lock"), "writer after move");
  });
  const result = await service.remove(preview);
  expect(result.status).toBe("removed");
  expect(await fs.readFile(join(admin, "gitdir"), "utf8")).toBe(backlink);
  expect(await fs.readFile(join(admin, "HEAD.lock"), "utf8")).toBe("writer after move");
  expect(await fs.readFile(join(result.retainedPath!, "file.txt"), "utf8")).toBe("base\n");
});

it.each(["prepared", "restoring"] as const)("restores raw contents of an interrupted %s move without waiting for Git", async (phase) => {
  const { tree, data, service, common, admin } = await fixture();
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  const path = join(data, "worktree-trash", `${moved.id}.json`);
  const journal = JSON.parse(await fs.readFile(path, "utf8")); journal.phase = phase;
  await fs.writeFile(path, JSON.stringify(journal));
  await fs.writeFile(join(admin, "index.lock"), "busy repository");
  const head = await fs.readFile(join(admin, "HEAD"), "utf8");
  const result = await service.restore(moved.id);
  expect(result.status).toBe("restored");
  expect(result.verificationWarnings).not.toHaveLength(0);
  expect(await fs.readFile(join(tree, "file.txt"), "utf8")).toBe("base\n");
  expect(await fs.readFile(join(admin, "HEAD"), "utf8")).toBe(head);
  expect(await fs.readFile(join(admin, "index.lock"), "utf8")).toBe("busy repository");
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
  const { tree, data, service, common } = await fixture();
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
  const journalPath = join(data, "worktree-trash", `${recovery.id}.json`);
  const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
  journal.entry.sizeBytes = 8192;
  await fs.writeFile(journalPath, JSON.stringify(journal));
  await fs.mkdir(tree); await fs.writeFile(join(tree, "new.txt"), "new unrelated content");
  vi.restoreAllMocks();
  const retry = await service.previewTrashDeletion(recovery.id);
  expect(retry.entry.sizeBytes).toBeUndefined();
  const result = await service.remove(retry);
  expect(result.pendingGitCleanup).toBe(false);
  expect(result.reclaimedSizeBytes).toBeUndefined();
  expect(await fs.readFile(join(tree, "new.txt"), "utf8")).toBe("new unrelated content");
});

it.each(["restoring", "restored"] as const)("does not purge a Trash record that became %s after deletion preview", async (phase) => {
  const { tree, data, service, common } = await fixture();
  await fs.writeFile(join(tree, "local.txt"), "Preserve my recovery\n");
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  const preview = await service.previewTrashDeletion(moved.id);
  const path = join(data, "worktree-trash", `${moved.id}.json`);
  if (phase === "restored") await service.restore(moved.id);
  else {
    const journal = JSON.parse(await fs.readFile(path, "utf8")); journal.phase = "restoring";
    await fs.writeFile(path, JSON.stringify(journal));
  }
  const before = await fs.readFile(path, "utf8");
  await expect(service.previewTrashDeletion(moved.id)).rejects.toThrow("restore");
  await expect(service.remove(preview)).rejects.toThrow("restore");
  expect(await fs.readFile(path, "utf8")).toBe(before);
  const retained = JSON.parse(before).storage;
  expect(await fs.readFile(join(phase === "restored" ? tree : retained, "local.txt"), "utf8")).toBe("Preserve my recovery\n");
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

it("empties an interrupted prepared item without repairing its busy Git registration", async () => {
  const { tree, data, service, common, admin } = await fixture();
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  const path = join(data, "worktree-trash", `${moved.id}.json`);
  const journal = JSON.parse(await fs.readFile(path, "utf8")); journal.phase = "prepared";
  await fs.writeFile(path, JSON.stringify(journal));
  await fs.writeFile(join(admin, "index.lock"), "active writer");
  const backlink = await fs.readFile(join(admin, "gitdir"), "utf8");
  expect((await service.remove(await service.previewTrashDeletion(moved.id))).status).toBe("removed");
  await expect(fs.lstat(moved.retainedPath!)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(join(admin, "gitdir"), "utf8")).toBe(backlink);
  expect(await fs.readFile(join(admin, "index.lock"), "utf8")).toBe("active writer");
});

it("still rejects the actual main repository, regardless of a requested disposal mode", async () => {
  const { service, common, repo } = await fixture();
  for (const mode of ["trash", "permanent"] as const) await expect(service.preview(common, repo, true, mode)).rejects.toThrow();
  expect(await fs.readFile(join(repo, "file.txt"), "utf8")).toBe("base\n");
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

it("retries a transient nonempty directory failure on the pinned private deletion path", async () => {
  const { tree, service, common } = await fixture();
  const original = fs.rm.bind(fs); let attempts = 0;
  vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
    if (String(path).endsWith("/files") && ++attempts === 1) throw Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" });
    return original(path, options);
  });
  const result = await service.remove(await service.preview(common, tree, true, "permanent"));
  expect(result).toMatchObject({ mode: "permanent", status: "removed" });
  expect(attempts).toBeGreaterThan(1);
});

it("can permanently delete a known linked directory when its Git administration is already gone", async () => {
  const { tree, service, common, admin } = await fixture();
  await fs.rm(admin, { recursive: true });
  const result = await service.remove(await service.preview(common, tree, true, "permanent"));
  expect(result).toMatchObject({ mode: "permanent", status: "removed" });
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps a previously discovered directory available for explicit cleanup when Git no longer lists it", async () => {
  const { tree, service, common, admin } = await fixture();
  await fs.rm(admin, { recursive: true });
  const inventory = await service.inventory("background");
  expect(inventory.entries.find((item) => item.path === tree)).toMatchObject({ exists: true, state: "unavailable" });
  await service.remove(await service.preview(common, tree, true, "permanent"));
  expect((await service.inventory("background")).entries.some((item) => item.path === tree)).toBe(false);
});

it("does not let Git metadata disappearing after Preview block deletion of the same selected directory", async () => {
  const { tree, service, common, admin } = await fixture();
  const preview = await service.preview(common, tree, true, "permanent");
  await fs.rm(admin, { recursive: true });
  expect((await service.remove(preview)).mode).toBe("permanent");
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
});

it("moves and restores the actual directory without repairing unavailable Git administration", async () => {
  const { tree, service, common, admin } = await fixture();
  await fs.writeFile(join(tree, "local.txt"), "keep raw local data");
  const pointer = await fs.readFile(join(tree, ".git"), "utf8");
  await fs.rm(admin, { recursive: true });
  const moved = await service.remove(await service.preview(common, tree, true, "trash"));
  expect(moved.mode).toBe("trash");
  expect(await fs.readFile(join(moved.retainedPath!, "local.txt"), "utf8")).toBe("keep raw local data");
  await service.restore(moved.id);
  expect(await fs.readFile(join(tree, ".git"), "utf8")).toBe(pointer);
  expect(await fs.readFile(join(tree, "local.txt"), "utf8")).toBe("keep raw local data");
  await expect(fs.lstat(admin)).rejects.toMatchObject({ code: "ENOENT" });
});

it("permits explicit deletion of a known directory with a missing .git file or owning repository", async () => {
  const { tree, service, common, repo } = await fixture();
  await fs.rm(join(tree, ".git")); await fs.rm(repo, { recursive: true });
  expect((await service.remove(await service.preview(common, tree, true, "permanent"))).mode).toBe("permanent");
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["trash", "permanent"] as const)("cleans only the selected directory with a redirected Git pointer for %s", async (mode) => {
  const { tree, repo, service, common, admin } = await fixture();
  const mainHead = await fs.readFile(join(common, "HEAD"), "utf8");
  const backlink = await fs.readFile(join(admin, "gitdir"), "utf8");
  await fs.writeFile(join(tree, ".git"), `gitdir: ${common}\n`);
  expect((await service.remove(await service.preview(common, tree, true, mode))).status).toBe("removed");
  expect(await fs.readFile(join(common, "HEAD"), "utf8")).toBe(mainHead);
  expect(await fs.readFile(join(admin, "gitdir"), "utf8")).toBe(backlink);
  expect(await fs.readFile(join(repo, "file.txt"), "utf8")).toBe("base\n");
  await expect(fs.lstat(tree)).rejects.toMatchObject({ code: "ENOENT" });
});

it("refuses a standalone repository created at the selected path after a directory-only preview", async () => {
  const { tree, service, common, admin } = await fixture();
  await fs.rm(admin, { recursive: true });
  const preview = await service.preview(common, tree, true, "permanent");
  await fs.rm(join(tree, ".git")); await fs.mkdir(join(tree, ".git"));
  await fs.writeFile(join(tree, ".git", "keep.txt"), "new standalone repository");
  await expect(service.remove(preview)).rejects.toThrow("not a linked Worktree");
  expect(await fs.readFile(join(tree, ".git", "keep.txt"), "utf8")).toBe("new standalone repository");
});

it("preserves an inaccessible directory as manually selectable, not absent or automatically selected", async () => {
  const { tree, service } = await fixture();
  const original = fs.lstat.bind(fs);
  vi.spyOn(fs, "lstat").mockImplementation(((path: Parameters<typeof fs.lstat>[0], ...rest: unknown[]) => {
    if (String(path) === tree) return Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    return Reflect.apply(original, fs, [path, ...rest]);
  }) as typeof fs.lstat);
  const entry = (await service.inventory("background")).entries.find((item) => item.path === tree)!;
  expect(entry).toMatchObject({ exists: false, pathAvailability: "unknown" });
  expect(canSelectWorktreeForCleanup(entry)).toBe(true);
  expect(isAutomaticCleanupCandidate(entry)).toBe(false);
});

it("stops retrying if the private directory was replaced after an ENOTEMPTY failure", async () => {
  const { tree, root, service, common } = await fixture();
  const original = fs.rm.bind(fs);
  vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
    if (String(path).endsWith("/files")) {
      await fs.rename(String(path), join(root, "original-contents"));
      await fs.mkdir(String(path)); await fs.writeFile(join(String(path), "keep.txt"), "replacement");
      throw Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" });
    }
    return original(path, options);
  });
  await expect(service.remove(await service.preview(common, tree, true, "permanent"))).rejects.toThrow("changed identity");
  vi.restoreAllMocks();
  expect(await fs.readFile(join(root, "original-contents", "file.txt"), "utf8")).toBe("base\n");
});

it("retries older partial-deletion journals without requiring their already removed .git file", async () => {
  const { tree, data, service, common } = await fixture();
  const original = fs.rm.bind(fs);
  vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
    if (String(path).endsWith("/files")) { await original(join(String(path), ".git")); throw Object.assign(new Error("remaining bundle resources"), { code: "EACCES" }); }
    return original(path, options);
  });
  await expect(service.remove(await service.preview(common, tree, true, "permanent"))).rejects.toThrow("Remaining contents");
  vi.restoreAllMocks();
  const record = (await service.listRecovery("trash")).records[0], path = join(data, "worktree-trash", `${record.id}.json`);
  const journal = JSON.parse(await fs.readFile(path, "utf8")); delete journal.directoryIdentity;
  await fs.writeFile(path, JSON.stringify(journal));
  const result = await service.remove(await service.previewTrashDeletion(record.id));
  expect(result).toMatchObject({ mode: "permanent", status: "removed", pendingGitCleanup: false });
  expect((await service.listRecovery("trash")).records).toEqual([]);
});
