import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findExecutable } from "../../../src/main/executableDiscovery";
import { createPaths } from "../../../src/main/paths";
import {
  createGitCommandRunner,
  GitCommandError,
  type GitCommandRunner
} from "../../../src/main/skillSources/gitCommandRunner";
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
  it("falls back from an internal Git HTTPS access error to the user's SSH transport", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-git-fallback-"));
    let remote = "";
    const run = vi.fn<GitCommandRunner["run"]>(async (args, commandOptions) => {
      const initIndex = args.indexOf("--bare");
      if (args[0] === "init" && initIndex >= 0) {
        await mkdir(args[initIndex + 1], { recursive: true });
      }
      if (args.includes("remote") && args.includes("add")) {
        remote = args.at(-1) ?? "";
      }
      if (args.includes("fetch") && remote.startsWith("https://")) {
        throw new GitCommandError("Git command failed: Authentication failed", {
          exitCode: 128,
          stderr: "fatal: Authentication failed"
        });
      }
      if (args.includes("fetch")) {
        expect(commandOptions?.env?.GIT_SSH_COMMAND).toContain("BatchMode=yes");
        expect(commandOptions?.env?.GIT_SSH_VARIANT).toBe("ssh");
      }
      if (args.includes("rev-parse")) {
        return { stdout: `${"a".repeat(40)}\n`, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const runner: GitCommandRunner = {
      run,
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const cache = createGitRepositoryCache({ cacheRoot: join(root, "cache"), runner });

    const snapshot = await cache.fetch({
      repository: "https://git.example.com/team/internal-agent-skills/blob/main/skills/review"
    });

    expect(snapshot).toMatchObject({
      repository: "https://git.example.com/team/internal-agent-skills.git",
      ref: "main",
      accessTransport: "ssh"
    });
    expect(
      run.mock.calls
        .filter(([args]) => args.includes("remote") && args.includes("add"))
        .map(([args]) => args.at(-1))
    ).toEqual([
      "https://git.example.com/team/internal-agent-skills.git",
      "git@git.example.com:team/internal-agent-skills.git"
    ]);
  });

  it("does not try SSH for non-access GitHub failures", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-git-no-fallback-"));
    let remote = "";
    const run = vi.fn<GitCommandRunner["run"]>(async (args) => {
      const initIndex = args.indexOf("--bare");
      if (args[0] === "init" && initIndex >= 0) {
        await mkdir(args[initIndex + 1], { recursive: true });
      }
      if (args.includes("remote") && args.includes("add")) remote = args.at(-1) ?? "";
      if (args.includes("fetch")) {
        throw new GitCommandError("Git command failed: connection timed out", {
          exitCode: 128,
          stderr: "fatal: unable to access repository: connection timed out"
        });
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const runner: GitCommandRunner = {
      run,
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const cache = createGitRepositoryCache({ cacheRoot: join(root, "cache"), runner });

    await expect(cache.fetch({
      repository: "https://github.com/acme/private-skills",
      ref: "main"
    })).rejects.toThrow("connection timed out");
    expect(remote).toBe("https://github.com/acme/private-skills.git");
    expect(run.mock.calls.flatMap(([args]) => args)).not.toContain(
      "git@github.com:acme/private-skills.git"
    );
  });

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

  it("reuses a recent repository snapshot for import steps but refreshes on explicit checks", async () => {
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
    const input = { repository: repository.remoteDir, ref: "main" };

    const scanned = await cache.fetch(input, undefined, { refresh: true });
    const reused = await cache.fetch(input);
    expect(reused.resolvedCommit).toBe(scanned.resolvedCommit);
    expect(run.mock.calls.filter(([args]) => args.includes("fetch"))).toHaveLength(1);

    await repository.write("skills/review/SKILL.md", "---\nname: review\n---\n# Updated\n");
    const nextCommit = await repository.commit("update cached repository");
    const refreshed = await cache.fetch(input, undefined, { refresh: true });
    expect(refreshed.resolvedCommit).toBe(nextCommit);
    expect(run.mock.calls.filter(([args]) => args.includes("fetch"))).toHaveLength(2);
  });

  it("checks the advertised revision without fetching an unchanged internal repository again", async () => {
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
    const input = { repository: repository.remoteDir, ref: "main" };

    const initial = await cache.fetch(input, undefined, { refresh: true, historyDepth: 128 });
    const checked = await cache.fetch(input, undefined, { refresh: true, historyDepth: 128 });

    expect(checked.resolvedCommit).toBe(initial.resolvedCommit);
    expect(run.mock.calls.filter(([args]) => args.includes("fetch"))).toHaveLength(1);
    expect(
      run.mock.calls.filter(([args]) => args[0] === "ls-remote" && args.includes("--exit-code"))
    ).toHaveLength(2);
  });

  it("deepens an unchanged cache when a later operation needs more path history", async () => {
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
    const input = { repository: repository.remoteDir, ref: "main" };

    await cache.fetch(input, undefined, { refresh: true, historyDepth: 1 });
    await cache.fetch(input, undefined, { refresh: true, historyDepth: 128 });

    expect(run.mock.calls.filter(([args]) => args.includes("fetch"))).toHaveLength(2);
  });

  it("fetches complete file objects once for a local repository", async () => {
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
    const input = { repository: repository.remoteDir, ref: "main" };

    await cache.fetch(input, undefined, { refresh: true, historyDepth: 1 });
    await cache.fetch(input, undefined, {
      refresh: true,
      historyDepth: 1,
      includeBlobs: true
    });
    await cache.fetch(input, undefined, {
      historyDepth: 1,
      includeBlobs: true
    });

    const fetches = run.mock.calls.filter(([args]) => args.includes("fetch"));
    expect(fetches).toHaveLength(1);
    expect(fetches[0][0]).not.toContain("--filter=blob:none");
    expect(fetches[0][0]).not.toContain("--no-filter");
    expect(fetches[0][0]).not.toContain("--refetch");
  });

  it("invalidates a complete-object snapshot when a tree refresh discovers a new commit", async () => {
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
    const input = { repository: repository.remoteDir, ref: "main" };

    const initial = await cache.fetch(input, undefined, {
      refresh: true,
      includeBlobs: true
    });
    await repository.write("skills/review/SKILL.md", "---\nname: review\n---\n# Updated\n");
    const nextCommit = await repository.commit("update after complete fetch");
    const checked = await cache.fetch(input, undefined, { refresh: true });
    const materialized = await cache.fetch(input, undefined, { includeBlobs: true });

    expect(initial.resolvedCommit).not.toBe(nextCommit);
    expect(checked.resolvedCommit).toBe(nextCommit);
    expect(materialized.resolvedCommit).toBe(nextCommit);
    expect(run.mock.calls.filter(([args]) => args.includes("fetch"))).toHaveLength(2);
  });

  it("rebuilds a corrupt disposable cache without touching the source repository", async () => {
    const { repository, runner, cacheRoot } = await setup();
    const cache = createGitRepositoryCache({ cacheRoot, runner });
    const initial = await cache.fetch({ repository: repository.remoteDir, ref: "main" });
    await rm(initial.cachePath, { recursive: true, force: true });
    await mkdir(initial.cachePath, { recursive: true });
    await writeFile(join(initial.cachePath, "corrupt"), "not a git repository\n", "utf8");

    const rebuilt = await cache.fetch(
      { repository: repository.remoteDir, ref: "main" },
      undefined,
      { refresh: true }
    );

    expect(rebuilt.resolvedCommit).toBe(initial.resolvedCommit);
    await expect(runGit(repository.workDir, ["status", "--porcelain"])).resolves.toBe("");
  });
});
