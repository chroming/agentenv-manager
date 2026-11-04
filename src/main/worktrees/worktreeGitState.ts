import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WorktreeEntry, WorktreeIntegration } from "../../shared/worktrees";
import { hashPathEntry, hashRequiredPathEntry } from "../filesystemIntegrity";
import { isMissingFileError } from "../fileUtils";
import { GitCommandError, type GitCommandRunner, type GitCommandRunOptions } from "../skillSources/gitCommandRunner";

export const PAUSED_WORKTREE_MARKERS = [
  "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "BISECT_LOG",
  "rebase-merge", "rebase-apply", "sequencer", "BISECT_START"
];
export const ACTIVE_WORKTREE_LOCKS = ["index.lock", "HEAD.lock"];

export const assertNoWorktreeWriter = async (gitDir: string) => {
  for (const marker of ACTIVE_WORKTREE_LOCKS) {
    try {
      await lstat(join(gitDir, marker));
      throw new Error(`Git write lock is present (${marker}). Nothing was removed; inspect this lock and retry when safe.`);
    } catch (error) { if (!isMissingFileError(error)) throw error; }
  }
};

const pausedState = async (gitDir: string) => {
  const entries: Array<[string, string]> = [];
  for (const marker of [...PAUSED_WORKTREE_MARKERS, "ORIG_HEAD", "MERGE_MSG", "MERGE_MODE", "AUTO_MERGE", "SQUASH_MSG"]) {
    try {
      const hash = await hashPathEntry(join(gitDir, marker));
      if (hash) entries.push([marker, hash]);
    }
    catch (error) { if (!isMissingFileError(error)) throw error; }
  }
  return entries;
};

// Bounded metadata-only signatures detect ordinary edits without reading file
// contents or descending ignored directories. They do not prove tree equality.
const selectedPathSignatures = async (cwd: string, status: string) => {
  const records = status.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < records.length && paths.length < 256; ++i) {
    const record = records[i];
    if (!record) continue;
    paths.push(record.slice(3).replace(/\/$/, ""));
    if (/^[RC]|^.[RC]/.test(record)) ++i;
  }
  return Promise.all(paths.map(async (path) => {
    try {
      const info = await lstat(resolve(cwd, path), { bigint: true });
      return [path, info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].map(String);
    } catch (error) { if (isMissingFileError(error)) return [path, "missing"]; throw error; }
  }));
};

export const readWorktreeGit = async (runner: GitCommandRunner, args: string[], options: GitCommandRunOptions) => {
  const run = (bypassGraph = false) => runner.run(["-c", "core.fsmonitor=false",
    ...(bypassGraph ? ["-c", "core.commitGraph=false"] : []), ...args], {
    ...options, env: { ...options.env, GIT_OPTIONAL_LOCKS: "0" }
  });
  // Keep healthy history acceleration; retry only a read affected by that cache.
  try {
    const result = await run();
    return /commit-graph/i.test(result.stderr) ? run(true) : result;
  } catch (error) {
    if (error instanceof GitCommandError && /commit-graph/i.test(error.stderr)) return run(true);
    throw error;
  }
};

const read = (runner: GitCommandRunner, cwd: string, args: string[], signal?: AbortSignal) =>
  readWorktreeGit(runner, args, { cwd, timeoutMs: 8_000, maxOutputBytes: 4_000_000, signal });

export const readIntegration = async (runner: GitCommandRunner, cwd: string, selected?: string, signal?: AbortSignal): Promise<WorktreeIntegration> => {
  const output = (await read(runner, cwd,
    ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs/heads", "refs/remotes"], signal)).stdout;
  const refs = output.trim().split("\n").filter(Boolean).map((line) => {
    const [ref, head, symref] = line.split("\0");
    return { ref, head, symref };
  });
  const choices = refs.filter(({ symref }) => !symref).map(({ ref }) => ref).sort();
  const ref = selected ?? refs.find(({ ref, symref }) => ref === "refs/remotes/origin/HEAD" && symref)?.symref
    ?? ["refs/heads/main", "refs/heads/master"].find((name) => choices.includes(name));
  const head = refs.find((entry) => entry.ref === ref)?.head;
  return { ref, head, explicit: Boolean(selected), choices };
};

export const withIntegrationEvidence = async (runner: GitCommandRunner, cwd: string, integration: WorktreeIntegration, head?: string, signal?: AbortSignal): Promise<WorktreeIntegration> => {
  if (!integration.head || !head) return integration;
  try {
    const result = await read(runner, cwd, ["merge-base", integration.head, head], signal);
    return { ...integration, merged: result.stdout.trim() === head };
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) return { ...integration, merged: false };
    throw error;
  }
};

const indexHash = async (path: string) => {
  try {
    if (!(await lstat(path)).isFile()) throw new Error("Git index is not a regular file. Inspect this Worktree before cleanup.");
    return await hashRequiredPathEntry(path);
  }
  catch (error) { if (isMissingFileError(error)) return null; throw error; }
};

export const readWorktreeGitState = async (runner: GitCommandRunner, cwd: string) => {
  const gitDir = resolve(cwd, (await read(runner, cwd, ["rev-parse", "--git-dir"])).stdout.trim());
  await assertNoWorktreeWriter(gitDir);
  const operations = await pausedState(gitDir);
  const before = await indexHash(join(gitDir, "index"));
  const headEntry = await hashRequiredPathEntry(join(gitDir, "HEAD"));
  const head = (await read(runner, cwd, ["rev-parse", "HEAD"])).stdout.trim();
  const status = (await read(runner, cwd, ["status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=normal"])).stdout;
  const index = await indexHash(join(gitDir, "index"));
  const paths = await selectedPathSignatures(cwd, status);
  if (before !== index || headEntry !== await hashRequiredPathEntry(join(gitDir, "HEAD")) ||
      head !== (await read(runner, cwd, ["rev-parse", "HEAD"])).stdout.trim()) {
    throw new Error("Worktree changed after review. Refresh and review it again.");
  }
  await assertNoWorktreeWriter(gitDir);
  if (JSON.stringify(operations) !== JSON.stringify(await pausedState(gitDir))) {
    throw new Error("Worktree changed after review. Refresh and review it again.");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({ gitDir, head, headEntry, status, index, operations, paths })).digest("hex");
  return { fingerprint, index, gitDir, head, status };
};

export const reviewFingerprint = (entry: WorktreeEntry, gitFingerprint: string) =>
  createHash("sha256").update(JSON.stringify({
    path: entry.path, commonDir: entry.commonDir, repositoryPath: entry.repositoryPath,
    head: entry.head, branch: entry.branch, detached: entry.detached, locked: entry.locked,
    headNeedsProtection: entry.headNeedsProtection,
    pausedOperations: entry.pausedOperations,
    localContentUncertain: entry.localContentUncertain,
    keptReason: entry.keptReason, prunable: entry.prunable,
    integration: entry.integration && { ref: entry.integration.ref, head: entry.integration.head, merged: entry.integration.merged },
    gitFingerprint
  })).digest("hex");

export const readRepositoryRefs = async (runner: GitCommandRunner, cwd: string) =>
  (await read(runner, cwd, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes", "refs/tags"])).stdout;

export const readMainGitState = async (runner: GitCommandRunner, cwd: string) => {
  if ((await read(runner, cwd, ["rev-parse", "--is-bare-repository"])).stdout.trim() !== "true") {
    return readWorktreeGitState(runner, cwd);
  }
  const head = (await read(runner, cwd, ["symbolic-ref", "-q", "HEAD"])
    .catch((error) => {
      if (error instanceof GitCommandError && error.exitCode === 1) return read(runner, cwd, ["rev-parse", "HEAD"]);
      throw error;
    })).stdout;
  return { fingerprint: createHash("sha256").update(head).digest("hex") };
};
