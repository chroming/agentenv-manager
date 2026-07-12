import { chmod, cp, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentEnvPaths } from "./paths";
import { replacePathWithCopy, writeAtomic } from "./fileUtils";

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
    destinationRootPath === activeData ||
    destinationRootPath.startsWith(`${activeData}/`)
  ) {
    throw new Error("Store AgentEnv backups outside the active data directory");
  }
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
  await chmod(destination, 0o700);
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

export const inspectDataBackup = async (path: string): Promise<DataRestorePreview> => {
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
  backupPath: string
): Promise<{ safetyBackupPath: string }> => {
  await inspectDataBackup(backupPath);
  if (
    resolve(backupPath) === resolve(paths.appDataRoot) ||
    resolve(backupPath).startsWith(`${resolve(paths.appDataRoot)}/`)
  ) {
    throw new Error("Choose a backup stored outside the active AgentEnv data directory");
  }
  const safetyRoot = join(dirname(paths.appDataRoot), "agentenv-import-safety");
  await mkdir(safetyRoot, { recursive: true, mode: 0o700 });
  const safetyBackup = await createDataBackup(paths, safetyRoot);
  await replacePathWithCopy(join(backupPath, "data"), paths.appDataRoot, {
    dereference: false
  });
  return { safetyBackupPath: safetyBackup.path };
};
