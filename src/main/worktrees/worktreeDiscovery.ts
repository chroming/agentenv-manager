import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isMissingFileError } from "../fileUtils";
import { GitCommandError, type GitCommandRunner } from "../skillSources/gitCommandRunner";

export const WORKTREE_SCAN_SKIP_DIRECTORIES = new Set([
  ".git", ".cache", ".config", ".venv", "node_modules", "vendor", "dist", "build", "target"
]);
const REPOSITORY_WORKTREE_CONTAINERS = ["_worktrees", ".worktrees", "worktrees", "Worktrees"];

export const findRepositoryAncestor = async (root: string, signal?: AbortSignal): Promise<string | undefined> => {
  let path = resolve(root);
  while (true) {
    signal?.throwIfAborted();
    try {
      await lstat(join(path, ".git"));
      return path;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    const parent = dirname(path);
    if (parent === path) return undefined;
    path = parent;
  }
};

export const repositoryDiscoveryIssue = (path: string, error: unknown): string => {
  if (error instanceof GitCommandError && /not a git repository|invalid gitfile format|not a \.git file/i.test(error.stderr)) {
    return `${path}: Git metadata is unavailable. Check this folder's .git file or directory, or remove this scan location. Other folders will still be scanned.`;
  }
  return `${path}: ${error instanceof Error ? error.message : String(error)}`;
};

export const repositoryDiscoveryDirectories = async (
  runner: GitCommandRunner, root: string, signal?: AbortSignal
): Promise<{ paths: string[]; issues: string[] }> => {
  const candidates = new Set(REPOSITORY_WORKTREE_CONTAINERS);
  const issues: string[] = [];
  try {
    // Without standard exclusions, ignored nested repositories remain discoverable.
    const untracked = await runner.run(["-c", "core.fsmonitor=false", "ls-files", "--others", "--directory", "-z"], {
      cwd: root, env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 8_000, maxOutputBytes: 2_000_000, signal
    });
    for (const path of untracked.stdout.split("\0")) {
      if (path.endsWith("/") && !path.split("/").some((part) => WORKTREE_SCAN_SKIP_DIRECTORIES.has(part))) {
        candidates.add(path);
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    issues.push(`${root}: Could not discover untracked repository folders: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const modulesPath = join(root, ".gitmodules");
    const modules = await lstat(modulesPath).catch((error) => {
      if (isMissingFileError(error)) return undefined;
      throw error;
    });
    if (modules) {
      if (!modules.isFile()) throw new Error("Submodule declarations must be a regular .gitmodules file");
      const config = await runner.run(["config", "--no-includes", "--null", "--file", modulesPath, "--list"], {
        cwd: root, env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 8_000, maxOutputBytes: 128_000, signal
      });
      for (const field of config.stdout.split("\0")) {
        const separator = field.indexOf("\n");
        if (separator >= 0 && /^submodule\..*\.path$/.test(field.slice(0, separator))) {
          candidates.add(field.slice(separator + 1));
        }
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    issues.push(`${root}: Could not discover declared submodules: ${error instanceof Error ? error.message : String(error)}`);
  }
  const paths: string[] = [];
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    const path = resolve(root, candidate);
    const difference = relative(root, path);
    if (isAbsolute(candidate) || !difference || difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference)) {
      issues.push(`${root}: Repository discovery path is outside this repository: ${candidate}`);
      continue;
    }
    try {
      let directory = root;
      let available = true;
      // Git declarations cannot make discovery follow an intermediate directory link.
      for (const part of difference.split(sep)) {
        signal?.throwIfAborted();
        directory = join(directory, part);
        if (!(await lstat(directory)).isDirectory()) { available = false; break; }
      }
      if (available) paths.push(path);
    } catch (error) {
      signal?.throwIfAborted();
      if (!isMissingFileError(error)) issues.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { paths: [...new Set(paths)], issues };
};

// Existing conventional containers only; discovery never starts at all Home.
export const worktreeDiscoveryCandidates = (home: string): string[] => [
  [".config", "superpowers", "worktrees"],
  [".codex", "worktrees"],
  [".claude", "worktrees"],
  [".cursor", "worktrees"],
  ["orca", "workspaces"],
  ["_worktrees"], [".worktrees"], ["worktrees"], ["Worktrees"],
  ["Github"], ["GitHub"], ["github"], ["git"], ["Git"],
  ["Projects"], ["projects"], ["Code"], ["Developer"], ["src"],
  ["dev"], ["Development"], ["Repos"], ["repos"], ["repositories"],
  ["Documents", "Git"], ["Documents", "Github"], ["Documents", "GitHub"],
  ["Documents", "Projects"], ["Documents", "Code"]
].map((parts) => join(home, ...parts));
