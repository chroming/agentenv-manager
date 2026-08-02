import { randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type { BackupEntry, BackupManifest, SkillCleanupResult } from "../shared/types";
import { pathEntryExists, pathExists, writeAtomic } from "./fileUtils";
import type { BackupStore } from "./backupStore";
import { restoreBackupWithSafety } from "./backupRestore";
import { markerPathForFile } from "./ownershipMarkers";
import { copyPathVerified, hashPathEntry, syncPathTree } from "./filesystemIntegrity";

interface CleanupBackupManifest {
  formatVersion: 2;
  id: string;
  libraryId: string;
  libraryCreated: boolean;
  libraryRemoved: boolean;
  createdAt: string;
  operation: "cleanup";
  status: "prepared" | "complete" | "rolled-back" | "recovery-required";
  recoveryError?: string;
  expectedPaths: Array<{ path: string; sha256?: string }>;
  entries: Array<{ sourcePath: string; backupPath: string; sha256: string }>;
}

const writeManifest = async (backupDir: string, manifest: CleanupBackupManifest) => {
  await writeAtomic(
    join(backupDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  await syncPathTree(backupDir);
};

const asManagedBackup = async (
  manifest: CleanupBackupManifest,
  selectedPaths: Iterable<string>
): Promise<BackupManifest> => {
  const selected = selectedPaths
    ? new Set([...selectedPaths].map((path) => resolve(path)))
    : new Set<string>();
  const payloads = new Map(
    manifest.entries.map((entry) => [resolve(entry.sourcePath), entry.backupPath])
  );
  const entries: BackupEntry[] = [];
  for (const expected of manifest.expectedPaths) {
    const sourcePath = resolve(expected.path);
    if (!selected.has(sourcePath)) continue;
    if (expected.sha256 === undefined) {
      entries.push({ sourcePath, missing: true });
      continue;
    }
    const backupPath = payloads.get(sourcePath);
    if (!backupPath) throw new Error(`Cleanup backup has no payload for ${sourcePath}`);
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
    } else {
      entries.push({
        sourcePath,
        backupPath,
        sha256: expected.sha256,
        mode: stats.mode & 0o777,
        missing: false,
        kind: stats.isDirectory() ? "directory" : "file"
      });
    }
  }
  return {
    formatVersion: 2,
    id: manifest.id,
    createdAt: manifest.createdAt,
    operation: "rollback-safety",
    profileName: `${manifest.libraryId} unavailable-link recovery`,
    entries
  };
};

export const removeUnavailableSkillLinksTransaction = async ({
  skillKey,
  locations,
  backupRoot,
  backupStore
}: {
  skillKey: string;
  locations: string[];
  backupRoot: string;
  backupStore: Pick<BackupStore, "createBackup">;
}): Promise<SkillCleanupResult> => {
  const safeSkillKey = SafeIdSchema.parse(skillKey);
  const uniqueLocations = [...new Set(locations)];
  if (uniqueLocations.length === 0) {
    throw new Error("Unavailable Skill cleanup requires at least one reviewed link");
  }

  const reviewedLinks = new Map<string, string>();
  for (const location of uniqueLocations) {
    const stats = await lstat(location);
    if (!stats.isSymbolicLink()) {
      throw new Error(`Unavailable Skill path is no longer a symbolic link: ${location}`);
    }
    const linkTarget = await readlink(location);
    if (await pathExists(resolve(dirname(location), linkTarget))) {
      throw new Error(`Unavailable Skill link is available again: ${location}`);
    }
    reviewedLinks.set(location, linkTarget);
  }

  const backupId = `cleanup-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const backupDir = join(backupRoot, backupId);
  const entries: CleanupBackupManifest["entries"] = [];
  await mkdir(backupDir, { recursive: true });

  for (const [index, location] of uniqueLocations.entries()) {
    const backupPath = join(backupDir, "locations", `${index}-${basename(location)}`);
    await mkdir(dirname(backupPath), { recursive: true });
    const sha256 = await copyPathVerified(location, backupPath, {
      dereference: false,
      recursive: false
    });
    entries.push({ sourcePath: location, backupPath, sha256 });
    const markerPath = markerPathForFile(location);
    if (await pathEntryExists(markerPath)) {
      const markerBackupPath = `${backupPath}.agentenv-owner.json`;
      const markerHash = await copyPathVerified(markerPath, markerBackupPath, {
        dereference: false,
        recursive: false
      });
      entries.push({ sourcePath: markerPath, backupPath: markerBackupPath, sha256: markerHash });
    }
  }

  const manifest: CleanupBackupManifest = {
    formatVersion: 2,
    id: backupId,
    libraryId: safeSkillKey,
    libraryCreated: false,
    libraryRemoved: false,
    createdAt: new Date().toISOString(),
    operation: "cleanup",
    status: "prepared",
    expectedPaths: await Promise.all(
      uniqueLocations.flatMap((location) => [location, markerPathForFile(location)])
        .map(async (path) => ({ path: resolve(path), sha256: await hashPathEntry(path) }))
    ),
    entries
  };
  await writeManifest(backupDir, manifest);
  const mutatedPaths = new Set<string>();
  const mutationHashes = new Map<string, string | undefined>();

  try {
    for (const location of uniqueLocations) {
      for (const path of [location, markerPathForFile(location)]) {
        const expected = manifest.expectedPaths.find((entry) => resolve(entry.path) === resolve(path));
        if (!expected || await hashPathEntry(path) !== expected.sha256) {
          throw new Error(`Unavailable Skill path changed after backup: ${path}`);
        }
      }
      if (await readlink(location) !== reviewedLinks.get(location)) {
        throw new Error(`Unavailable Skill link changed after review: ${location}`);
      }
      await rm(location, { force: true });
      mutatedPaths.add(resolve(location));
      mutationHashes.set(resolve(location), await hashPathEntry(location));
      await rm(markerPathForFile(location), { force: true });
      mutatedPaths.add(resolve(markerPathForFile(location)));
      mutationHashes.set(
        resolve(markerPathForFile(location)),
        await hashPathEntry(markerPathForFile(location))
      );
      if (await pathEntryExists(location)) {
        throw new Error(`Unavailable Skill link could not be removed: ${location}`);
      }
    }
    manifest.status = "complete";
    await writeManifest(backupDir, manifest);
    return {
      backupId,
      libraryId: safeSkillKey,
      managedLocations: [],
      operation: "cleanup",
      libraryCreated: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const unrecordedChanges: string[] = [];
      for (const expected of manifest.expectedPaths) {
        const path = resolve(expected.path);
        if (mutationHashes.has(path)) continue;
        try {
          if (await hashPathEntry(path) !== expected.sha256) unrecordedChanges.push(path);
        } catch {
          unrecordedChanges.push(path);
        }
      }
      if (unrecordedChanges.length > 0) {
        throw new Error(
          `Automatic cleanup recovery stopped because paths changed without a completed ` +
          `write receipt: ${unrecordedChanges.join(", ")}`
        );
      }
      const rollbackBackup = await asManagedBackup(manifest, mutatedPaths);
      if (rollbackBackup.entries.length > 0) {
        await restoreBackupWithSafety({
          backup: rollbackBackup,
          backupStore,
          continueOnError: true,
          restoreSafetyOnFailure: false,
          safetyProfileName: `${safeSkillKey} before unavailable-link recovery`,
          expectedCurrentHashes: mutationHashes
        });
      }
      manifest.status = "rolled-back";
      await writeManifest(backupDir, manifest);
    } catch (rollbackError) {
      manifest.status = "recovery-required";
      manifest.recoveryError = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      await writeManifest(backupDir, manifest).catch(() => undefined);
      throw new Error(
        `Unavailable Skill cleanup ${safeSkillKey} failed: ${message}. Rollback incomplete: ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`
      );
    }
    throw new Error(
      `Unavailable Skill cleanup ${safeSkillKey} failed and was rolled back: ${message}`
    );
  }
};
