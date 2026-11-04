import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, symlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { copyPathVerified, hashRequiredPathEntry } from "../filesystemIntegrity";
import { writeAtomic } from "../fileUtils";
import { GitCommandError, type GitCommandRunner, type GitCommandRunOptions } from "../skillSources/gitCommandRunner";
import { assertNoWorktreeWriter } from "./worktreeGitState";
import type { WorktreeRestoreRegistration } from "../../shared/worktrees";

// Registration links belong to Git. HEAD is recreated from the saved commit and
// branch without moving a branch that somebody else changed. The new checkout's
// reflog belongs to that registration, not the paused operation. Index has its own
// verified payload (including conflict stages).
const excluded = new Set(["gitdir", "commondir", "HEAD", "index", "locked", "logs"]);

export const assertLinkedGitDirectory = async (commonDir: string, path: string, gitDir: string) => {
  const link = join(path, ".git");
  const [rootInfo, linkInfo, adminInfo] = await Promise.all([lstat(path), lstat(link), lstat(gitDir)]);
  const backlink = join(gitDir, "gitdir"), commonLink = join(gitDir, "commondir");
  const optionalInfo = (path: string) => lstat(path).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const [backlinkInfo, commonInfo] = await Promise.all([optionalInfo(backlink), optionalInfo(commonLink)]);
  const gitFile = await readFile(link, "utf8");
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !linkInfo.isFile() || linkInfo.isSymbolicLink() ||
      !adminInfo.isDirectory() || adminInfo.isSymbolicLink() ||
      !backlinkInfo?.isFile() || backlinkInfo.isSymbolicLink() || !commonInfo?.isFile() || commonInfo.isSymbolicLink() ||
      !gitFile.startsWith("gitdir: ") || await realpath(resolve(path, gitFile.slice(8).trim())) !== await realpath(gitDir) ||
      dirname(await realpath(gitDir)) !== join(await realpath(commonDir), "worktrees") ||
      await realpath(resolve(gitDir, (await readFile(commonLink, "utf8")).trim())) !== await realpath(commonDir) ||
      resolve(gitDir, (await readFile(backlink, "utf8")).trim()) !== resolve(link)) {
    throw new Error("Unverified linked Worktree Git registration. Main working tree was not changed.");
  }
};

export const readLinkedRegistrationIdentity = async (commonDir: string, path: string, gitDir: string): Promise<WorktreeRestoreRegistration> => {
  await assertLinkedGitDirectory(commonDir, path, gitDir);
  const admin = await lstat(gitDir, { bigint: true });
  const worktree = await lstat(path, { bigint: true });
  const link = await lstat(join(path, ".git"), { bigint: true });
  return {
    gitDir: await realpath(gitDir), commonDir: await realpath(commonDir),
    adminDevice: String(admin.dev), adminInode: String(admin.ino),
    worktreeDevice: String(worktree.dev), worktreeInode: String(worktree.ino),
    linkDevice: String(link.dev), linkInode: String(link.ino),
    gitFileHash: await hashRequiredPathEntry(join(path, ".git")),
    backlinkHash: await hashRequiredPathEntry(join(gitDir, "gitdir")),
    commonLinkHash: await hashRequiredPathEntry(join(gitDir, "commondir"))
  };
};

export const worktreeAdminIdentities = async (commonDir: string) => {
  const root = join(await realpath(commonDir), "worktrees");
  const names = await readdir(root).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const identities = new Map<string, string>();
  for (const name of names) {
    const path = join(root, name), info = await lstat(path, { bigint: true });
    identities.set(path, `${info.dev}:${info.ino}`);
  }
  return identities;
};

export const pinRestoreRegistration = async (commonDir: string, path: string, before: Map<string, string>) => {
  const candidates: string[] = [];
  for (const [admin, identity] of await worktreeAdminIdentities(commonDir)) {
    if (before.get(admin) === identity) continue;
    const backlink = await readFile(join(admin, "gitdir"), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (backlink && resolve(admin, backlink.trim()) === resolve(path, ".git")) candidates.push(admin);
  }
  if (candidates.length !== 1) throw new Error("Unverified recovery Git registration identity; nothing was overwritten");
  return readLinkedRegistrationIdentity(commonDir, path, candidates[0]);
};

export const assertRestoreRegistration = async (identity: WorktreeRestoreRegistration, commonDir: string, path: string) => {
  const current = await readLinkedRegistrationIdentity(commonDir, path, identity.gitDir);
  if (JSON.stringify(current) !== JSON.stringify(identity)) {
    throw new Error("Recovery Git registration identity changed; nothing was overwritten");
  }
};

const assertMetadataTree = async (path: string): Promise<void> => {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
    throw new Error("Unsupported Git recovery metadata. Nothing was removed.");
  }
  if (info.isDirectory()) for (const name of await readdir(path)) {
    if (name.endsWith(".lock")) throw new Error(`Git write lock is present (${join(path, name)}). Inspect this lock and retry when safe.`);
    await assertMetadataTree(join(path, name));
  }
};

export const operationMetadataHash = async (gitDir: string) => {
  await assertNoWorktreeWriter(gitDir);
  const hash = createHash("sha256");
  for (const name of (await readdir(gitDir)).filter((name) => !excluded.has(name)).sort()) {
    if (name.endsWith(".lock")) throw new Error(`Git write lock is present (${join(gitDir, name)}). Inspect this lock and retry when safe.`);
    await assertMetadataTree(join(gitDir, name));
    hash.update(JSON.stringify([name, await hashRequiredPathEntry(join(gitDir, name))]));
  }
  return hash.digest("hex");
};

export const backupOperationMetadata = async (gitDir: string, destination: string) => {
  const before = await operationMetadataHash(gitDir);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const name of (await readdir(gitDir)).filter((name) => !excluded.has(name))) {
    await copyPathVerified(join(gitDir, name), join(destination, name));
  }
  if (before !== await operationMetadataHash(gitDir) || before !== await operationMetadataHash(destination)) {
    throw new Error("Worktree operation metadata changed while backup was created");
  }
  return before;
};

export const recoveryGitStateHash = async (gitDir: string) => {
  const hash = createHash("sha256").update(await operationMetadataHash(gitDir));
  for (const name of ["HEAD", "index"]) {
    const info = await lstat(join(gitDir, name)).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    hash.update(info ? await hashRequiredPathEntry(join(gitDir, name)) : "missing");
  }
  return hash.digest("hex");
};

export const copyRecoveryPathExclusive = async (source: string, destination: string): Promise<void> => {
  const sourceInfo = await lstat(source);
  const targetInfo = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (sourceInfo.isDirectory()) {
    if (targetInfo && (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())) {
      throw new Error("The recovery path contains unverified files. Nothing was overwritten.");
    }
    if (!targetInfo) await mkdir(destination, { mode: sourceInfo.mode & 0o777 });
    for (const name of await readdir(source)) await copyRecoveryPathExclusive(join(source, name), join(destination, name));
  } else if (targetInfo) {
    if (await hashRequiredPathEntry(source) !== await hashRequiredPathEntry(destination)) {
      throw new Error("The recovery path contains unverified files. Nothing was overwritten.");
    }
  } else if (sourceInfo.isSymbolicLink()) {
    await symlink(await readlink(source), destination);
  } else if (sourceInfo.isFile()) {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  } else {
    throw new Error("Unsupported recovery file type; nothing was overwritten");
  }
};

// Preserve operation commits (including ORIG_HEAD and abbreviated rebase todo
// commits), index blobs, and per-worktree refs across reflog expiry / git gc.
export const operationRecoveryObjects = async (runner: GitCommandRunner, cwd: string, metadata: string, head: string,
  onUnavailable?: (reference: { field: string; object: string }) => void) => {
  const run = (args: string[], options: GitCommandRunOptions) => runner.run(["-c", "core.commitGraph=false", ...args], {
    ...options, env: { ...options.env, GIT_NO_LAZY_FETCH: "1" }
  });
  const candidates = new Map<string, { field: string; type: "commit" | "object" }>();
  const required = (token: string | undefined, field: string, type: "commit" | "object" = "commit", named = false) => {
    if (!token || (!named && !/^[0-9a-f]{4,64}$/.test(token))) {
      throw new Error(`Required Git recovery object in ${field} is invalid; nothing was removed`);
    }
    candidates.set(token, { field, type });
  };
  const walk = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await walk(join(path, name));
    } else {
      const name = relative(metadata, path).split(sep).join("/");
      const objectField = /^(?:ORIG_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|REBASE_HEAD|AUTO_MERGE|MERGE_AUTOSTASH|REBASE_AUTOSTASH|BISECT_EXPECTED_REV|BISECT_HEAD|BISECT_START)$/;
      const operationField = /^(?:(?:rebase-merge|rebase-apply)\/(?:orig-head|onto|stopped-sha|autostash|amend|original-commit|squash-onto|rewritten-list)|sequencer\/(?:head|abort-safety)|refs\/.*)$/;
      const todo = /^(?:rebase-merge\/(?:git-rebase-todo(?:\.backup)?|done)|sequencer\/todo)$/;
      if (!objectField.test(name) && !operationField.test(name) && !todo.test(name) && name !== "BISECT_LOG") return;
      const content = await readFile(path, "utf8");
      if (todo.test(name)) {
        for (const line of content.split("\n")) {
          const [command, first, second] = line.trim().split(/\s+/);
          if (/^(?:pick|p|revert|reword|r|edit|e|squash|s|fixup|f|drop|d)$/.test(command)) {
            required(/^-[Cc]$/.test(first) ? second : first, name);
          } else if (/^(?:merge|m)$/.test(command) && /^-[Cc]$/.test(first)) {
            required(second, name);
          }
        }
      } else if (name === "BISECT_LOG") {
        for (const line of content.split("\n")) {
          const match = /^# (?:good|bad|skip): \[([^\]]+)\]/.exec(line);
          if (match) required(match[1], name);
        }
      } else if (name.endsWith("/rewritten-list")) {
        for (const line of content.split("\n").filter((line) => line.trim())) {
          const [before, after] = line.trim().split(/\s+/);
          required(before, name); required(after, name);
        }
      } else {
        for (const line of content.split("\n").filter((line) => line.trim())) {
          const symbolic = line.startsWith("ref: ");
          required(symbolic ? line.slice(5).trim() : line.trim(), name,
            name === "AUTO_MERGE" || name.startsWith("refs/") ? "object" : "commit", symbolic || name === "BISECT_START");
        }
      }
    }
  };
  await walk(metadata);
  const options = { cwd, timeoutMs: 8_000, maxOutputBytes: 4_000_000,
    env: { GIT_OPTIONAL_LOCKS: "0", GIT_INDEX_FILE: join(metadata, "..", "index") } };
  const headTree = await run(["ls-tree", "-r", "-z", head], options);
  const reachable = new Set([...headTree.stdout.matchAll(/(?:^|\0)\d+ \w+ ([0-9a-f]{40,64})\t/g)].map((match) => match[1]));
  const index = await run(["ls-files", "--stage", "-z"], options);
  const blobs = new Set([...index.stdout.matchAll(/(?:^|\0)\d+ ([0-9a-f]{40,64}) /g)]
    .map((match) => match[1]).filter((object) => !reachable.has(object)));
  const objects = new Set<string>();
  if (blobs.size) {
    // A single recovery tree keeps all otherwise-unreachable index blobs alive,
    // with no process/ref per tracked file. Git validates object types here.
    const tree = Buffer.concat([...blobs].sort().map((object, i) =>
      Buffer.concat([Buffer.from(`100644 index-${String(i).padStart(10, "0")}\0`), Buffer.from(object, "hex")])));
    const treePath = join(metadata, "..", "index-objects.tree");
    await writeAtomic(treePath, tree);
    const saved = await run(["hash-object", "-t", "tree", "-w", treePath], options);
    const object = saved.stdout.trim();
    // Check this recovery tree only, not unrelated refs, reflogs or cached graphs.
    const reachable = await run(["rev-list", "--objects", "--no-object-names", "--missing=print", object], options);
    const listed = new Set(reachable.stdout.trim().split("\n"));
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(object) || reachable.stderr.trim() ||
        listed.size !== blobs.size + 1 || !listed.has(object) || [...blobs].some((blob) => !listed.has(blob))) {
      throw new Error("Staged recovery content is missing or unreadable; nothing was removed");
    }
    objects.add(object);
  }
  for (const [candidate, { field, type }] of candidates) {
    let object: string;
    try {
      object = (await run(["rev-parse", "--verify", "--end-of-options", `${candidate}^{${type}}`], {
        cwd, timeoutMs: 8_000, maxOutputBytes: 32_000
      })).stdout.trim();
    } catch (error) {
      const exitCode = error instanceof GitCommandError ? error.exitCode : (error as { code?: number })?.code;
      // Only an independently confirmed absent full object ID is pre-existing
      // damage. Timeouts, ambiguous IDs and unreadable existing objects still fail.
      if (onUnavailable && exitCode === 128 && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(candidate)) {
        const probe = await run(["rev-parse", `--disambiguate=${candidate}`], { cwd, timeoutMs: 8_000, maxOutputBytes: 32_000 });
        if (probe.exitCode === 0 && !probe.stdout.trim() && !probe.stderr.trim()) {
          onUnavailable({ field, object: candidate });
          continue;
        }
      }
      throw new Error(`Required Git recovery object ${candidate} (${field}) could not be resolved: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(object)) {
      throw new Error(`Required Git recovery object ${candidate} (${field}) returned invalid evidence; nothing was removed`);
    }
    objects.add(object);
  }
  return [...objects].sort();
};
