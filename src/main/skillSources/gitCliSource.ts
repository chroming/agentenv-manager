import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import type {
  RepositorySkillCandidate,
  RepositorySkillScanResult,
  RepositorySkillSourceInput
} from "../../shared/types";
import { pathEntryExists } from "../fileUtils";
import { parseSkillFrontmatter } from "../skillFrontmatter";
import type {
  GitCliSkillSource,
  MaterializedGitSkillSource,
  ResolvedGitRepository,
  ResolvedGitSkillSource
} from "./contract";
import type { GitCommandRunner } from "./gitCommandRunner";
import type { GitRepositoryCache } from "./gitRepositoryCache";
import { createSkillSourceScope } from "../skillSourceScope";
import { githubContentsRevision } from "./revisionCompatibility";

export interface GitCliSkillSourceOptions {
  cache: GitRepositoryCache;
  runner: GitCommandRunner;
  maxCandidates?: number;
}

const normalizeDirectory = (value: string | undefined): string => {
  const directory = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  if (!directory) return "";
  if (
    /[\u0000-\u001f\u007f\\]/.test(directory) ||
    directory.startsWith("-") ||
    directory.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Repository directory is unsafe");
  }
  return directory;
};

const normalizeSkillId = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

const treeishFor = (repository: ResolvedGitRepository, directory: string) =>
  directory ? `${repository.resolvedCommit}:${directory}` : `${repository.resolvedCommit}^{tree}`;

const readTreeOid = async (
  runner: GitCommandRunner,
  repository: ResolvedGitRepository,
  directory: string,
  signal?: AbortSignal
) => {
  try {
    const result = await runner.run(
      ["--git-dir", repository.cachePath, "rev-parse", treeishFor(repository, directory)],
      { signal, timeoutMs: 30_000 }
    );
    const oid = result.stdout.trim();
    if (!/^[a-f0-9]{40,64}$/i.test(oid)) throw new Error("invalid tree revision");
    return oid;
  } catch {
    throw new Error(
      directory
        ? `Repository directory not found: ${directory}`
        : "Repository root could not be resolved"
    );
  }
};

const resolvedSkill = async (
  runner: GitCommandRunner,
  repository: ResolvedGitRepository,
  directory: string,
  signal?: AbortSignal
): Promise<ResolvedGitSkillSource> => {
  const contentRevision = await readTreeOid(runner, repository, directory, signal);
  const updated = await runner.run(
    [
      "--git-dir",
      repository.cachePath,
      "log",
      "-1",
      "--format=%cI",
      repository.resolvedCommit,
      "--",
      ...(directory ? [directory] : [])
    ],
    { signal, timeoutMs: 30_000 }
  );
  const updatedAt = updated.stdout.trim();
  return {
    ...repository,
    directory,
    contentRevision,
    upstream: {
      kind: "git",
      locator: repository.repository,
      ref: repository.ref,
      subpath: directory || undefined,
      revision: repository.resolvedCommit,
      ...(updatedAt && !Number.isNaN(Date.parse(updatedAt))
        ? { updatedAt: new Date(updatedAt).toISOString() }
        : {})
    }
  };
};

interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  path: string;
}

const parseTreeEntries = (stdout: string): TreeEntry[] =>
  stdout
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^(\d+)\s+(\S+)\s+([a-f0-9]+)\t([\s\S]+)$/i.exec(record);
      if (!match) throw new Error("Repository returned an invalid tree entry");
      return { mode: match[1], type: match[2], sha: match[3], path: match[4] };
    });

const assertSafeTree = async (
  runner: GitCommandRunner,
  source: ResolvedGitSkillSource,
  signal?: AbortSignal
) => {
  const treeish = treeishFor(source, source.directory);
  const result = await runner.run(
    ["--git-dir", source.cachePath, "ls-tree", "-r", "-z", treeish],
    { signal, timeoutMs: 30_000 }
  );
  for (const entry of parseTreeEntries(result.stdout)) {
    if (entry.type === "commit" || entry.mode === "160000") {
      throw new Error(`Skill contains a Submodule: ${entry.path}`);
    }
    if (entry.mode !== "120000") continue;
    const repositoryPath = source.directory
      ? `${source.directory}/${entry.path}`
      : entry.path;
    const link = await runner.run(
      ["--git-dir", source.cachePath, "show", `${source.resolvedCommit}:${repositoryPath}`],
      { signal, timeoutMs: 30_000 }
    );
    const target = link.stdout.trim();
    const resolved = posix.normalize(posix.join(posix.dirname(entry.path), target));
    if (posix.isAbsolute(target) || resolved === ".." || resolved.startsWith("../")) {
      throw new Error(`Skill symbolic link points outside the Skill directory: ${entry.path}`);
    }
  }
};

const assertNoLfsPointers = async (directory: string) => {
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const stats = await lstat(path);
      if (!stats.isFile()) continue;
      const handle = await open(path, "r");
      try {
        const buffer = Buffer.alloc(200);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (
          buffer.subarray(0, bytesRead).toString("utf8").startsWith(
            "version https://git-lfs.github.com/spec/v1\n"
          )
        ) {
          throw new Error(`Skill contains unavailable Git LFS content: ${path}`);
        }
      } finally {
        await handle.close();
      }
    }
  };
  await walk(directory);
};

export const createGitCliSkillSource = (
  options: GitCliSkillSourceOptions
): GitCliSkillSource => {
  const resolve = async (
    input: RepositorySkillSourceInput,
    signal?: AbortSignal
  ): Promise<ResolvedGitSkillSource> => {
    const repository = await options.cache.fetch(input, signal);
    const directory = normalizeDirectory(input.directory ?? repository.location.inferredDirectory);
    return resolvedSkill(options.runner, repository, directory, signal);
  };

  const scan = async (
    input: RepositorySkillSourceInput,
    signal?: AbortSignal
  ): Promise<RepositorySkillScanResult> => {
    const repository = await options.cache.fetch(input, signal);
    const directory = normalizeDirectory(input.directory ?? repository.location.inferredDirectory);
    if (directory) await readTreeOid(options.runner, repository, directory, signal);
    const args = [
      "--git-dir",
      repository.cachePath,
      "ls-tree",
      "-r",
      "-t",
      "-z",
      repository.resolvedCommit,
      "--",
      ...(directory ? [directory] : [])
    ];
    const listed = await options.runner.run(args, { signal, timeoutMs: 30_000 });
    const treeEntries = parseTreeEntries(listed.stdout);
    const roots = treeEntries
      .filter((entry) => entry.type === "blob" &&
        (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md")))
      .map((entry) => posix.dirname(entry.path) === "." ? "" : posix.dirname(entry.path))
      .sort((left, right) => {
        const depth = left.split("/").length - right.split("/").length;
        return depth || left.localeCompare(right);
      })
      .filter((root, index, values) =>
        !values.slice(0, index).some((parent) => !parent || root.startsWith(`${parent}/`))
      );
    const maxCandidates = options.maxCandidates ?? 500;
    const selectedRoots = roots.slice(0, maxCandidates);
    const candidates: RepositorySkillCandidate[] = [];
    for (const root of selectedRoots) {
      const skillPath = root ? `${root}/SKILL.md` : "SKILL.md";
      const markdown = await options.runner.run(
        ["--git-dir", repository.cachePath, "show", `${repository.resolvedCommit}:${skillPath}`],
        { signal, timeoutMs: 30_000 }
      );
      const frontmatter = parseSkillFrontmatter(markdown.stdout);
      const fallbackName = root ? basename(root) : "skill";
      const name = frontmatter.name || fallbackName;
      const id = normalizeSkillId(name) || normalizeSkillId(fallbackName);
      const source = await resolvedSkill(options.runner, repository, root, signal);
      const compatibleRevision = githubContentsRevision(
        root,
        treeEntries
          .filter((entry): entry is TreeEntry & { type: "blob" | "tree" } =>
            entry.type === "blob" || entry.type === "tree")
          .map((entry) => ({
            path: entry.path,
            type: entry.type,
            sha: entry.sha
          }))
      );
      candidates.push({
        id,
        name,
        description: frontmatter.description,
        version: frontmatter.version,
        directory: root,
        source: source.upstream,
        contentRevision: source.contentRevision,
        compatibleRevisions:
          compatibleRevision === source.contentRevision ? [] : [compatibleRevision],
        resolvedCommit: repository.resolvedCommit,
        upstreamUpdatedAt: source.upstream.updatedAt,
        status: frontmatter.errors.length > 0 ? "invalid" : "ready",
        error: frontmatter.errors.length > 0 ? frontmatter.errors.join("; ") : undefined
      });
    }
    const result = {
      repository: repository.repository,
      ref: repository.ref,
      directory,
      transport: "system-git",
      accessTransport: repository.accessTransport,
      truncated: roots.length > maxCandidates,
      candidates
    } satisfies Omit<RepositorySkillScanResult, "sourceScope">;
    return { ...result, sourceScope: createSkillSourceScope(input, result) };
  };

  const materialize = async (
    input: RepositorySkillSourceInput,
    destination: string,
    signal?: AbortSignal
  ): Promise<MaterializedGitSkillSource> => {
    if (await pathEntryExists(destination)) {
      const entries = await readdir(destination);
      if (entries.length > 0) throw new Error("Skill materialization destination must be empty");
    }
    const source = await resolve(input, signal);
    await assertSafeTree(options.runner, source, signal);
    const indexPath = join(dirname(destination), `.agentenv-git-index-${randomUUID()}`);
    const treeish = treeishFor(source, source.directory);
    try {
      await mkdir(destination, { recursive: true });
      await options.runner.run(
        ["--git-dir", source.cachePath, "read-tree", treeish],
        { signal, timeoutMs: 30_000, env: { GIT_INDEX_FILE: indexPath } }
      );
      await options.runner.run(
        [
          "--git-dir",
          source.cachePath,
          "--work-tree",
          destination,
          "checkout-index",
          "--all",
          "--force"
        ],
        { signal, timeoutMs: 30_000, env: { GIT_INDEX_FILE: indexPath } }
      );
      if (!(await pathEntryExists(join(destination, "SKILL.md")))) {
        throw new Error("Repository directory does not contain SKILL.md");
      }
      await assertNoLfsPointers(destination);
      return { ...source, destination };
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(indexPath, { force: true });
    }
  };

  return { resolve, scan, materialize };
};
