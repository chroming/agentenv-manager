import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import type {
  BackupEntry,
  BackupManifest,
  BackupSummary
} from "../shared/types";
import type { AgentEnvPaths } from "./paths";

export interface BackupStoreOptions {
  now?: () => Date;
}

export interface BackupStore {
  createBackup(sourcePaths: string[]): Promise<BackupManifest>;
  listBackups(): Promise<BackupSummary[]>;
  readBackup(id: string): Promise<BackupManifest>;
}

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const toBackupId = (date: Date) => date.toISOString().replace(/[:.]/g, "-");

const encodePath = (sourcePath: string): string =>
  Buffer.from(sourcePath).toString("base64url");

const sha256 = (content: Buffer): string =>
  createHash("sha256").update(content).digest("hex");

const ensurePrivateDir = async (path: string) => {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
};

export const createBackupStore = (
  paths: AgentEnvPaths,
  options: BackupStoreOptions = {}
): BackupStore => {
  const now = options.now ?? (() => new Date());

  const readBackup = async (id: string): Promise<BackupManifest> => {
    const content = await readFile(join(paths.backupsDir, id, "manifest.json"), "utf8");
    return JSON.parse(content) as BackupManifest;
  };

  const createBackup = async (sourcePaths: string[]): Promise<BackupManifest> => {
    await ensurePrivateDir(paths.backupsDir);

    const createdAt = now().toISOString();
    const id = toBackupId(new Date(createdAt));
    const backupDir = join(paths.backupsDir, id);
    const filesDir = join(backupDir, "files");
    await ensurePrivateDir(backupDir);
    await ensurePrivateDir(filesDir);

    const entries: BackupEntry[] = [];

    for (const sourcePath of sourcePaths) {
      try {
        const content = await readFile(sourcePath);
        const backupPath = join(filesDir, encodePath(sourcePath));
        await copyFile(sourcePath, backupPath);
        entries.push({
          sourcePath,
          backupPath,
          sha256: sha256(content),
          missing: false
        });
      } catch (error) {
        if (isMissingFileError(error)) {
          entries.push({ sourcePath, missing: true });
          continue;
        }
        throw error;
      }
    }

    const manifest: BackupManifest = {
      id,
      createdAt,
      entries
    };

    await writeFile(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    return manifest;
  };

  const listBackups = async (): Promise<BackupSummary[]> => {
    let entries: string[];
    try {
      entries = await readdir(paths.backupsDir);
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const manifests = await Promise.all(entries.map((entry) => readBackup(entry)));
    return manifests
      .map((manifest) => ({
        id: manifest.id,
        createdAt: manifest.createdAt,
        fileCount: manifest.entries.length
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };

  return {
    createBackup,
    listBackups,
    readBackup
  };
};
