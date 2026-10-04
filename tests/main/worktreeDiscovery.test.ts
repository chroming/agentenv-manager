import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findExecutable } from "../../src/main/executableDiscovery";
import { createGitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { repositoryDiscoveryDirectories } from "../../src/main/worktrees/worktreeDiscovery";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const fixture = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentenv-repository-discovery-")));
  roots.push(root);
  const repo = join(root, "project");
  await run("git", ["init", repo]);
  const gitPath = await findExecutable("git", { environment: process.env, homeDir: homedir(), platform: process.platform });
  if (!gitPath) throw new Error("Git is required for repository discovery tests");
  return { root, repo, runner: createGitCommandRunner({ executablePath: gitPath }) };
};

describe("repository discovery candidates", () => {
  it("omits tracked source and cache folders, but includes ignored repository containers", async () => {
    const { repo, runner } = await fixture();
    const source = join(repo, "src", ...Array.from({ length: 10 }, (_, index) => `level-${index}`));
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "source.txt"), "tracked\n");
    await writeFile(join(repo, ".gitignore"), "nested/\n.worktrees/\n");
    await run("git", ["-C", repo, "add", "src", ".gitignore"]);
    for (const folder of ["node_modules", "build", "nested", ".worktrees"]) {
      await mkdir(join(repo, folder));
      await writeFile(join(repo, folder, "file.txt"), "untracked\n");
    }
    const candidates = await repositoryDiscoveryDirectories(runner, repo);
    expect(candidates.issues).toEqual([]);
    expect(candidates.paths.sort()).toEqual([join(repo, ".worktrees"), join(repo, "nested")].sort());
  });

  it.each(process.platform === "win32" ? ["team project"] : ["team project", "team project\nreview"])(
    "keeps the directory name %j intact in NUL-separated Git output", async (name) => {
      const { repo, runner } = await fixture();
      const folder = join(repo, name);
      await mkdir(folder);
      const candidates = await repositoryDiscoveryDirectories(runner, repo);
      expect(candidates.paths).toEqual([folder]);
      expect(candidates.issues).toEqual([]);
    }
  );

  it("rejects out-of-repository declarations and does not follow intermediate directory links", async () => {
    const { root, repo, runner } = await fixture();
    const outside = join(root, "outside");
    await mkdir(join(outside, "child"), { recursive: true });
    await symlink(outside, join(repo, "linked"), "dir");
    await writeFile(join(repo, ".gitmodules"), '[submodule "outside"]\npath = ../outside\n[submodule "linked"]\npath = linked/child\n');
    const candidates = await repositoryDiscoveryDirectories(runner, repo);
    expect(candidates.paths).toEqual([]);
    expect(candidates.issues).toEqual([expect.stringContaining("outside this repository: ../outside")]);
  });

  it("does not load Git config includes from submodule declarations", async () => {
    const { root, repo, runner } = await fixture();
    const folder = join(repo, "declared");
    await mkdir(folder);
    await run("git", ["-C", repo, "config", "--file", ".gitmodules", "submodule.main.path", "declared"]);
    const extra = join(root, "extra-config");
    await writeFile(extra, '[submodule "outside"]\npath = ../outside\n');
    await run("git", ["-C", repo, "config", "--file", ".gitmodules", "include.path", extra]);
    const candidates = await repositoryDiscoveryDirectories(runner, repo);
    expect(candidates.paths).toEqual([folder]);
    expect(candidates.issues).toEqual([]);
  });

  it("preserves known containers and reports failed Git discovery rather than false completeness", async () => {
    const { repo, runner } = await fixture();
    const folder = join(repo, ".worktrees");
    await mkdir(folder);
    vi.spyOn(runner, "run").mockRejectedValueOnce(new Error("Git command timed out"));
    const candidates = await repositoryDiscoveryDirectories(runner, repo);
    expect(candidates.paths).toEqual([folder]);
    expect(candidates.issues).toEqual([expect.stringContaining(`${repo}: Could not discover untracked repository folders`)]);
  });

  it("propagates cancellation rather than reporting an incomplete scan", async () => {
    const { repo, runner } = await fixture();
    const controller = new AbortController();
    controller.abort(new Error("Stop discovery"));
    await expect(repositoryDiscoveryDirectories(runner, repo, controller.signal)).rejects.toThrow("Stop discovery");
  });
});
