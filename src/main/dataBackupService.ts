import { chmod, cp, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentEnvPaths } from "./paths";
import { replacePathWithCopy, writeAtomic } from "./fileUtils";
import { ensureAppDataFormat } from "./appDataFormat";
import { validateAppDataRoot } from "./appDataValidation";
import { isPathInside, pathsEqual } from "./platformPaths";

export interface DataBackupResult {
  path: string;
  createdAt: string;
}

export interface DataRestorePreview {
  path: string;
  createdAt: string;
  formatVersion: number;
  topLevelItemCount: number;
}

const backupName = (createdAt: string) =>
  `AgentEnv-Backup-${createdAt.replace(/[:.]/g, "-")}`;

export const createDataBackup = async (
  paths: AgentEnvPaths,
  destinationRoot: string
): Promise<DataBackupResult> => {
  const activeData = resolve(paths.appDataRoot);
  const destinationRootPath = resolve(destinationRoot);
  if (
    pathsEqual(destinationRootPath, activeData) ||
    isPathInside(activeData, destinationRootPath)
  ) {
    throw new Error("Store AgentEnv backups outside the active data directory");
  }
  await ensureAppDataFormat(paths);
  const createdAt = new Date().toISOString();
  const destination = join(destinationRoot, backupName(createdAt));
  await mkdir(destination, { recursive: false, mode: 0o700 });
  await cp(paths.appDataRoot, join(destination, "data"), {
    recursive: true,
    dereference: false
  });
  await writeAtomic(
    join(destination, "agentenv-backup.json"),
    `${JSON.stringify(
      { formatVersion: 1, createdAt, sourceDirectoryName: basename(paths.appDataRoot) },
      null,
      2
    )}\n`,
  );
  if (process.platform !== "win32") await chmod(destination, 0o700);
  return { path: destination, createdAt };
};

const rejectLinks = async (path: string): Promise<void> => {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error("AgentEnv backups cannot contain symbolic links");
    }
    if (stats.isDirectory()) await rejectLinks(entryPath);
  }
};

interface DataBackupValidationOptions {
  validate?: (appDataRoot: string) => Promise<void>;
}

export const inspectDataBackup = async (
  path: string,
  options: DataBackupValidationOptions = {}
): Promise<DataRestorePreview> => {
  let manifest: { formatVersion?: unknown; createdAt?: unknown };
  try {
    manifest = JSON.parse(
      await readFile(join(path, "agentenv-backup.json"), "utf8")
    ) as { formatVersion?: unknown; createdAt?: unknown };
  } catch {
    throw new Error("Unsupported or invalid AgentEnv backup");
  }
  if (manifest.formatVersion !== 1 || typeof manifest.createdAt !== "string") {
    throw new Error("Unsupported or invalid AgentEnv backup");
  }
  const dataPath = join(path, "data");
  const dataStats = await lstat(dataPath).catch(() => undefined);
  if (!dataStats?.isDirectory() || dataStats.isSymbolicLink()) {
    throw new Error("Unsupported or invalid AgentEnv backup");
  }
  await rejectLinks(dataPath);
  await (options.validate ?? validateAppDataRoot)(dataPath);
  const entries = await readdir(dataPath);
  return {
    path,
    createdAt: manifest.createdAt,
    formatVersion: manifest.formatVersion,
    topLevelItemCount: entries.length
  };
};

export const restoreDataBackup = async (
  paths: AgentEnvPaths,
  backupPath: string,
  options: DataBackupValidationOptions = {}
): Promise<{ safetyBackupPath: string }> => {
  const validate = options.validate ?? validateAppDataRoot;
  await inspectDataBackup(backupPath, { validate });
  if (
    pathsEqual(backupPath, paths.appDataRoot) ||
    isPathInside(paths.appDataRoot, backupPath)
  ) {
    throw new Error("Choose a backup stored outside the active AgentEnv data directory");
  }
  const safetyRoot = join(dirname(paths.appDataRoot), "agentenv-import-safety");
  await mkdir(safetyRoot, { recursive: true, mode: 0o700 });
  const safetyBackup = await createDataBackup(paths, safetyRoot);
  try {
    await replacePathWithCopy(join(backupPath, "data"), paths.appDataRoot, {
      dereference: false
    });
    if (process.platform !== "win32") await chmod(paths.appDataRoot, 0o700);
    await ensureAppDataFormat(paths);
    await validate(paths.appDataRoot);
  } catch (error) {
    try {
      await replacePathWithCopy(
        join(safetyBackup.path, "data"),
        paths.appDataRoot,
        { dereference: false }
      );
      if (process.platform !== "win32") await chmod(paths.appDataRoot, 0o700);
      await ensureAppDataFormat(paths);
      await validate(paths.appDataRoot);
    } catch (rollbackError) {
      throw new Error(
        `Data restore failed and automatic recovery also failed. Recover from ${safetyBackup.path}. Restore error: ${
          error instanceof Error ? error.message : String(error)
        }. Recovery error: ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`
      );
    }
    throw new Error(
      `Data restore failed validation; the previous AgentEnv data was restored. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return { safetyBackupPath: safetyBackup.path };
};
