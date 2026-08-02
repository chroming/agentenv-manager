import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findExecutable } from "../../../src/main/executableDiscovery";
import { createGitCliSkillSource } from "../../../src/main/skillSources/gitCliSource";
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
  root = await mkdtemp(join(tmpdir(), "agentenv-git-source-"));
  const repository = await createGitTestRepository(root, {
    "README.md": "Repository notes\n",
    "skills/engineering/review/SKILL.md":
      "---\nname: code-review\ndescription: Review changes.\nversion: 1.0.0\n---\n# Review\n",
    "skills/engineering/review/prompt.md": "Review carefully.\n",
    "skills/engineering/debug/SKILL.md":
      "---\nname: debugging\ndescription: Diagnose failures.\n---\n# Debug\n",
    "skills/design/SKILL.md": "---\nname: design\n---\n# Design\n"
  });
  const executablePath = await findExecutable("git", { homeDir: root });
  if (!executablePath) throw new Error("Git is required for repository source tests");
  const runner = createGitCommandRunner({ executablePath });
  const cache = createGitRepositoryCache({ cacheRoot: join(root, "cache"), runner });
  const source = createGitCliSkillSource({ cache, runner });
  return { repository, source };
};

describe("git CLI skill source", () => {
  it("scans a repository, a containing directory, and a direct Skill directory", async () => {
    const { repository, source } = await setup();

    const all = await source.scan({ repository: repository.remoteDir });
    const engineering = await source.scan({
      repository: repository.remoteDir,
      directory: "skills/engineering"
    });
    const direct = await source.scan({
      repository: repository.remoteDir,
      directory: "skills/engineering/review"
    });

    expect(all.candidates.map((candidate) => candidate.name)).toEqual([
      "design",
      "debugging",
      "code-review"
    ]);
    expect(engineering.candidates.map((candidate) => candidate.name)).toEqual([
      "debugging",
      "code-review"
    ]);
    expect(direct.candidates).toEqual([
      expect.objectContaining({
        id: "code-review",
        directory: "skills/engineering/review",
        contentRevision: expect.stringMatching(/^[a-f0-9]{40}$/),
        compatibleRevisions: [expect.stringMatching(/^[a-f0-9]{40}$/)],
        resolvedCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
        source: expect.objectContaining({
          kind: "git",
          ref: "main",
          updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        })
      })
    ]);
  });

  it("discovers a root router Skill alongside sibling Skills", async () => {
    const { repository, source } = await setup();
    await repository.write(
      "SKILL.md",
      "---\nname: skill-suite\ndescription: Route to the suite.\n---\n# Suite\n"
    );
    await repository.commit("add suite router");

    const result = await source.scan({ repository: repository.remoteDir });

    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      "skill-suite",
      "design",
      "debugging",
      "code-review"
    ]);
  });

  it("follows a safe llms.txt Skill index inside the same repository", async () => {
    const { repository, source } = await setup();
    await repository.write(
      "gstack/llms.txt",
      [
        "# Skill suite",
        "",
        "- [Review](skills/engineering/review/SKILL.md)",
        "- [Design](skills/design/SKILL.md)",
        "- [External](https://example.com/unsafe/SKILL.md)",
        "- [Escape](../outside/SKILL.md)"
      ].join("\n")
    );
    await repository.commit("add skill index");

    const result = await source.scan({
      repository: repository.remoteDir,
      directory: "gstack"
    });

    expect(result).toMatchObject({
      directory: "skills",
      sourceScope: { directory: "skills" },
      indexManifest: {
        path: "gstack/llms.txt",
        requestedDirectory: "gstack",
        resolvedDirectory: "skills"
      }
    });
    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      "design",
      "code-review"
    ]);
    const checkedAgain = await source.scan({
      repository: repository.remoteDir,
      ref: result.ref,
      directory: result.directory,
      indexManifestPath: result.sourceScope.indexManifestPath
    });
    expect(checkedAgain.candidates.map((candidate) => candidate.name)).toEqual([
      "design",
      "code-review"
    ]);
    await runGit(repository.workDir, ["rm", "gstack/llms.txt"]);
    await repository.commit("remove skill index");
    await expect(source.scan({
      repository: repository.remoteDir,
      ref: result.ref,
      directory: result.directory,
      indexManifestPath: result.sourceScope.indexManifestPath
    })).rejects.toThrow("Repository Skill index is missing");
  });

  it("ignores an unrelated llms.txt that does not index any Skills", async () => {
    const { repository, source } = await setup();
    await repository.write(
      "skills/llms.txt",
      "# Documentation\n\nThis file contains no Skill index.\n"
    );
    await repository.commit("add unrelated llms file");

    const result = await source.scan({
      repository: repository.remoteDir,
      directory: "skills"
    });

    expect(result.indexManifest).toBeUndefined();
    expect(result.sourceScope.indexManifestPath).toBeUndefined();
    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      "design",
      "debugging",
      "code-review"
    ]);
  });

  it("materializes a self-contained Skill without creating a worktree", async () => {
    const { repository, source } = await setup();
    const destination = join(root, "materialized-review");

    const materialized = await source.materialize(
      {
        repository: repository.remoteDir,
        directory: "skills/engineering/review"
      },
      destination
    );

    expect(materialized.contentRevision).toMatch(/^[a-f0-9]{40}$/);
    await expect(readFile(join(destination, "SKILL.md"), "utf8")).resolves.toContain(
      "name: code-review"
    );
    await expect(readFile(join(destination, "prompt.md"), "utf8")).resolves.toBe(
      "Review carefully.\n"
    );
  });

  it("uses the Skill subtree revision so unrelated repository changes do not report an update", async () => {
    const { repository, source } = await setup();
    const input = {
      repository: repository.remoteDir,
      directory: "skills/engineering/review"
    };
    const initial = await source.resolve(input);

    await repository.write("README.md", "Changed repository notes\n");
    await repository.commit("unrelated docs");
    const unrelated = await source.resolve(input);

    await repository.write(
      "skills/engineering/review/prompt.md",
      "Review even more carefully.\n"
    );
    await repository.commit("update review skill");
    const changed = await source.resolve(input);

    expect(unrelated.resolvedCommit).not.toBe(initial.resolvedCommit);
    expect(unrelated.contentRevision).toBe(initial.contentRevision);
    expect(changed.contentRevision).not.toBe(initial.contentRevision);
  });

  it("reports each Skill subtree's verified last commit time instead of the repository HEAD time", async () => {
    const { repository } = await setup();
    const executablePath = await findExecutable("git", { homeDir: root });
    if (!executablePath) throw new Error("Git is required for repository source tests");
    const baseRunner = createGitCommandRunner({ executablePath });
    const run = vi.fn(baseRunner.run.bind(baseRunner));
    const runner = {
      run,
      cancelActive: baseRunner.cancelActive.bind(baseRunner),
      dispose: baseRunner.dispose.bind(baseRunner)
    };
    const source = createGitCliSkillSource({
      runner,
      cache: createGitRepositoryCache({ cacheRoot: join(root, "timestamp-cache"), runner })
    });
    await repository.write(
      "skills/engineering/debug/SKILL.md",
      "---\nname: debugging\ndescription: Diagnose failures quickly.\n---\n# Debug\n"
    );
    await repository.commit("update debug skill", "2030-01-02T03:04:05Z");
    await repository.write(
      "skills/engineering/review/prompt.md",
      "Review carefully and explain the result.\n"
    );
    await repository.commit("update review skill", "2031-02-03T04:05:06Z");

    const result = await source.scan({
      repository: repository.remoteDir,
      directory: "skills/engineering"
    });
    const byName = new Map(result.candidates.map((candidate) => [candidate.name, candidate]));

    expect(byName.get("debugging")?.upstreamUpdatedAt).toBe("2030-01-02T03:04:05.000Z");
    expect(byName.get("code-review")?.upstreamUpdatedAt).toBe("2031-02-03T04:05:06.000Z");
    expect(run.mock.calls.filter(([args]) => args.includes("log"))).toHaveLength(1);
  });

  it("blocks LFS pointers, submodules, and escaping symlinks", async () => {
    const { repository, source } = await setup();
    const input = {
      repository: repository.remoteDir,
      directory: "skills/engineering/review"
    };

    await repository.write(
      "skills/engineering/review/model.bin",
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n"
    );
    await repository.commit("add lfs pointer");
    await expect(source.materialize(input, join(root, "lfs"))).rejects.toThrow("Git LFS");

    await runGit(repository.workDir, ["rm", "skills/engineering/review/model.bin"]);
    await symlink("../../../../outside", join(repository.workDir, "skills/engineering/review/escape"));
    await repository.commit("add escaping link");
    await expect(source.materialize(input, join(root, "symlink"))).rejects.toThrow(
      "outside the Skill directory"
    );

    await runGit(repository.workDir, ["rm", "skills/engineering/review/escape"]);
    const commit = await runGit(repository.workDir, ["rev-parse", "HEAD"]);
    await runGit(repository.workDir, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${commit},skills/engineering/review/vendor`
    ]);
    await runGit(repository.workDir, ["commit", "-m", "add gitlink"]);
    await runGit(repository.workDir, ["push", "--force", "origin", "HEAD:refs/heads/main"]);
    await expect(source.materialize(input, join(root, "submodule"))).rejects.toThrow(
      "Submodule"
    );
  }, 15_000);
});
