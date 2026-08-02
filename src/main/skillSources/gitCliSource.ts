import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import type {
  RepositorySkillCandidate,
  RepositorySkillScanResult,
  RepositorySkillSourceInput
} from "../../shared/types";
import { isMissingFileError, pathEntryExists } from "../fileUtils";
import { parseSkillFrontmatter } from "../skillFrontmatter";
import type {
  GitSourceReadOptions,
  GitCliSkillSource,
  MaterializedGitSkillSource,
  ResolvedGitRepository,
  ResolvedGitSkillSource
} from "./contract";
import type { GitCommandRunner } from "./gitCommandRunner";
import type { GitRepositoryCache } from "./gitRepositoryCache";
import { createSkillSourceScope } from "../skillSourceScope";
import { githubContentsRevision } from "./revisionCompatibility";
import {
  boundedSkillFiles,
  commonSkillDirectory,
  indexedSkillFiles,
  safeRepositoryRelativePath
} from "./skillIndexManifest";

export interface GitCliSkillSourceOptions {
  cache: GitRepositoryCache;
  runner: GitCommandRunner;
  maxCandidates?: number;
}

const SOURCE_HISTORY_DEPTH = 128;
const CANDIDATE_READ_CONCURRENCY = 8;

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

const normalizeIndexManifestPath = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const path = safeRepositoryRelativePath(value);
  if (!path || posix.basename(path).toLowerCase() !== "llms.txt") {
    throw new Error("Repository Skill index path is unsafe");
  }
  return path;
};

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

const readShallowBoundary = async (repository: ResolvedGitRepository) => {
  let content = "";
  try {
    content = await readFile(join(repository.cachePath, "shallow"), "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  return new Set(
    content
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
};

const resolvedSkill = async (
  runner: GitCommandRunner,
  repository: ResolvedGitRepository,
  directory: string,
  signal?: AbortSignal,
  known?: { contentRevision?: string; shallowBoundary?: ReadonlySet<string> }
): Promise<ResolvedGitSkillSource> => {
  const contentRevision =
    known?.contentRevision ?? await readTreeOid(runner, repository, directory, signal);
  const updated = await runner.run(
    [
      "--git-dir",
      repository.cachePath,
      "log",
      "-1",
      "--format=%H%x00%cI",
      repository.resolvedCommit,
      "--",
      ...(directory ? [directory] : [])
    ],
    { signal, timeoutMs: 30_000 }
  );
  const [updatedCommit = "", updatedAt = ""] = updated.stdout.trim().split("\0");
  const shallowBoundary = known?.shallowBoundary ?? await readShallowBoundary(repository);
  const hasVerifiedUpdatedAt =
    updatedAt &&
    !Number.isNaN(Date.parse(updatedAt)) &&
    !shallowBoundary.has(updatedCommit);
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
      ...(hasVerifiedUpdatedAt
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

const readUpdatedAtByDirectory = async (
  runner: GitCommandRunner,
  repository: ResolvedGitRepository,
  directories: readonly string[],
  shallowBoundary: ReadonlySet<string>,
  signal?: AbortSignal
): Promise<Map<string, string>> => {
  if (directories.length === 0) return new Map();
  const pathspecs = directories.includes("") ? [] : directories;
  try {
    const result = await runner.run(
      [
        "--git-dir",
        repository.cachePath,
        "log",
        `-${SOURCE_HISTORY_DEPTH}`,
        "--format=%x1e%H%x00%cI%x00",
        "--name-only",
        "-z",
        repository.resolvedCommit,
        "--",
        ...pathspecs
      ],
      { signal, timeoutMs: 30_000 }
    );
    const pending = new Set(directories);
    const sortedDirectories = [...directories].sort((left, right) =>
      right.length - left.length || left.localeCompare(right)
    );
    const updatedAtByDirectory = new Map<string, string>();
    for (const record of result.stdout.split("\x1e").slice(1)) {
      const commitEnd = record.indexOf("\0");
      const dateEnd = commitEnd < 0 ? -1 : record.indexOf("\0", commitEnd + 1);
      if (commitEnd < 0 || dateEnd < 0) continue;
      const commit = record.slice(0, commitEnd).trim();
      const rawDate = record.slice(commitEnd + 1, dateEnd).trim();
      if (
        !/^[a-f0-9]{40,64}$/i.test(commit) ||
        shallowBoundary.has(commit) ||
        Number.isNaN(Date.parse(rawDate))
      ) {
        continue;
      }
      const paths = record
        .slice(dateEnd + 1)
        .split("\0")
        .map((path) => path.replace(/^[\r\n]+|[\r\n]+$/g, ""))
        .filter(Boolean);
      for (const path of paths) {
        for (const directory of sortedDirectories) {
          if (
            pending.has(directory) &&
            (!directory || path === directory || path.startsWith(`${directory}/`))
          ) {
            updatedAtByDirectory.set(directory, new Date(rawDate).toISOString());
            pending.delete(directory);
          }
        }
        if (pending.size === 0) return updatedAtByDirectory;
      }
    }
    return updatedAtByDirectory;
  } catch (error) {
    if (signal?.aborted) throw error;
    return new Map();
  }
};

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
    signal?: AbortSignal,
    readOptions?: GitSourceReadOptions
  ): Promise<ResolvedGitSkillSource> => {
    const repository = await options.cache.fetch(input, signal, {
      refresh: readOptions?.refresh ?? true,
      historyDepth: readOptions?.historyDepth ?? SOURCE_HISTORY_DEPTH,
      includeBlobs: readOptions?.includeBlobs
    });
    const directory = normalizeDirectory(input.directory ?? repository.location.inferredDirectory);
    return resolvedSkill(options.runner, repository, directory, signal);
  };

  const scan = async (
    input: RepositorySkillSourceInput,
    signal?: AbortSignal,
    readOptions?: GitSourceReadOptions
  ): Promise<RepositorySkillScanResult> => {
    const repository = await options.cache.fetch(input, signal, {
      refresh: readOptions?.refresh ?? true,
      historyDepth: SOURCE_HISTORY_DEPTH
    });
    const directory = normalizeDirectory(input.directory ?? repository.location.inferredDirectory);
    const explicitManifestPath = normalizeIndexManifestPath(input.indexManifestPath);
    if (directory) await readTreeOid(options.runner, repository, directory, signal);
    const listTree = async (scope?: string) => {
      const args = [
        "--git-dir",
        repository.cachePath,
        "ls-tree",
        "-r",
        "-t",
        "-z",
        repository.resolvedCommit,
        "--",
        ...(scope ? [scope] : [])
      ];
      const listed = await options.runner.run(args, { signal, timeoutMs: 30_000 });
      return parseTreeEntries(listed.stdout);
    };
    const scopedTreeEntries = await listTree(explicitManifestPath ? undefined : directory);
    const manifestPath =
      explicitManifestPath ?? (directory ? `${directory}/llms.txt` : "llms.txt");
    const manifestEntry = scopedTreeEntries.find(
      (entry) => entry.type === "blob" && entry.path === manifestPath
    );
    if (explicitManifestPath && !manifestEntry) {
      throw new Error(`Repository Skill index is missing: ${explicitManifestPath}`);
    }
    const repositoryTreeEntries = manifestEntry && !explicitManifestPath
      ? await listTree()
      : scopedTreeEntries;
    const allSkillFiles = repositoryTreeEntries
      .filter((entry) =>
        entry.type === "blob" &&
        (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md"))
      )
      .map((entry) => entry.path);
    const scopedSkillFiles = allSkillFiles.filter((path) =>
      !directory || path === `${directory}/SKILL.md` || path.startsWith(`${directory}/`)
    );
    let indexedPaths: string[] = [];
    if (manifestEntry) {
      const manifest = await options.runner.run(
        [
          "--git-dir",
          repository.cachePath,
          "show",
          `${repository.resolvedCommit}:${manifestPath}`
        ],
        { signal, timeoutMs: 30_000 }
      );
      const manifestDirectory = posix.dirname(manifestPath) === "."
        ? ""
        : posix.dirname(manifestPath);
      indexedPaths = indexedSkillFiles(
        manifest.stdout,
        manifestDirectory,
        new Set(allSkillFiles)
      );
    }
    const usesManifest = Boolean(
      manifestEntry && (explicitManifestPath || indexedPaths.length > 0)
    );
    const discoveredSkillFiles = usesManifest
      ? indexedPaths
      : scopedSkillFiles;
    const effectiveDirectory = usesManifest
      ? commonSkillDirectory(discoveredSkillFiles, directory)
      : directory;
    const selectedSkillFiles = boundedSkillFiles(
      discoveredSkillFiles,
      effectiveDirectory,
      !usesManifest
    );
    const roots = selectedSkillFiles
      .map((path) => posix.dirname(path) === "." ? "" : posix.dirname(path))
      .sort((left, right) => {
        const depth = left.split("/").length - right.split("/").length;
        return depth || left.localeCompare(right);
      });
    const maxCandidates = options.maxCandidates ?? 500;
    const selectedRoots = roots.slice(0, maxCandidates);
    const treeOidByPath = new Map(
      repositoryTreeEntries
        .filter((entry) => entry.type === "tree")
        .map((entry) => [entry.path, entry.sha] as const)
    );
    const shallowBoundary = await readShallowBoundary(repository);
    const updatedAtByRoot = await readUpdatedAtByDirectory(
      options.runner,
      repository,
      selectedRoots,
      shallowBoundary,
      signal
    );
    const readCandidate = async (root: string): Promise<RepositorySkillCandidate> => {
      const skillPath = root ? `${root}/SKILL.md` : "SKILL.md";
      const markdown = await options.runner.run(
        ["--git-dir", repository.cachePath, "show", `${repository.resolvedCommit}:${skillPath}`],
        { signal, timeoutMs: 30_000 }
      );
      const frontmatter = parseSkillFrontmatter(markdown.stdout);
      const fallbackName = root ? basename(root) : "skill";
      const name = frontmatter.name || fallbackName;
      const id = normalizeSkillId(name) || normalizeSkillId(fallbackName);
      const contentRevision = root
        ? treeOidByPath.get(root) ?? await readTreeOid(options.runner, repository, root, signal)
        : await readTreeOid(options.runner, repository, root, signal);
      const updatedAt = updatedAtByRoot.get(root);
      const source: ResolvedGitSkillSource = {
        ...repository,
        directory: root,
        contentRevision,
        upstream: {
          kind: "git",
          locator: repository.repository,
          ref: repository.ref,
          subpath: root || undefined,
          revision: repository.resolvedCommit,
          ...(updatedAt ? { updatedAt } : {})
        }
      };
      const compatibleRevision = githubContentsRevision(
        root,
        repositoryTreeEntries
          .filter((entry): entry is TreeEntry & { type: "blob" | "tree" } =>
            entry.type === "blob" || entry.type === "tree")
          .map((entry) => ({
            path: entry.path,
            type: entry.type,
            sha: entry.sha
          }))
      );
      return {
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
      };
    };
    const candidates = new Array<RepositorySkillCandidate>(selectedRoots.length);
    let nextCandidateIndex = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(CANDIDATE_READ_CONCURRENCY, selectedRoots.length) },
        async () => {
          while (nextCandidateIndex < selectedRoots.length) {
            const index = nextCandidateIndex;
            nextCandidateIndex += 1;
            candidates[index] = await readCandidate(selectedRoots[index]);
          }
        }
      )
    );
    const result = {
      repository: repository.repository,
      ref: repository.ref,
      directory: effectiveDirectory,
      transport: "system-git",
      accessTransport: repository.accessTransport,
      ...(usesManifest
        ? {
            indexManifest: {
              path: manifestPath,
              requestedDirectory: directory,
              resolvedDirectory: effectiveDirectory
            }
          }
        : {}),
      truncated: roots.length > maxCandidates,
      candidates
    } satisfies Omit<RepositorySkillScanResult, "sourceScope">;
    const sourceScope = createSkillSourceScope(input, result);
    if (!usesManifest) return { ...result, sourceScope };
    const requestedScope = createSkillSourceScope(input, {
      ...result,
      directory
    });
    return {
      ...result,
      sourceScope: {
        ...sourceScope,
        canonicalLink: requestedScope.canonicalLink,
        indexManifestPath: manifestPath
      }
    };
  };

  const materialize = async (
    input: RepositorySkillSourceInput,
    destination: string,
    signal?: AbortSignal,
    readOptions?: GitSourceReadOptions
  ): Promise<MaterializedGitSkillSource> => {
    if (await pathEntryExists(destination)) {
      const entries = await readdir(destination);
      if (entries.length > 0) throw new Error("Skill materialization destination must be empty");
    }
    const source = await resolve(input, signal, {
      ...readOptions,
      includeBlobs: true
    });
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
        { signal, timeoutMs: 120_000, env: { GIT_INDEX_FILE: indexPath } }
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
