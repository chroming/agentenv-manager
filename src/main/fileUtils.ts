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

export const writeAtomic = async (targetPath: string, content: string) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.agentenv-tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await syncPath(tempPath);
    await rename(tempPath, targetPath);
    await syncPath(dirname(targetPath));
  } finally {
    await rm(tempPath, { force: true });
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

export const recoverAtomicReplacement = async (targetPath: string) => {
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
    await rename(previousPath, targetPath);
  } else if (!targetExists && !journal.hadTarget && stagingExists) {
    await rename(stagingPath, targetPath);
  }

  if (await pathEntryExists(targetPath)) {
    await rm(previousPath, { recursive: true, force: true });
    await rm(stagingPath, { recursive: true, force: true });
    await rm(journalPath, { force: true });
    await syncPath(dirname(targetPath));
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
  prepare: (stagingPath: string) => Promise<void>
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  await recoverAtomicReplacement(targetPath);
  const { journalPath, previousPath, stagingPath } = replacementPaths(targetPath);
  await rm(stagingPath, { recursive: true, force: true });
  await rm(previousPath, { recursive: true, force: true });

  const hadTarget = await pathEntryExists(targetPath);
  try {
    await prepare(stagingPath);
    if (!(await pathEntryExists(stagingPath))) {
      throw new Error(`Replacement did not create its staging path: ${stagingPath}`);
    }
    await writeAtomic(journalPath, `${JSON.stringify({ targetPath, hadTarget }, null, 2)}\n`);
    if (hadTarget) {
      await rename(targetPath, previousPath);
    }
    try {
      await rename(stagingPath, targetPath);
    } catch (error) {
      if (hadTarget && (await pathEntryExists(previousPath))) {
        await rename(previousPath, targetPath);
      }
      throw error;
    }
    await syncPath(dirname(targetPath));
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    if (!(await pathEntryExists(targetPath)) && (await pathEntryExists(previousPath))) {
      await rename(previousPath, targetPath);
    }
    await rm(journalPath, { force: true });
    throw error;
  }

  try {
    await rm(previousPath, { recursive: true, force: true });
    await rm(journalPath, { force: true });
    await syncPath(dirname(targetPath));
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
