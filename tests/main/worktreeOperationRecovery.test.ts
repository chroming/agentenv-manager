import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { copyRecoveryPathExclusive, operationRecoveryObjects } from "../../src/main/worktrees/worktreeOperationRecovery";
import { GitCommandError, type GitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { readWorktreeGit } from "../../src/main/worktrees/worktreeGitState";

vi.mock("node:fs/promises", async (original) => ({ ...await original<typeof import("node:fs/promises")>() }));

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const fixture = async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "worktree-operation-recovery-"));
  roots.push(root);
  await exec("git", ["init", "-b", "main", root]);
  const runner: GitCommandRunner = {
    run: async (args, options) => {
      const result = await exec("git", args, { cwd: options?.cwd, env: { ...process.env, ...options?.env } });
      return { ...result, exitCode: 0 };
    },
    cancelActive() {}, dispose() {}
  };
  await fs.writeFile(join(root, "tracked"), "base\n");
  await runner.run(["add", "tracked"], { cwd: root });
  await runner.run(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "base"], { cwd: root });
  const tree = (await runner.run(["rev-parse", "HEAD^{tree}"], { cwd: root })).stdout.trim();
  const commit = async (message: string) => (await runner.run([
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit-tree", tree, "-m", message
  ], { cwd: root })).stdout.trim();
  const head = await commit("head");
  await runner.run(["update-ref", "refs/heads/main", head], { cwd: root });
  const metadata = join(root, "recovery", "operation");
  await fs.mkdir(metadata, { recursive: true });
  return { root, runner, head, metadata, commit };
};

it.each(["healthy", "warning", "failure"])("bypasses the graph cache only for an affected %s read", async (state) => {
  const runner: GitCommandRunner = { run: vi.fn(), cancelActive() {}, dispose() {} };
  const result = { stdout: "local result", stderr: "", exitCode: 0 };
  const run = vi.mocked(runner.run);
  if (state === "failure") run.mockRejectedValueOnce(new GitCommandError("broken cache", {
    exitCode: 128, stderr: "commit-graph parent list is too long"
  }));
  else run.mockResolvedValueOnce({ ...result, stderr: state === "warning" ? "error: commit-graph is corrupt" : "" });
  run.mockResolvedValue(result);
  expect(await readWorktreeGit(runner, ["merge-base", "main", "HEAD"], { cwd: "/fixture" })).toEqual(result);
  expect(run).toHaveBeenCalledTimes(state === "healthy" ? 1 : 2);
  expect(run.mock.calls[0][0]).not.toContain("core.commitGraph=false");
  if (state !== "healthy") expect(run.mock.calls[1][0]).toContain("core.commitGraph=false");
});

it("uses atomic exclusive creation when another writer races the file-copy primitive", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "worktree-exclusive-copy-"));
  roots.push(root);
  const source = join(root, "source"), destination = join(root, "destination");
  await fs.writeFile(source, "recovery bytes");
  const copyFile = fs.copyFile.bind(fs), cp = fs.cp.bind(fs);
  // Model the exact cp race: its preflight saw no target, but the underlying
  // copyFile primitive encounters a newly-created file. Only EXCL is atomic.
  vi.spyOn(fs, "cp").mockImplementation(async (from, to, options) => {
    if (String(to) !== destination) return cp(from, to, options);
    await fs.writeFile(destination, "external bytes");
    await copyFile(from, to, options?.mode ?? 0);
  });
  const primitive = vi.spyOn(fs, "copyFile").mockImplementation(async (from, to, flags) => {
    if (String(to) === destination) await fs.writeFile(destination, "external bytes");
    await copyFile(from, to, flags);
  });
  await expect(copyRecoveryPathExclusive(source, destination)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await fs.readFile(destination, "utf8")).toBe("external bytes");
  expect(primitive).toHaveBeenCalledWith(source, destination, constants.COPYFILE_EXCL);
});

it.each([4, 5, 6])("preserves required %i-character sequencer todo commits", async (length) => {
  const { root, runner, head, metadata, commit } = await fixture();
  const pending = await commit(`pending-${length}`);
  const abbreviated = pending.slice(0, length);
  expect((await runner.run(["rev-parse", "--verify", `${abbreviated}^{commit}`], { cwd: root })).stdout.trim()).toBe(pending);
  await fs.mkdir(join(metadata, "sequencer"));
  await fs.writeFile(join(metadata, "sequencer", "todo"), `pick ${abbreviated} pending work\n`);
  expect(await operationRecoveryObjects(runner, root, metadata, head)).toContain(pending);
});

it("records already-missing operation history without requiring repository repair", async () => {
  const { root, runner, head, metadata } = await fixture();
  const object = "f".repeat(40);
  await fs.writeFile(join(metadata, "REBASE_HEAD"), `${object}\n`);
  const unavailable = vi.fn();
  await expect(operationRecoveryObjects(runner, root, metadata, head, unavailable)).resolves.toEqual([]);
  expect(unavailable).toHaveBeenCalledWith({ field: "REBASE_HEAD", object });
  expect(await fs.readFile(join(metadata, "REBASE_HEAD"), "utf8")).toBe(`${object}\n`);
});

it("does not downgrade an unreadable or wrong-type existing object to missing history", async () => {
  const { root, runner, head, metadata } = await fixture();
  const tree = (await runner.run(["rev-parse", "HEAD^{tree}"], { cwd: root })).stdout.trim();
  await fs.writeFile(join(metadata, "REBASE_HEAD"), `${tree}\n`);
  const unavailable = vi.fn();
  await expect(operationRecoveryObjects(runner, root, metadata, head, unavailable)).rejects.toThrow("could not be resolved");
  expect(unavailable).not.toHaveBeenCalled();
});

it("checks only recovery-tree dependencies when an unrelated commit-graph cache is broken", async () => {
  const { root, runner, head, metadata } = await fixture();
  await fs.writeFile(join(root, "tracked"), "unique staged value\n");
  await runner.run(["add", "tracked"], { cwd: root });
  await fs.copyFile(join(root, ".git", "index"), join(metadata, "..", "index"));
  const staged = (await runner.run(["rev-parse", ":tracked"], { cwd: root })).stdout.trim();
  const graph = join(root, ".git", "objects", "info", "commit-graph");
  await fs.mkdir(join(graph, ".."), { recursive: true });
  await fs.writeFile(graph, "invalid unrelated commit-graph cache\n");
  await expect(runner.run(["fsck", "--connectivity-only", "--no-dangling", head], { cwd: root })).rejects.toThrow();
  const calls = vi.spyOn(runner, "run");
  const objects = await operationRecoveryObjects(runner, root, metadata, head);
  expect(objects).toHaveLength(1);
  expect((await runner.run(["ls-tree", objects[0]], { cwd: root })).stdout).toContain(staged);
  expect(calls.mock.calls.some(([args]) => args.includes("fsck"))).toBe(false);
  expect(await fs.readFile(graph, "utf8")).toBe("invalid unrelated commit-graph cache\n");
});

it("refuses missing staged content rather than treating it as optional operation history", async () => {
  const { root, runner, head, metadata } = await fixture();
  await fs.writeFile(join(root, "tracked"), "unique staged value\n");
  await runner.run(["add", "tracked"], { cwd: root });
  await fs.copyFile(join(root, ".git", "index"), join(metadata, "..", "index"));
  const staged = (await runner.run(["rev-parse", ":tracked"], { cwd: root })).stdout.trim();
  await fs.rm(join(root, ".git", "objects", staged.slice(0, 2), staged.slice(2)));
  await expect(operationRecoveryObjects(runner, root, metadata, head)).rejects.toThrow();
});
