import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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

const syncPath = async (path: string) => {
  const handle = await open(path, "r");
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
  if ((options.platform ?? process.platform) === "win32") return;
  await (options.sync ?? syncPath)(path);
};

export const writeAtomic = async (
  targetPath: string,
  content: string,
  options: {
    mode?: number;
    platform?: NodeJS.Platform;
    sync?: (path: string) => Promise<void>;
  } = {}
) => {
  const mode = options.mode ?? 0o600;
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const tempPath = `${targetPath}.agentenv-tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode
    });
    await (options.sync ?? syncPath)(tempPath);
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
  const tempPath = `${targetPath}.agentenv-tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: options.mode ?? 0o600
    });
    await (options.sync ?? syncPath)(tempPath);
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
  targetPath: string;
  hadTarget: boolean;
}

export const recoverAtomicReplacement = async (
  targetPath: string,
  options: { platform?: NodeJS.Platform } = {}
) => {
  const { journalPath, previousPath, stagingPath } = replacementPaths(targetPath);
  if (!(await pathEntryExists(journalPath))) {
    return;
  }

  let journal: ReplacementJournal;
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

  if (!targetExists && previousExists) {
    await retryTransientFilesystemOperation(
      () => rename(previousPath, targetPath),
      options
    );
  } else if (!targetExists && !journal.hadTarget && stagingExists) {
    await retryTransientFilesystemOperation(
      () => rename(stagingPath, targetPath),
      options
    );
  }

  if (await pathEntryExists(targetPath)) {
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
  }
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
  options: { platform?: NodeJS.Platform } = {}
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  await recoverAtomicReplacement(targetPath, options);
  const { journalPath, previousPath, stagingPath } = replacementPaths(targetPath);
  await removePath(stagingPath, {
    recursive: true,
    force: true,
    platform: options.platform
  });
  await removePath(previousPath, {
    recursive: true,
    force: true,
    platform: options.platform
  });

  const hadTarget = await pathEntryExists(targetPath);
  try {
    await prepare(stagingPath);
    if (!(await pathEntryExists(stagingPath))) {
      throw new Error(`Replacement did not create its staging path: ${stagingPath}`);
    }
    await writeFreshAtomicFile(
      journalPath,
      `${JSON.stringify({ targetPath, hadTarget }, null, 2)}\n`,
      options
    );
    if (hadTarget) {
      await retryTransientFilesystemOperation(
        () => rename(targetPath, previousPath),
        options
      );
    }
    try {
      await retryTransientFilesystemOperation(
        () => rename(stagingPath, targetPath),
        options
      );
    } catch (error) {
      if (hadTarget && (await pathEntryExists(previousPath))) {
        await retryTransientFilesystemOperation(
          () => rename(previousPath, targetPath),
          options
        );
      }
      throw error;
    }
    await syncParentDirectory(dirname(targetPath), options);
  } catch (error) {
    await removePath(stagingPath, {
      recursive: true,
      force: true,
      platform: options.platform
    });
    if (!(await pathEntryExists(targetPath)) && (await pathEntryExists(previousPath))) {
      await retryTransientFilesystemOperation(
        () => rename(previousPath, targetPath),
        options
      );
    }
    await removePath(journalPath, {
      force: true,
      platform: options.platform
    });
    throw error;
  }

  try {
    await removePath(previousPath, {
      recursive: true,
      force: true,
      platform: options.platform
    });
    await removePath(journalPath, {
      force: true,
      platform: options.platform
    });
    await syncParentDirectory(dirname(targetPath), options);
  } catch {
    // A completed target plus its journal is safe; startup recovery finishes cleanup.
  }
};

export const replacePathWithCopy = async (
  sourcePath: string,
  targetPath: string,
  options: { dereference?: boolean } = {}
) =>
  replacePathAtomically(targetPath, (stagingPath) =>
    cp(sourcePath, stagingPath, {
      recursive: true,
      dereference: options.dereference ?? false
    })
  );
