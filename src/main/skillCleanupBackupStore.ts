import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readFile, readlink, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type {
  BackupEntry,
  BackupManifest,
  ManagedBackupFile,
  SkillCleanupBackupSummary,
  TargetPaths
} from "../shared/types";
import { writeAtomic } from "./fileUtils";
import { restoreBackupWithSafety } from "./backupRestore";
import { createBackupStore } from "./backupStore";
import {
  copyPathVerified,
  hashPathEntry,
  syncPathTree
} from "./filesystemIntegrity";
import type { AgentEnvPaths } from "./paths";
import { canonicalPathKey, isPathInside, pathsEqual } from "./platformPaths";

export interface SkillCleanupBackupManifest {
  formatVersion: 2;
  id: string;
  libraryId: string;
  libraryCreated: boolean;
  libraryRemoved?: boolean;
  libraryBackupPath?: string;
  createdAt: string;
  operation?: "cleanup" | "remove" | "retire" | "update" | "merge";
  status: "prepared" | "complete" | "rolled-back" | "rollback-prepared" | "restored" | "recovery-required";
  recoveryError?: string;
  safetyBackupId?: string;
  libraryBackupHash?: string;
  expectedPaths: Array<{ path: string; sha256?: string }>;
  entries: Array<{ sourcePath: string; backupPath: string; sha256: string }>;
}

interface SkillCleanupBackupStoreOptions {
  paths: AgentEnvPaths;
  resolveLibraryDir: () => Promise<string>;
  targetPathsProvider: () => TargetPaths[] | Promise<TargetPaths[]>;
}

type CleanupPathClaimer = ((...sourcePaths: string[]) => Promise<void>) & {
  readonly claimedPaths: ReadonlySet<string>;
  readonly mutationHashes: ReadonlyMap<string, string | undefined>;
  recordMutation(...sourcePaths: string[]): Promise<void>;
  findUnrecordedChanges(): Promise<string[]>;
};

export const createSkillCleanupBackupStore = ({
  paths,
  resolveLibraryDir,
  targetPathsProvider
}: SkillCleanupBackupStoreOptions) => {
  const cleanupBackupRoot = () => join(paths.backupsDir, "skill-cleanup");
  const mutationTrackerByManifest = new WeakMap<SkillCleanupBackupManifest, CleanupPathClaimer>();
  const safetyBackupStore = createBackupStore(paths);

  const writeCleanupManifest = async (manifest: SkillCleanupBackupManifest) => {
    const backupDir = join(cleanupBackupRoot(), manifest.id);
    await writeAtomic(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    await syncPathTree(backupDir);
  };

  const copyCleanupEntry = async (
    entries: SkillCleanupBackupManifest["entries"],
    sourcePath: string,
    backupPath: string
  ) => {
    await mkdir(dirname(backupPath), { recursive: true });
    const sha256 = await copyPathVerified(sourcePath, backupPath, {
      dereference: false,
      recursive: (await lstat(sourcePath)).isDirectory()
    });
    entries.push({ sourcePath, backupPath, sha256 });
  };

  const snapshotCleanupPaths = async (sourcePaths: string[]) =>
    Promise.all(
      [...new Set(sourcePaths.map((path) => resolve(path)))].map(async (path) => ({
        path,
        sha256: await hashPathEntry(path)
      }))
    );

  const createCleanupPathClaimer = (manifest: SkillCleanupBackupManifest) => {
    const expected = new Map(
      manifest.expectedPaths.map((entry) => [resolve(entry.path), entry.sha256])
    );
    const claimed = new Set<string>();
    const mutationHashes = new Map<string, string | undefined>();
    const claim = async (...sourcePaths: string[]) => {
      for (const sourcePath of sourcePaths) {
        const path = resolve(sourcePath);
        if (claimed.has(path)) continue;
        if (!expected.has(path)) {
          throw new Error(`Cleanup transaction did not preserve the path before mutation: ${path}`);
        }
        if (await hashPathEntry(path) !== expected.get(path)) {
          throw new Error(`Cleanup path changed after backup and was not modified: ${path}`);
        }
        claimed.add(path);
      }
    };
    const tracker = Object.assign(claim, {
      claimedPaths: claimed,
      mutationHashes,
      recordMutation: async (...sourcePaths: string[]) => {
        for (const sourcePath of sourcePaths) {
          const path = resolve(sourcePath);
          if (!claimed.has(path)) {
            throw new Error(`Cannot record an unclaimed cleanup mutation: ${path}`);
          }
          mutationHashes.set(path, await hashPathEntry(path));
        }
      },
      findUnrecordedChanges: async () => {
        const changed: string[] = [];
        for (const path of claimed) {
          if (mutationHashes.has(path)) continue;
          try {
            if (await hashPathEntry(path) !== expected.get(path)) changed.push(path);
          } catch {
            changed.push(path);
          }
        }
        return changed;
      }
    }) satisfies CleanupPathClaimer;
    mutationTrackerByManifest.set(manifest, tracker);
    return tracker;
  };

  const setCleanupStatus = async (
    manifest: SkillCleanupBackupManifest,
    status: SkillCleanupBackupManifest["status"],
    details: Pick<SkillCleanupBackupManifest, "recoveryError" | "safetyBackupId"> = {}
  ) => {
    manifest.status = status;
    manifest.recoveryError = details.recoveryError;
    manifest.safetyBackupId = details.safetyBackupId;
    await writeCleanupManifest(manifest);
  };

  const trustedSkillRoots = async (): Promise<string[]> => {
    const targetRoots = (await targetPathsProvider()).flatMap((target) => [
      target.skillsDir,
      ...(target.skillScanDirs ?? []),
      ...(target.skillLocations ?? []).map((location) => location.path)
    ]);
    return [
      await resolveLibraryDir(),
      paths.profilesDir,
      paths.targetStatesDir,
      paths.userSkillsDir,
      ...targetRoots
    ]
      .filter((path): path is string => Boolean(path))
      .map((path) => resolve(path))
      .filter((path, index, roots) => roots.indexOf(path) === index);
  };

  const readCleanupBackup = async (backupId: string) => {
    const safeId = SafeIdSchema.parse(backupId);
    const backupDir = join(cleanupBackupRoot(), safeId);
    const backupStats = await lstat(backupDir);
    if (!backupStats.isDirectory() || backupStats.isSymbolicLink()) {
      throw new Error(`Invalid Skill cleanup backup directory: ${safeId}`);
    }
    const manifestPath = join(backupDir, "manifest.json");
    const manifestStats = await lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
      throw new Error(`Invalid Skill cleanup backup manifest: ${safeId}`);
    }
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as SkillCleanupBackupManifest;
    const safeLibraryId = SafeIdSchema.parse(manifest.libraryId);
    if (
      manifest.formatVersion !== 2 ||
      manifest.id !== safeId ||
      !Array.isArray(manifest.entries) ||
      !Array.isArray(manifest.expectedPaths) ||
      !["prepared", "complete", "rolled-back", "rollback-prepared", "restored", "recovery-required"]
        .includes(manifest.status)
    ) {
      throw new Error(`Invalid Skill cleanup backup: ${safeId}`);
    }

    const allowedRoots = await trustedSkillRoots();
    const backupLocationsRoot = resolve(backupDir, "locations");
    if (manifest.entries.length > 0) {
      const locationsStats = await lstat(backupLocationsRoot);
      if (!locationsStats.isDirectory() || locationsStats.isSymbolicLink()) {
        throw new Error(`Invalid Skill cleanup backup payload directory: ${safeId}`);
      }
    }
    const seenBackupPaths = new Set<string>();
    const seenExpectedPaths = new Set<string>();
    for (const entry of manifest.expectedPaths) {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        (entry.sha256 !== undefined &&
          (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)))
      ) {
        throw new Error(`Invalid Skill cleanup expected path: ${safeId}`);
      }
      const sourcePath = resolve(entry.path);
      const sourceAllowed = allowedRoots.some(
        (root) => pathsEqual(dirname(sourcePath), root) && isPathInside(root, sourcePath)
      );
      const key = canonicalPathKey(sourcePath);
      if (!sourceAllowed || seenExpectedPaths.has(key)) {
        throw new Error(`Skill cleanup backup contains an unsafe expected path: ${safeId}`);
      }
      seenExpectedPaths.add(key);
    }
    for (const entry of manifest.entries) {
      if (
        !entry ||
        typeof entry.sourcePath !== "string" ||
        typeof entry.backupPath !== "string" ||
        typeof entry.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      ) {
        throw new Error(`Invalid Skill cleanup backup entry: ${safeId}`);
      }
      const sourcePath = resolve(entry.sourcePath);
      const backupPath = resolve(entry.backupPath);
      const sourceAllowed = allowedRoots.some(
        (root) => pathsEqual(dirname(sourcePath), root) && isPathInside(root, sourcePath)
      );
      const backupPathKey = canonicalPathKey(backupPath);
      const expected = manifest.expectedPaths.find((item) => pathsEqual(item.path, sourcePath));
      const backupNameMatch = basename(backupPath).match(/^\d+-(.+)$/);
      if (
        !sourceAllowed ||
        expected?.sha256 !== entry.sha256 ||
        !pathsEqual(dirname(backupPath), backupLocationsRoot) ||
        backupNameMatch?.[1] !== basename(sourcePath) ||
        seenBackupPaths.has(backupPathKey) ||
        !isPathInside(backupLocationsRoot, backupPath)
      ) {
        throw new Error(`Skill cleanup backup contains an unsafe path: ${safeId}`);
      }
      if (await hashPathEntry(backupPath) !== entry.sha256) {
        throw new Error(`Skill cleanup backup failed its integrity check: ${safeId}`);
      }
      seenBackupPaths.add(backupPathKey);
    }
    if (manifest.libraryBackupPath) {
      const libraryRoot = resolve(backupDir, "library");
      const libraryRootStats = await lstat(libraryRoot);
      if (!libraryRootStats.isDirectory() || libraryRootStats.isSymbolicLink()) {
        throw new Error(`Invalid Skill cleanup Library payload directory: ${safeId}`);
      }
      const expected = resolve(libraryRoot, safeLibraryId);
      const targetLibraryPath = resolve(await resolveLibraryDir(), safeLibraryId);
      const expectedTarget = manifest.expectedPaths.find((item) =>
        pathsEqual(item.path, targetLibraryPath)
      );
      if (!pathsEqual(manifest.libraryBackupPath, expected)) {
        throw new Error(`Skill cleanup backup contains an unsafe Library path: ${safeId}`);
      }
      if (
        typeof manifest.libraryBackupHash !== "string" ||
        await hashPathEntry(expected) !== manifest.libraryBackupHash ||
        expectedTarget?.sha256 !== manifest.libraryBackupHash
      ) {
        throw new Error(`Skill cleanup Library backup failed its integrity check: ${safeId}`);
      }
    }
    return { backupDir, manifest };
  };

  const listCleanupBackups = async (): Promise<SkillCleanupBackupSummary[]> => {
    let entries: Dirent[];
    try {
      entries = await readdir(cleanupBackupRoot(), { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const summaries = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map(async (entry): Promise<SkillCleanupBackupSummary | undefined> => {
        if (!SafeIdSchema.safeParse(entry.name).success) return undefined;
        try {
          const { manifest } = await readCleanupBackup(entry.name);
          const recoveryRequired =
            manifest.status === "prepared" ||
            manifest.status === "rollback-prepared" ||
            manifest.status === "recovery-required";
          return {
            id: manifest.id,
            libraryId: manifest.libraryId,
            createdAt: manifest.createdAt,
            locationCount: manifest.operation === "update"
              ? 1
              : manifest.entries.filter(
                  (item) => !item.sourcePath.endsWith(".agentenv-owner.json")
                ).length,
            operation: manifest.operation,
            ...(recoveryRequired ? { recoveryRequired: true } : {}),
            ...(manifest.safetyBackupId ? { safetyBackupId: manifest.safetyBackupId } : {})
          };
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return undefined;
          }
          console.warn(
            `[AgentEnv] Ignoring invalid Skill cleanup backup ${entry.name}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return undefined;
        }
      })
    );
    return summaries
      .filter((item): item is SkillCleanupBackupSummary => Boolean(item))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  };

  const previewCleanupBackup = async (id: string): Promise<ManagedBackupFile[]> => {
    const { manifest } = await readCleanupBackup(id);
    return manifest.entries
      .filter((entry) => !entry.sourcePath.endsWith(".agentenv-owner.json"))
      .map((entry) => ({
        kind: "directory" as const,
        path: entry.sourcePath,
        state: "saved" as const
      }));
  };

  const cleanupBackupAsManagedBackup = async (
    manifest: SkillCleanupBackupManifest,
    selectedPaths?: Iterable<string>
  ): Promise<BackupManifest> => {
    const selected = selectedPaths
      ? new Set([...selectedPaths].map((path) => resolve(path)))
      : undefined;
    const selectedPath = (path: string) => !selected || selected.has(resolve(path));
    const payloadBySource = new Map(
      manifest.entries.map((entry) => [resolve(entry.sourcePath), entry.backupPath])
    );
    const targetLibraryDir = join(await resolveLibraryDir(), manifest.libraryId);
    if (manifest.libraryRemoved && manifest.libraryBackupPath) {
      payloadBySource.set(resolve(targetLibraryDir), manifest.libraryBackupPath);
    }
    const entries: BackupEntry[] = [];
    for (const expected of manifest.expectedPaths) {
      if (!selectedPath(expected.path)) continue;
      const sourcePath = resolve(expected.path);
      if (expected.sha256 === undefined) {
        entries.push({ sourcePath, missing: true });
        continue;
      }
      const backupPath = payloadBySource.get(sourcePath);
      if (!backupPath) {
        throw new Error(`Cleanup backup ${manifest.id} has no payload for ${sourcePath}`);
      }
      const stats = await lstat(backupPath);
      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(backupPath);
        const linkType = await stat(backupPath)
          .then((targetStats) => targetStats.isDirectory() ? "dir" as const : "file" as const)
          .catch(() => "dir" as const);
        entries.push({
          sourcePath,
          backupPath,
          linkTarget,
          linkType,
          sha256: expected.sha256,
          missing: false,
          kind: "symlink"
        });
      } else if (stats.isDirectory() || stats.isFile()) {
        entries.push({
          sourcePath,
          backupPath,
          sha256: expected.sha256,
          mode: stats.mode & 0o777,
          missing: false,
          kind: stats.isDirectory() ? "directory" : "file"
        });
      } else {
        throw new Error(`Cleanup backup ${manifest.id} contains an unsupported payload`);
      }
    }
    return {
      formatVersion: 2,
      id: manifest.id,
      createdAt: manifest.createdAt,
      operation: "rollback-safety",
      profileName: `${manifest.libraryId} cleanup recovery`,
      entries
    };
  };

  const restoreCleanupBackupSafely = async (
    manifest: SkillCleanupBackupManifest,
    selectedPaths?: Iterable<string>,
    preparedSafetyBackup?: BackupManifest,
    expectedCurrentHashes?: ReadonlyMap<string, string | undefined>
  ) => {
    const backup = await cleanupBackupAsManagedBackup(manifest, selectedPaths);
    if (backup.entries.length === 0) return undefined;
    return restoreBackupWithSafety({
      backup,
      backupStore: safetyBackupStore,
      continueOnError: true,
      restoreSafetyOnFailure: false,
      safetyBackup: preparedSafetyBackup,
      safetyProfileName: `${manifest.libraryId} before cleanup recovery`,
      expectedCurrentHashes
    });
  };

  const failAfterCleanupRollback = async (
    manifest: SkillCleanupBackupManifest,
    label: string,
    operationError: unknown
  ): Promise<never> => {
    const operationMessage = operationError instanceof Error
      ? operationError.message
      : String(operationError);
    try {
      const tracker = mutationTrackerByManifest.get(manifest);
      const unrecordedChanges = await tracker?.findUnrecordedChanges() ?? [];
      if (unrecordedChanges.length > 0) {
        throw new Error(
          `Automatic cleanup recovery stopped because these paths changed without a completed ` +
          `write receipt: ${unrecordedChanges.join(", ")}`
        );
      }
      await restoreCleanupBackupSafely(
        manifest,
        tracker?.mutationHashes.keys() ?? [],
        undefined,
        tracker?.mutationHashes
      );
      await setCleanupStatus(manifest, "rolled-back");
    } catch (rollbackError) {
      const recoveryError = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      await setCleanupStatus(manifest, "recovery-required", { recoveryError }).catch(
        () => undefined
      );
      throw new Error(
        `${label} failed: ${operationMessage}. Rollback incomplete: ${recoveryError}`
      );
    }
    throw new Error(`${label} failed and was rolled back: ${operationMessage}`);
  };

  return {
    cleanupBackupRoot,
    writeCleanupManifest,
    copyCleanupEntry,
    snapshotCleanupPaths,
    createCleanupPathClaimer,
    setCleanupStatus,
    readCleanupBackup,
    listCleanupBackups,
    previewCleanupBackup,
    restoreCleanupBackupSafely,
    failAfterCleanupRollback
  };
};
