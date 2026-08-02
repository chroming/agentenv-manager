import { randomUUID } from "node:crypto";
import { chmod, cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { hashPathEntry, syncPathTree } from "./filesystemIntegrity";

export const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

export const readTextIfExists = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }
    throw error;
  }
};

export const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

export const pathEntryExists = async (path: string) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

const syncPath = async (
  path: string,
  platform: NodeJS.Platform = process.platform
) => {
  // Windows requires a write-capable handle for FlushFileBuffers.
  const handle = await open(path, platform === "win32" ? "r+" : "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const windowsTransientCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

const retryTransientFilesystemOperation = async <T>(
  operation: () => Promise<T>,
  options: {
    platform?: NodeJS.Platform;
    attempts?: number;
    delayMs?: number;
  } = {}
): Promise<T> => {
  const platform = options.platform ?? process.platform;
  const attempts = platform === "win32" ? options.attempts ?? 5 : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : undefined;
      if (
        attempt >= attempts ||
        platform !== "win32" ||
        !code ||
        !windowsTransientCodes.has(code)
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, (options.delayMs ?? 20) * attempt)
      );
    }
  }
};

const removePath = (
  path: string,
  options: {
    force?: boolean;
    platform?: NodeJS.Platform;
    recursive?: boolean;
  } = {}
) => {
  const platform = options.platform ?? process.platform;
  return retryTransientFilesystemOperation(
    () =>
      rm(path, {
        ...(options.force !== undefined ? { force: options.force } : {}),
        ...(options.recursive !== undefined
          ? { recursive: options.recursive }
          : {}),
        ...(platform === "win32"
          ? { maxRetries: 5, retryDelay: 40 }
          : {})
      }),
    { platform, attempts: 5, delayMs: 40 }
  );
};

export const syncParentDirectory = async (
  path: string,
  options: {
    platform?: NodeJS.Platform;
    sync?: (path: string) => Promise<void>;
  } = {}
) => {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return;
  await (options.sync ?? ((candidate) => syncPath(candidate, platform)))(path);
};

export const writeAtomic = async (
  targetPath: string,
  content: string | Uint8Array,
  options: {
    mode?: number;
    platform?: NodeJS.Platform;
    sync?: (path: string) => Promise<void>;
    expectedTargetHash?: string;
  } = {}
) => {
  const platform = options.platform ?? process.platform;
  const sync = options.sync ?? ((path: string) => syncPath(path, platform));
  const mode = options.mode ?? await lstat(targetPath)
    .then((stats) => stats.isFile() ? stats.mode & 0o777 : 0o600)
    .catch((error) => {
      if (isMissingFileError(error)) return 0o600;
      throw error;
    });
  if (Object.prototype.hasOwnProperty.call(options, "expectedTargetHash")) {
    await replacePathAtomically(
      targetPath,
      async (stagingPath) => {
        await writeFile(stagingPath, content, { flag: "wx", mode });
        if (platform !== "win32") {
          await chmod(stagingPath, mode);
        }
        await sync(stagingPath);
      },
      {
        expectedTargetHash: options.expectedTargetHash,
        platform: options.platform
      }
    );
    return;
  }
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const tempPath = `${targetPath}.agentenv-tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, content, {
      flag: "wx",
      mode
    });
    if (platform !== "win32") {
      await chmod(tempPath, mode);
    }
    await sync(tempPath);
    await retryTransientFilesystemOperation(
      () => rename(tempPath, targetPath),
      { platform: options.platform }
    );
    await syncParentDirectory(dirname(targetPath), options);
  } finally {
    await removePath(tempPath, {
      force: true,
      platform: options.platform
    });
  }
};

const writeFreshAtomicFile = async (
  targetPath: string,
  content: string,
  options: {
    mode?: number;
    platform?: NodeJS.Platform;
    sync?: (path: string) => Promise<void>;
  } = {}
) => {
  const platform = options.platform ?? process.platform;
  const sync = options.sync ?? ((path: string) => syncPath(path, platform));
  const tempPath = `${targetPath}.agentenv-tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: options.mode ?? 0o600
    });
    await sync(tempPath);
    await retryTransientFilesystemOperation(
      () => rename(tempPath, targetPath),
      { platform: options.platform }
    );
    await syncParentDirectory(dirname(targetPath), options);
  } finally {
    await removePath(tempPath, {
      force: true,
      platform: options.platform
    });
  }
};

const replacementPaths = (targetPath: string) => ({
  journalPath: `${targetPath}.agentenv-replace.json`,
  previousPath: `${targetPath}.agentenv-previous`,
  stagingPath: `${targetPath}.agentenv-stage`
});

interface ReplacementJournal {
  formatVersion: 2;
  targetPath: string;
  hadTarget: boolean;
  phase: "prepared" | "previous-moved" | "committed";
  stagingHash: string;
  previousHash?: string;
}

interface LegacyReplacementJournal {
  targetPath: string;
  hadTarget: boolean;
}

const writeReplacementJournal = async (
  journalPath: string,
  journal: ReplacementJournal,
  options: { platform?: NodeJS.Platform } = {}
) => {
  await writeAtomic(
    journalPath,
    `${JSON.stringify(journal, null, 2)}\n`,
    { platform: options.platform }
  );
};

const cleanupReplacementArtifacts = async (
  targetPath: string,
  options: { platform?: NodeJS.Platform } = {}
) => {
  const { journalPath, previousPath, stagingPath } = replacementPaths(targetPath);
  await removePath(previousPath, {
    recursive: true,
    force: true,
    platform: options.platform
  });
  await removePath(stagingPath, {
    recursive: true,
    force: true,
    platform: options.platform
  });
  await removePath(journalPath, {
    force: true,
    platform: options.platform
  });
  await syncParentDirectory(dirname(targetPath), options);
};

const assertReplacementArtifact = async (
  path: string,
  expectedHash: string,
  label: string
) => {
  const actualHash = await hashPathEntry(path);
  if (actualHash !== undefined && actualHash !== expectedHash) {
    throw new Error(`${label} changed during recovery and was preserved: ${path}`);
  }
};

export const recoverAtomicReplacement = async (
  targetPath: string,
  options: { platform?: NodeJS.Platform } = {}
) => {
  const { journalPath, previousPath, stagingPath } = replacementPaths(targetPath);
  if (!(await pathEntryExists(journalPath))) {
    return;
  }

  let journal: ReplacementJournal | LegacyReplacementJournal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8")) as ReplacementJournal;
  } catch {
    throw new Error(`Cannot recover an invalid AgentEnv replacement journal: ${journalPath}`);
  }
  if (journal.targetPath !== targetPath || typeof journal.hadTarget !== "boolean") {
    throw new Error(`AgentEnv replacement journal does not match its target: ${journalPath}`);
  }

  const targetExists = await pathEntryExists(targetPath);
  const previousExists = await pathEntryExists(previousPath);
  const stagingExists = await pathEntryExists(stagingPath);

  if (!("formatVersion" in journal)) {
    if (!targetExists && previousExists) {
      if (stagingExists) {
        throw new Error(
          `Legacy AgentEnv replacement has unverified staging data and was preserved: ${stagingPath}`
        );
      }
      await retryTransientFilesystemOperation(
        () => rename(previousPath, targetPath),
        options
      );
      await cleanupReplacementArtifacts(targetPath, options);
      return;
    }
    if (targetExists && previousExists) {
      throw new Error(
        `Legacy AgentEnv replacement is ambiguous; both current and previous data were preserved: ${targetPath}`
      );
    }
    if (targetExists) {
      if (stagingExists) {
        throw new Error(
          `Legacy AgentEnv replacement has unverified staging data and was preserved: ${stagingPath}`
        );
      }
      await cleanupReplacementArtifacts(targetPath, options);
      return;
    }
    throw new Error(`Legacy AgentEnv replacement cannot be recovered automatically: ${targetPath}`);
  }
  if (
    journal.formatVersion !== 2 ||
    !["prepared", "previous-moved", "committed"].includes(journal.phase) ||
    typeof journal.stagingHash !== "string" ||
    (journal.hadTarget && typeof journal.previousHash !== "string")
  ) {
    throw new Error(`AgentEnv replacement journal is incomplete: ${journalPath}`);
  }

  if (!targetExists && previousExists) {
    if ((await hashPathEntry(previousPath)) !== journal.previousHash) {
      throw new Error(`Previous AgentEnv data changed during recovery and was preserved: ${previousPath}`);
    }
    await assertReplacementArtifact(
      stagingPath,
      journal.stagingHash,
      "Staging AgentEnv data"
    );
    await retryTransientFilesystemOperation(
      () => rename(previousPath, targetPath),
      options
    );
    await cleanupReplacementArtifacts(targetPath, options);
    return;
  }
  if (!targetExists) {
    if (journal.hadTarget) {
      throw new Error(`Previous AgentEnv data is missing during recovery: ${previousPath}`);
    }
    await assertReplacementArtifact(
      stagingPath,
      journal.stagingHash,
      "Staging AgentEnv data"
    );
    await removePath(stagingPath, {
      recursive: true,
      force: true,
      platform: options.platform
    });
    await removePath(journalPath, { force: true, platform: options.platform });
    await syncParentDirectory(dirname(targetPath), options);
    return;
  }

  const targetHash = await hashPathEntry(targetPath);
  if (previousExists) {
    const previousHash = await hashPathEntry(previousPath);
    if (previousHash !== journal.previousHash || targetHash !== journal.stagingHash) {
      throw new Error(
        `AgentEnv replacement conflicts with externally changed data; current and previous paths were preserved: ${targetPath}`
      );
    }
    await assertReplacementArtifact(
      stagingPath,
      journal.stagingHash,
      "Staging AgentEnv data"
    );
    await cleanupReplacementArtifacts(targetPath, options);
    return;
  }

  if (journal.hadTarget) {
    const safeCommitted = journal.phase === "committed" && targetHash === journal.stagingHash;
    const safeUnchanged = journal.phase === "prepared" && targetHash === journal.previousHash;
    if (!safeCommitted && !safeUnchanged) {
      throw new Error(
        `AgentEnv replacement cannot identify the current data and preserved its journal: ${targetPath}`
      );
    }
  } else if (targetHash !== journal.stagingHash) {
    throw new Error(
      `A path appeared during AgentEnv replacement and was preserved for review: ${targetPath}`
    );
  }
  await assertReplacementArtifact(
    stagingPath,
    journal.stagingHash,
    "Staging AgentEnv data"
  );
  await cleanupReplacementArtifacts(targetPath, options);
};

export const recoverPendingReplacementsInDirectory = async (directory: string) => {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  const suffix = ".agentenv-replace.json";
  for (const entry of entries.filter((name) => name.endsWith(suffix))) {
    await recoverAtomicReplacement(join(directory, entry.slice(0, -suffix.length)));
  }
};

export const replacePathAtomically = async (
  targetPath: string,
  prepare: (stagingPath: string) => Promise<void>,
  options: { expectedTargetHash?: string; platform?: NodeJS.Platform } = {}
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  await recoverAtomicReplacement(targetPath, options);
  const { journalPath, previousPath, stagingPath } = replacementPaths(targetPath);
  if (await pathEntryExists(previousPath)) {
    throw new Error(
      `Unclaimed previous AgentEnv data was preserved for recovery: ${previousPath}`
    );
  }
  await removePath(stagingPath, {
    recursive: true,
    force: true,
    platform: options.platform
  });

  const initialTargetHash = await hashPathEntry(targetPath);
  const hadTarget = initialTargetHash !== undefined;
  if (
    Object.prototype.hasOwnProperty.call(options, "expectedTargetHash") &&
    initialTargetHash !== options.expectedTargetHash
  ) {
    throw new Error(`Replacement target changed after it was reviewed: ${targetPath}`);
  }
  let journalCreated = false;
  let committedHash: string | undefined;
  try {
    await prepare(stagingPath);
    if (!(await pathEntryExists(stagingPath))) {
      throw new Error(`Replacement did not create its staging path: ${stagingPath}`);
    }
    await syncPathTree(stagingPath, options.platform ?? process.platform);
    const stagingHash = await hashPathEntry(stagingPath);
    if (!stagingHash) {
      throw new Error(`Replacement staging data disappeared: ${stagingPath}`);
    }
    const previousHash = initialTargetHash;
    if ((await hashPathEntry(targetPath)) !== previousHash) {
      throw new Error(`Replacement target changed while staging data was prepared: ${targetPath}`);
    }
    const journal: ReplacementJournal = {
      formatVersion: 2,
      targetPath,
      hadTarget,
      phase: "prepared",
      stagingHash,
      previousHash
    };
    await writeFreshAtomicFile(
      journalPath,
      `${JSON.stringify(journal, null, 2)}\n`,
      options
    );
    journalCreated = true;
    if (hadTarget) {
      if ((await hashPathEntry(targetPath)) !== previousHash) {
        throw new Error(`Replacement target changed before it could be preserved: ${targetPath}`);
      }
      await retryTransientFilesystemOperation(
        () => rename(targetPath, previousPath),
        options
      );
      if ((await hashPathEntry(previousPath)) !== previousHash) {
        throw new Error(`Replacement could not verify the preserved target: ${previousPath}`);
      }
      journal.phase = "previous-moved";
      await writeReplacementJournal(journalPath, journal, options);
    }
    if ((await hashPathEntry(stagingPath)) !== stagingHash) {
      throw new Error(`Replacement staging data changed before commit: ${stagingPath}`);
    }
    if (await pathEntryExists(targetPath)) {
      throw new Error(`Replacement target reappeared before commit and was preserved: ${targetPath}`);
    }
    await retryTransientFilesystemOperation(
      () => rename(stagingPath, targetPath),
      options
    );
    if ((await hashPathEntry(targetPath)) !== stagingHash) {
      throw new Error(`Replacement target does not match its staged data: ${targetPath}`);
    }
    committedHash = stagingHash;
    journal.phase = "committed";
    await writeReplacementJournal(journalPath, journal, options);
    await syncParentDirectory(dirname(targetPath), options);
  } catch (error) {
    if (!journalCreated) {
      await removePath(stagingPath, {
        recursive: true,
        force: true,
        platform: options.platform
      });
      throw error;
    }
    try {
      await recoverAtomicReplacement(targetPath, options);
    } catch (recoveryError) {
      throw new Error(
        `Replacement failed and requires recovery. Current, previous, and staging data were preserved. ${
          recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        }`,
        { cause: error }
      );
    }
    throw error;
  }

  try {
    if (initialTargetHash) {
      await assertReplacementArtifact(
        previousPath,
        initialTargetHash,
        "Previous AgentEnv data"
      );
    }
    await assertReplacementArtifact(
      stagingPath,
      committedHash,
      "Staging AgentEnv data"
    );
    await cleanupReplacementArtifacts(targetPath, options);
  } catch {
    // A completed target plus its journal is safe; startup recovery finishes cleanup.
  }
  if (!committedHash) {
    throw new Error(`Replacement did not commit verified data: ${targetPath}`);
  }
  return committedHash;
};

export const replacePathWithCopy = async (
  sourcePath: string,
  targetPath: string,
  options: {
    dereference?: boolean;
    expectedTargetHash?: string;
  } = {}
) =>
  replacePathAtomically(
    targetPath,
    (stagingPath) =>
      cp(sourcePath, stagingPath, {
        recursive: true,
        dereference: options.dereference ?? false,
        verbatimSymlinks: true
      }),
    Object.prototype.hasOwnProperty.call(options, "expectedTargetHash")
      ? { expectedTargetHash: options.expectedTargetHash }
      : {}
  );
