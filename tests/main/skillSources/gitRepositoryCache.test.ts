import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findExecutable } from "../../../src/main/executableDiscovery";
import { createPaths } from "../../../src/main/paths";
import { createGitCommandRunner } from "../../../src/main/skillSources/gitCommandRunner";
import { createGitRepositoryCache } from "../../../src/main/skillSources/gitRepositoryCache";
import { createGitTestRepository, runGit } from "./gitTestRepository";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-git-cache-"));
  const repository = await createGitTestRepository(root, {
    "skills/review/SKILL.md": "---\nname: review\n---\n# Review\n"
  });
  const executablePath = await findExecutable("git", { homeDir: root });
  if (!executablePath) throw new Error("Git is required for repository source tests");
  const runner = createGitCommandRunner({ executablePath });
  const cacheRoot = join(root, "cache", "repositories");
  return { repository, runner, cacheRoot };
};

describe("git repository cache", () => {
  it("keeps repository objects outside the backed-up application data root", () => {
    const paths = createPaths({ appDataRoot: "/tmp/agentenv-data" });
    expect(resolve(paths.repositoryCacheDir).startsWith(`${resolve(paths.appDataRoot)}/`)).toBe(false);
  });

  it("resolves the remote default branch into an isolated bare cache", async () => {
    const { repository, runner, cacheRoot } = await setup();
    const cache = createGitRepositoryCache({ cacheRoot, runner });

    const snapshot = await cache.fetch({ repository: repository.remoteDir });

    expect(snapshot).toMatchObject({
      ref: "main",
      repository: repository.remoteDir
    });
    expect(snapshot.resolvedCommit).toMatch(/^[a-f0-9]{40}$/);
    await expect(runGit(repository.workDir, ["status", "--porcelain"])).resolves.toBe("");
    await expect(
      runner.run(["--git-dir", snapshot.cachePath, "rev-parse", "--is-bare-repository"])
    ).resolves.toMatchObject({ stdout: "true\n" });
  });

  it("supports explicit branch names containing slashes", async () => {
    const { repository, runner, cacheRoot } = await setup();
    await runGit(repository.workDir, ["checkout", "-b", "feature/team"]);
    await repository.write("skills/review/SKILL.md", "---\nname: review\n---\n# Feature\n");
    const commit = await repository.commit("feature skill");
    const cache = createGitRepositoryCache({ cacheRoot, runner });

    await expect(
      cache.fetch({ repository: repository.remoteDir, ref: "feature/team" })
    ).resolves.toMatchObject({ ref: "feature/team", resolvedCommit: commit });
  });

  it("coalesces concurrent fetches for the same repository", async () => {
    const { repository, runner, cacheRoot } = await setup();
    const run = vi.fn(runner.run.bind(runner));
    const cache = createGitRepositoryCache({
      cacheRoot,
      runner: {
        run,
        cancelActive: runner.cancelActive.bind(runner),
        dispose: runner.dispose.bind(runner)
      }
    });

    const [left, right] = await Promise.all([
      cache.fetch({ repository: repository.remoteDir, ref: "main" }),
      cache.fetch({ repository: repository.remoteDir, ref: "main" })
    ]);

    expect(left.resolvedCommit).toBe(right.resolvedCommit);
    expect(run.mock.calls.filter(([args]) => args.includes("fetch"))).toHaveLength(1);
  });

  it("rebuilds a corrupt disposable cache without touching the source repository", async () => {
    const { repository, runner, cacheRoot } = await setup();
    const cache = createGitRepositoryCache({ cacheRoot, runner });
    const initial = await cache.fetch({ repository: repository.remoteDir, ref: "main" });
    await rm(initial.cachePath, { recursive: true, force: true });
    await mkdir(initial.cachePath, { recursive: true });
    await writeFile(join(initial.cachePath, "corrupt"), "not a git repository\n", "utf8");

    const rebuilt = await cache.fetch({ repository: repository.remoteDir, ref: "main" });

    expect(rebuilt.resolvedCommit).toBe(initial.resolvedCommit);
    await expect(runGit(repository.workDir, ["status", "--porcelain"])).resolves.toBe("");
  });
});
