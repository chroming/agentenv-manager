import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { copyRecoveryPathExclusive, operationRecoveryObjects } from "../../src/main/worktrees/worktreeOperationRecovery";
import type { GitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";

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
