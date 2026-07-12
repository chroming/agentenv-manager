import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  symlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
  BackupEntry,
  BackupManifest,
  BackupSummary
} from "../shared/types";
import type { AgentEnvPaths } from "./paths";
import { writeAtomic } from "./fileUtils";
import { SafeIdSchema } from "../shared/schemas";

export interface BackupStoreOptions {
  now?: () => Date;
}

export interface BackupStore {
  createBackup(
    sourcePaths: string[],
    context?: Pick<BackupManifest, "operation" | "targetId" | "targetIds" | "profileId" | "profileName">
  ): Promise<BackupManifest>;
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
    const safeId = SafeIdSchema.parse(id);
    const backupDir = join(paths.backupsDir, safeId);
    const content = await readFile(join(backupDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(content) as BackupManifest;
    if (manifest.id !== safeId || !Array.isArray(manifest.entries)) {
      throw new Error(`Invalid AgentEnv backup manifest: ${safeId}`);
    }
    if (manifest.targetId) SafeIdSchema.parse(manifest.targetId);
    if (manifest.profileId) SafeIdSchema.parse(manifest.profileId);
    for (const targetId of manifest.targetIds ?? []) SafeIdSchema.parse(targetId);
    for (const entry of manifest.entries) {
      if (!entry || typeof entry.sourcePath !== "string" || !isAbsolute(entry.sourcePath)) {
        throw new Error(`Invalid AgentEnv backup source path: ${safeId}`);
      }
      if (entry.missing) {
        if (entry.backupPath !== undefined) {
          throw new Error(`Invalid missing-file backup entry: ${safeId}`);
        }
        continue;
      }
      const expectedBackupPath = resolve(backupDir, "files", encodePath(entry.sourcePath));
      if (
        (entry.kind !== "file" && entry.kind !== "directory" && entry.kind !== "symlink") ||
        !entry.backupPath ||
        resolve(entry.backupPath) !== expectedBackupPath
      ) {
        throw new Error(`Invalid AgentEnv backup file mapping: ${safeId}`);
      }
      const backupStats = await lstat(entry.backupPath);
      if (
        (entry.kind === "file" && !backupStats.isFile()) ||
        (entry.kind === "directory" && !backupStats.isDirectory()) ||
        (entry.kind === "symlink" && !backupStats.isSymbolicLink())
      ) {
        throw new Error(`AgentEnv backup content does not match its manifest: ${safeId}`);
      }
    }
    return manifest;
  };

  const createBackup = async (
    sourcePaths: string[],
    context: Pick<BackupManifest, "operation" | "targetId" | "targetIds" | "profileId" | "profileName"> = {}
  ): Promise<BackupManifest> => {
    await ensurePrivateDir(paths.backupsDir);

    const createdAt = now().toISOString();
    const baseId = toBackupId(new Date(createdAt));
    let id = baseId;
    let backupDir = join(paths.backupsDir, id);
    for (let suffix = 1; ; suffix += 1) {
      try {
        await mkdir(backupDir, { mode: 0o700 });
        break;
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
          throw error;
        }
        id = `${baseId}-${suffix}`;
        backupDir = join(paths.backupsDir, id);
      }
    }
    const filesDir = join(backupDir, "files");
    await ensurePrivateDir(filesDir);

    const entries: BackupEntry[] = [];

    for (const sourcePath of sourcePaths) {
      try {
        const sourceStats = await lstat(sourcePath);
        const backupPath = join(filesDir, encodePath(sourcePath));

        if (sourceStats.isSymbolicLink()) {
          await symlink(await readlink(sourcePath), backupPath);
          entries.push({
            sourcePath,
            backupPath,
            missing: false,
            kind: "symlink"
          });
        } else if (sourceStats.isDirectory()) {
          await cp(sourcePath, backupPath, { recursive: true });
          entries.push({
            sourcePath,
            backupPath,
            missing: false,
            kind: "directory"
          });
        } else {
          const content = await readFile(sourcePath);
          await copyFile(sourcePath, backupPath);
          entries.push({
            sourcePath,
            backupPath,
            sha256: sha256(content),
            missing: false,
            kind: "file"
          });
        }
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
      ...context,
      entries
    };

    await writeAtomic(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
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

    const manifests = (
      await Promise.all(
        entries.map(async (entry) => {
          try {
            return await readBackup(entry);
          } catch (error) {
            if (isMissingFileError(error)) {
              return undefined;
            }
            throw error;
          }
        })
      )
    ).filter((manifest): manifest is BackupManifest => Boolean(manifest));
    return manifests
      .map((manifest) => ({
        id: manifest.id,
        createdAt: manifest.createdAt,
        fileCount: manifest.entries.length,
        operation: manifest.operation,
        targetId: manifest.targetId,
        targetIds: manifest.targetIds,
        profileId: manifest.profileId,
        profileName: manifest.profileName
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };

  return {
    createBackup,
    listBackups,
    readBackup
  };
};
