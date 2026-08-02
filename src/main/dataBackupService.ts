import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentEnvPaths } from "./paths";
import {
  pathEntryExists,
  replacePathAtomically,
  syncParentDirectory,
  writeAtomic
} from "./fileUtils";
import { ensureAppDataFormat } from "./appDataFormat";
import { validateAppDataRoot } from "./appDataValidation";
import { isPathInside, pathsEqual } from "./platformPaths";
import {
  copyPathVerified,
  hashPathEntry,
  hashRequiredPathEntry,
  syncPathTree
} from "./filesystemIntegrity";

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

interface DataBackupLink {
  path: string;
  target: string;
  type: "file" | "dir" | "junction";
}

interface DataBackupManifestV1 {
  formatVersion: 1;
  createdAt: string;
  sourceDirectoryName?: string;
}

interface DataBackupManifestV2 {
  formatVersion: 2;
  createdAt: string;
  sourceDirectoryName: string;
  payloadHash: string;
  sourceTreeHash: string;
  links: DataBackupLink[];
}

type DataBackupManifest = DataBackupManifestV1 | DataBackupManifestV2;

const backupName = (createdAt: string) =>
  `AgentEnv-Backup-${createdAt.replace(/[:.]/g, "-")}`;

const portableRelative = (root: string, path: string) =>
  relative(root, path).split(sep).join("/");

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const payloadHash = async (dataPath: string, links: DataBackupLink[]) =>
  sha256(`${await hashRequiredPathEntry(dataPath)}\0${JSON.stringify(links)}`);

const validateLinks = (value: unknown): DataBackupLink[] => {
  if (!Array.isArray(value)) throw new Error("Unsupported or invalid AgentEnv backup");
  const seen = new Set<string>();
  const links = value.map((entry): DataBackupLink => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("path" in entry) ||
      typeof entry.path !== "string" ||
      !("target" in entry) ||
      typeof entry.target !== "string" ||
      !("type" in entry) ||
      !["file", "dir", "junction"].includes(String(entry.type))
    ) {
      throw new Error("Unsupported or invalid AgentEnv backup");
    }
    const normalized = String(entry.path).replace(/\\/g, "/");
    if (
      !normalized ||
      normalized === "." ||
      isAbsolute(normalized) ||
      /^[a-zA-Z]:\//.test(normalized) ||
      normalized.startsWith("//") ||
      normalized.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
      seen.has(normalized)
    ) {
      throw new Error("AgentEnv backup contains an unsafe symbolic-link path");
    }
    seen.add(normalized);
    return {
      path: normalized,
      target: entry.target,
      type: entry.type as DataBackupLink["type"]
    };
  });
  for (const link of links) {
    if ([...seen].some((candidate) => candidate !== link.path && candidate.startsWith(`${link.path}/`))) {
      throw new Error("AgentEnv backup contains nested symbolic-link paths");
    }
  }
  return links.sort((left, right) => left.path.localeCompare(right.path));
};

const readDataBackupManifest = async (path: string): Promise<DataBackupManifest> => {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(await readFile(join(path, "agentenv-backup.json"), "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Unsupported or invalid AgentEnv backup");
  }
  if (typeof value.createdAt !== "string") {
    throw new Error("Unsupported or invalid AgentEnv backup");
  }
  if (value.formatVersion === 1) {
    return { formatVersion: 1, createdAt: value.createdAt };
  }
  if (
    value.formatVersion !== 2 ||
    typeof value.sourceDirectoryName !== "string" ||
    typeof value.payloadHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.payloadHash) ||
    typeof value.sourceTreeHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceTreeHash)
  ) {
    throw new Error("Unsupported or invalid AgentEnv backup");
  }
  return {
    formatVersion: 2,
    createdAt: value.createdAt,
    sourceDirectoryName: value.sourceDirectoryName,
    payloadHash: value.payloadHash,
    sourceTreeHash: value.sourceTreeHash,
    links: validateLinks(value.links)
  };
};

const copyDataWithoutLinks = async (
  sourceRoot: string,
  destinationRoot: string
): Promise<DataBackupLink[]> => {
  const links: DataBackupLink[] = [];
  const walk = async (sourcePath: string, destinationPath: string): Promise<void> => {
    const stats = await lstat(sourcePath);
    if (stats.isSymbolicLink()) {
      const target = await readlink(sourcePath);
      const type = await stat(sourcePath)
        .then((targetStats) => targetStats.isDirectory()
          ? process.platform === "win32" ? "junction" as const : "dir" as const
          : "file" as const)
        .catch(() => process.platform === "win32" ? "junction" as const : "dir" as const);
      links.push({ path: portableRelative(sourceRoot, sourcePath), target, type });
      return;
    }
    if (stats.isDirectory()) {
      await mkdir(destinationPath, { recursive: true, mode: stats.mode & 0o777 });
      if (process.platform !== "win32") await chmod(destinationPath, stats.mode & 0o777);
      const entries = await readdir(sourcePath);
      entries.sort();
      for (const entry of entries) {
        await walk(join(sourcePath, entry), join(destinationPath, entry));
      }
      return;
    }
    if (!stats.isFile()) {
      throw new Error(`Unsupported filesystem entry in AgentEnv data: ${sourcePath}`);
    }
    await copyPathVerified(sourcePath, destinationPath, { recursive: false });
    if (process.platform !== "win32") await chmod(destinationPath, stats.mode & 0o777);
  };
  await walk(sourceRoot, destinationRoot);
  return validateLinks(links);
};

export const createDataBackup = async (
  paths: AgentEnvPaths,
  destinationRoot: string
): Promise<DataBackupResult> => {
  await ensureAppDataFormat(paths);
  const [activeData, destinationRootPath] = await Promise.all([
    realpath(paths.appDataRoot),
    realpath(destinationRoot)
  ]);
  const destinationStats = await lstat(destinationRootPath);
  if (!destinationStats.isDirectory() || destinationStats.isSymbolicLink()) {
    throw new Error("Choose a real directory for AgentEnv backups");
  }
  if (
    pathsEqual(destinationRootPath, activeData) ||
    isPathInside(activeData, destinationRootPath)
  ) {
    throw new Error("Store AgentEnv backups outside the active data directory");
  }

  const createdAt = new Date().toISOString();
  let destination = join(destinationRootPath, backupName(createdAt));
  if (await pathEntryExists(destination)) destination = `${destination}-${randomUUID().slice(0, 8)}`;
  const staging = join(destinationRootPath, `.agentenv-data-backup-stage-${randomUUID()}`);
  let committed = false;
  try {
    await mkdir(staging, { mode: 0o700 });
    const sourceTreeHash = await hashRequiredPathEntry(activeData);
    const dataPath = join(staging, "data");
    const links = await copyDataWithoutLinks(activeData, dataPath);
    if (await hashPathEntry(activeData) !== sourceTreeHash) {
      throw new Error("AgentEnv data changed while its backup was being created; retry");
    }
    const manifest: DataBackupManifestV2 = {
      formatVersion: 2,
      createdAt,
      sourceDirectoryName: basename(activeData),
      payloadHash: await payloadHash(dataPath, links),
      sourceTreeHash,
      links
    };
    await writeAtomic(
      join(staging, "agentenv-backup.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    await syncPathTree(staging);
    await rename(staging, destination);
    committed = true;
    await syncParentDirectory(destinationRootPath);
    await inspectDataBackup(destination);
    return { path: destination, createdAt };
  } catch (error) {
    await rm(committed ? destination : staging, { recursive: true, force: true }).catch(
      () => undefined
    );
    throw error;
  }
};

const rejectLinks = async (path: string): Promise<void> => {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error("AgentEnv backup payload cannot contain live symbolic links");
    }
    if (stats.isDirectory()) await rejectLinks(entryPath);
  }
};

const validateLegacyPayloadLinks = async (
  root: string,
  path: string = root
): Promise<void> => {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      const target = await readlink(entryPath);
      const resolvedTarget = resolve(dirname(entryPath), target);
      if (
        isAbsolute(target) ||
        /^[a-zA-Z]:[\\/]/.test(target) ||
        target.startsWith("\\\\") ||
        (!pathsEqual(root, resolvedTarget) && !isPathInside(root, resolvedTarget))
      ) {
        throw new Error("AgentEnv backup payload cannot contain live symbolic links outside its data directory");
      }
      continue;
    }
    if (stats.isDirectory()) await validateLegacyPayloadLinks(root, entryPath);
  }
};

interface DataBackupValidationOptions {
  validate?: (appDataRoot: string) => Promise<void>;
}

export const inspectDataBackup = async (
  path: string,
  options: DataBackupValidationOptions = {}
): Promise<DataRestorePreview> => {
  const backupPath = await realpath(path).catch(() => resolve(path));
  const manifest = await readDataBackupManifest(backupPath);
  const dataPath = join(backupPath, "data");
  const dataStats = await lstat(dataPath).catch(() => undefined);
  if (!dataStats?.isDirectory() || dataStats.isSymbolicLink()) {
    throw new Error("Unsupported or invalid AgentEnv backup");
  }
  if (manifest.formatVersion === 2) {
    await rejectLinks(dataPath);
    if (await payloadHash(dataPath, manifest.links) !== manifest.payloadHash) {
      throw new Error("AgentEnv backup payload failed its integrity check");
    }
  } else {
    await validateLegacyPayloadLinks(dataPath);
  }
  await (options.validate ?? validateAppDataRoot)(dataPath);
  const entries = await readdir(dataPath);
  return {
    path: backupPath,
    createdAt: manifest.createdAt,
    formatVersion: manifest.formatVersion,
    topLevelItemCount: entries.length
  };
};

const materializeDataBackup = async (
  backupPath: string,
  destinationPath: string,
  validate: (appDataRoot: string) => Promise<void>
) => {
  const manifest = await readDataBackupManifest(backupPath);
  await copyPathVerified(join(backupPath, "data"), destinationPath);
  if (manifest.formatVersion === 2) {
    for (const link of manifest.links) {
      const targetPath = resolve(destinationPath, ...link.path.split("/"));
      if (!isPathInside(destinationPath, targetPath)) {
        throw new Error("AgentEnv backup contains an unsafe symbolic-link path");
      }
      await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
      await symlink(link.target, targetPath, link.type);
    }
    if (await hashPathEntry(destinationPath) !== manifest.sourceTreeHash) {
      throw new Error("Materialized AgentEnv data does not match the exported source tree");
    }
  }
  await ensureAppDataFormat({ appDataRoot: destinationPath });
  await validate(destinationPath);
  await syncPathTree(destinationPath);
};

const replaceActiveData = async (
  paths: AgentEnvPaths,
  activeDataRoot: string,
  backupPath: string,
  validate: (appDataRoot: string) => Promise<void>,
  expectedTargetHash: string,
  onCommitted?: (contentHash: string) => void
) => {
  const committedHash = await replacePathAtomically(
    activeDataRoot,
    (stagingPath) => materializeDataBackup(backupPath, stagingPath, validate),
    { expectedTargetHash }
  );
  onCommitted?.(committedHash);
  if (process.platform !== "win32") await chmod(activeDataRoot, 0o700);
  await ensureAppDataFormat(paths);
  await validate(activeDataRoot);
};

export const restoreDataBackup = async (
  paths: AgentEnvPaths,
  backupPath: string,
  options: DataBackupValidationOptions = {}
): Promise<{ safetyBackupPath: string }> => {
  const validate = options.validate ?? validateAppDataRoot;
  const [activeData, canonicalBackup] = await Promise.all([
    realpath(paths.appDataRoot),
    realpath(backupPath)
  ]);
  if (
    pathsEqual(canonicalBackup, activeData) ||
    isPathInside(activeData, canonicalBackup)
  ) {
    throw new Error("Choose a backup stored outside the active AgentEnv data directory");
  }
  await inspectDataBackup(canonicalBackup, { validate });
  const safetyRoot = join(dirname(paths.appDataRoot), "agentenv-import-safety");
  await mkdir(safetyRoot, { recursive: true, mode: 0o700 });
  const safetyBackup = await createDataBackup(paths, safetyRoot);
  const expectedCurrentHash = await hashRequiredPathEntry(activeData);
  let installedHash: string | undefined;
  try {
    await replaceActiveData(
      paths,
      activeData,
      canonicalBackup,
      validate,
      expectedCurrentHash,
      (contentHash) => {
        installedHash = contentHash;
      }
    );
  } catch (error) {
    if (!installedHash) {
      throw new Error(
        `Data restore stopped before AgentEnv committed replacement data. ` +
        `The active data was left in place and the verified safety backup remains at ${safetyBackup.path}. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (await hashPathEntry(activeData) !== installedHash) {
      throw new Error(
        `Data restore failed after replacement, but the active data changed again before recovery. ` +
        `Automatic recovery was not attempted. The previous snapshot remains at ${safetyBackup.path}. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    try {
      await replaceActiveData(
        paths,
        activeData,
        safetyBackup.path,
        validate,
        installedHash
      );
    } catch (rollbackError) {
      throw new Error(
        `Data restore failed and automatic recovery also failed. Current data remains preserved in ${safetyBackup.path}. Restore error: ${
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
