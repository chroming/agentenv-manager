import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type {
  BackupEntry,
  BackupManifest,
  BackupSummary
} from "../shared/types";
import type { AgentEnvPaths } from "./paths";
import { pathEntryExists, syncParentDirectory, writeAtomic } from "./fileUtils";
import { SafeIdSchema } from "../shared/schemas";
import {
  copyPathVerified,
  hashPathEntry,
  hashSymlinkTarget,
  syncPathTree
} from "./filesystemIntegrity";

export interface BackupStoreOptions {
  copyPath?: typeof copyPathVerified;
  now?: () => Date;
  platform?: NodeJS.Platform;
}

export interface BackupStore {
  createBackup(
    sourcePaths: string[],
    context?: Pick<BackupManifest, "operation" | "targetId" | "targetIds" | "profileId" | "profileName">
  ): Promise<BackupManifest>;
  listBackups(): Promise<BackupSummary[]>;
  readBackup(id: string): Promise<BackupManifest>;
  deleteBackup(id: string): Promise<void>;
}

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const toBackupId = (date: Date) => date.toISOString().replace(/[:.]/g, "-");

const isActivationBackupId = (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?$/.test(value);

const encodePath = (sourcePath: string): string =>
  Buffer.from(sourcePath).toString("base64url");

const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const ensurePrivateDir = async (path: string, platform: NodeJS.Platform) => {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (platform !== "win32") await chmod(path, 0o700);
};

export const createBackupStore = (
  paths: AgentEnvPaths,
  options: BackupStoreOptions = {}
): BackupStore => {
  const now = options.now ?? (() => new Date());
  const platform = options.platform ?? process.platform;
  const copyPath = options.copyPath ?? copyPathVerified;
  const invalidBackupWarnings = new Set<string>();

  const readBackup = async (id: string): Promise<BackupManifest> => {
    const safeId = SafeIdSchema.parse(id);
    const backupDir = join(paths.backupsDir, safeId);
    const backupStats = await lstat(backupDir);
    if (!backupStats.isDirectory() || backupStats.isSymbolicLink()) {
      throw new Error(`Invalid AgentEnv backup directory: ${safeId}`);
    }
    const filesDir = join(backupDir, "files");
    const filesStats = await lstat(filesDir);
    if (!filesStats.isDirectory() || filesStats.isSymbolicLink()) {
      throw new Error(`Invalid AgentEnv backup files directory: ${safeId}`);
    }
    const manifestPath = join(backupDir, "manifest.json");
    const manifestStats = await lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
      throw new Error(`Invalid AgentEnv backup manifest file: ${safeId}`);
    }
    const content = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(content) as Omit<BackupManifest, "formatVersion"> & {
      formatVersion?: unknown;
    };
    const legacy = manifest.formatVersion === undefined || manifest.formatVersion === 1;
    if (!legacy && manifest.formatVersion !== 2) {
      throw new Error(`Invalid AgentEnv backup manifest: ${safeId}`);
    }
    if (!legacy) {
      const receiptPath = join(backupDir, "manifest.sha256");
      const receiptStats = await lstat(receiptPath);
      if (!receiptStats.isFile() || receiptStats.isSymbolicLink()) {
        throw new Error(`Invalid AgentEnv backup manifest receipt: ${safeId}`);
      }
      const manifestHash = (await readFile(receiptPath, "utf8")).trim();
      if (!isSha256(manifestHash) || manifestHash !== sha256(content)) {
        throw new Error(`AgentEnv backup manifest failed its integrity check: ${safeId}`);
      }
    }
    if (
      manifest.id !== safeId ||
      typeof manifest.createdAt !== "string" ||
      !Array.isArray(manifest.entries)
    ) {
      throw new Error(`Invalid AgentEnv backup manifest: ${safeId}`);
    }
    if (manifest.targetId) SafeIdSchema.parse(manifest.targetId);
    if (manifest.profileId) SafeIdSchema.parse(manifest.profileId);
    for (const targetId of manifest.targetIds ?? []) SafeIdSchema.parse(targetId);
    const normalizedEntries: BackupEntry[] = [];
    for (const entry of manifest.entries) {
      if (!entry || typeof entry.sourcePath !== "string" || !isAbsolute(entry.sourcePath)) {
        throw new Error(`Invalid AgentEnv backup source path: ${safeId}`);
      }
      if (entry.missing) {
        if (entry.backupPath !== undefined) {
          throw new Error(`Invalid missing-file backup entry: ${safeId}`);
        }
        normalizedEntries.push(entry);
        continue;
      }
      if (
        entry.kind === "symlink" &&
        typeof entry.linkTarget === "string"
      ) {
        const linkHash = hashSymlinkTarget(entry.linkTarget);
        if (
          entry.backupPath !== undefined ||
          (entry.linkType !== undefined &&
            !["file", "dir", "junction"].includes(entry.linkType)) ||
          (!legacy && (!isSha256(entry.sha256) || entry.sha256 !== linkHash)) ||
          (legacy && isSha256(entry.sha256) && entry.sha256 !== linkHash)
        ) {
          throw new Error(`Invalid AgentEnv backup link entry: ${safeId}`);
        }
        normalizedEntries.push({ ...entry, sha256: linkHash });
        continue;
      }
      const encodedSourcePath = encodePath(entry.sourcePath);
      const expectedBackupPath = resolve(filesDir, encodedSourcePath);
      const recordedBackupPath =
        typeof entry.backupPath === "string" && isAbsolute(entry.backupPath)
          ? resolve(entry.backupPath)
          : undefined;
      if (
        (entry.kind !== "file" && entry.kind !== "directory" && entry.kind !== "symlink") ||
        !recordedBackupPath ||
        basename(recordedBackupPath) !== encodedSourcePath ||
        basename(dirname(recordedBackupPath)) !== "files" ||
        basename(dirname(dirname(recordedBackupPath))) !== safeId
      ) {
        throw new Error(`Invalid AgentEnv backup file mapping: ${safeId}`);
      }
      const backupStats = await lstat(expectedBackupPath);
      if (
        (entry.kind === "file" && !backupStats.isFile()) ||
        (entry.kind === "directory" && !backupStats.isDirectory()) ||
        (entry.kind === "symlink" && !backupStats.isSymbolicLink())
      ) {
        throw new Error(`AgentEnv backup content does not match its manifest: ${safeId}`);
      }
      const contentHash = await hashPathEntry(expectedBackupPath);
      if (
        !contentHash ||
        (!legacy && (!isSha256(entry.sha256) || contentHash !== entry.sha256)) ||
        (legacy &&
          isSha256(entry.sha256) &&
          ((entry.kind === "file" &&
            sha256(await readFile(expectedBackupPath)) !== entry.sha256) ||
            (entry.kind !== "file" && contentHash !== entry.sha256)))
      ) {
        throw new Error(`AgentEnv backup payload failed its integrity check: ${safeId}`);
      }
      const mode =
        entry.kind === "symlink"
          ? undefined
          : typeof entry.mode === "number" && Number.isInteger(entry.mode)
            ? entry.mode & 0o777
            : backupStats.mode & 0o777;
      normalizedEntries.push({
        ...entry,
        backupPath: expectedBackupPath,
        sha256: contentHash,
        mode
      });
    }
    return { ...manifest, formatVersion: 2, entries: normalizedEntries };
  };

  const createBackup = async (
    sourcePaths: string[],
    context: Pick<BackupManifest, "operation" | "targetId" | "targetIds" | "profileId" | "profileName"> = {}
  ): Promise<BackupManifest> => {
    await ensurePrivateDir(paths.backupsDir, platform);
    const uniqueSourcePaths = [...new Set(sourcePaths.map((path) => resolve(path)))];

    const createdAt = now().toISOString();
    const baseId = toBackupId(new Date(createdAt));
    let id = baseId;
    let backupDir = join(paths.backupsDir, id);
    for (let suffix = 1; await pathEntryExists(backupDir); suffix += 1) {
        id = `${baseId}-${suffix}`;
        backupDir = join(paths.backupsDir, id);
    }
    const stagingDir = join(paths.backupsDir, `.agentenv-backup-stage-${randomUUID()}`);
    const stagingFilesDir = join(stagingDir, "files");
    await ensurePrivateDir(stagingFilesDir, platform);
    let committed = false;
    try {
      const entries: BackupEntry[] = [];
      for (const sourcePath of uniqueSourcePaths) {
        let sourceStats;
        try {
          sourceStats = await lstat(sourcePath);
        } catch (error) {
          if (isMissingFileError(error)) {
            entries.push({ sourcePath, missing: true });
            continue;
          }
          throw error;
        }
        const encodedSourcePath = encodePath(sourcePath);
        const stagingBackupPath = join(stagingFilesDir, encodedSourcePath);
        const backupPath = join(backupDir, "files", encodedSourcePath);

        if (sourceStats.isSymbolicLink()) {
          const linkTarget = await readlink(sourcePath);
          const linkType = await stat(sourcePath)
            .then((targetStats) =>
              targetStats.isDirectory()
                ? platform === "win32"
                  ? "junction" as const
                  : "dir" as const
                : "file" as const
            )
            .catch(() =>
              platform === "win32" ? "junction" as const : "dir" as const
            );
          if (await readlink(sourcePath) !== linkTarget) {
            throw new Error(`Symbolic link changed while its backup was being created: ${sourcePath}`);
          }
          entries.push({
            sourcePath,
            linkTarget,
            linkType,
            sha256: hashSymlinkTarget(linkTarget),
            missing: false,
            kind: "symlink"
          });
        } else if (sourceStats.isDirectory() || sourceStats.isFile()) {
          const contentHash = await copyPath(sourcePath, stagingBackupPath, {
            platform,
            recursive: sourceStats.isDirectory()
          });
          entries.push({
            sourcePath,
            backupPath,
            sha256: contentHash,
            mode: sourceStats.mode & 0o777,
            missing: false,
            kind: sourceStats.isDirectory() ? "directory" : "file"
          });
        } else {
          throw new Error(`Unsupported filesystem entry in AgentEnv backup: ${sourcePath}`);
        }
      }

      const manifest: BackupManifest = {
        formatVersion: 2,
        id,
        createdAt,
        ...context,
        entries
      };
      const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeAtomic(join(stagingDir, "manifest.json"), manifestContent);
      await writeAtomic(join(stagingDir, "manifest.sha256"), `${sha256(manifestContent)}\n`);
      await syncPathTree(stagingDir, platform);
      await rename(stagingDir, backupDir);
      committed = true;
      await syncParentDirectory(paths.backupsDir, { platform });
      return await readBackup(id);
    } catch (error) {
      await rm(committed ? backupDir : stagingDir, { recursive: true, force: true }).catch(
        () => undefined
      );
      throw error;
    }
  };

  const listBackups = async (): Promise<BackupSummary[]> => {
    let entries: Dirent[];
    try {
      entries = await readdir(paths.backupsDir, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const manifests = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && isActivationBackupId(entry.name))
          .map(async (entry) => {
            try {
              if (!SafeIdSchema.safeParse(entry.name).success) {
                return undefined;
              }
              return await readBackup(entry.name);
            } catch (error) {
              if (
                isMissingFileError(error) &&
                !(await pathEntryExists(join(paths.backupsDir, entry.name)))
              ) {
                return undefined;
              }
              const warning = `${entry.name}: ${errorMessage(error)}`;
              if (!invalidBackupWarnings.has(warning)) {
                invalidBackupWarnings.add(warning);
                console.warn(`[AgentEnv] Ignoring invalid backup ${warning}`);
              }
              return undefined;
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

  const deleteBackup = async (id: string): Promise<void> => {
    const safeId = SafeIdSchema.parse(id);
    await readBackup(safeId);
    await rm(join(paths.backupsDir, safeId), { recursive: true, force: true });
  };

  return {
    createBackup,
    listBackups,
    readBackup,
    deleteBackup
  };
};
