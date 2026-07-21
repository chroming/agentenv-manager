import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readlink, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type { SkillCleanupResult } from "../shared/types";
import { pathEntryExists, pathExists, replacePathWithCopy, writeAtomic } from "./fileUtils";
import { markerPathForFile } from "./ownershipMarkers";

interface CleanupBackupManifest {
  id: string;
  libraryId: string;
  libraryCreated: boolean;
  libraryRemoved: boolean;
  createdAt: string;
  operation: "cleanup";
  entries: Array<{ sourcePath: string; backupPath: string }>;
}

const restoreEntries = async (manifest: CleanupBackupManifest) => {
  const failures: string[] = [];
  for (const entry of manifest.entries) {
    try {
      await replacePathWithCopy(entry.backupPath, entry.sourcePath, { dereference: false });
    } catch (error) {
      failures.push(
        `${entry.sourcePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
};

export const removeUnavailableSkillLinksTransaction = async ({
  skillKey,
  locations,
  backupRoot
}: {
  skillKey: string;
  locations: string[];
  backupRoot: string;
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
    await cp(location, backupPath, { dereference: false });
    entries.push({ sourcePath: location, backupPath });
    const markerPath = markerPathForFile(location);
    if (await pathEntryExists(markerPath)) {
      const markerBackupPath = `${backupPath}.agentenv-owner.json`;
      await cp(markerPath, markerBackupPath, { dereference: false });
      entries.push({ sourcePath: markerPath, backupPath: markerBackupPath });
    }
  }

  const manifest: CleanupBackupManifest = {
    id: backupId,
    libraryId: safeSkillKey,
    libraryCreated: false,
    libraryRemoved: false,
    createdAt: new Date().toISOString(),
    operation: "cleanup",
    entries
  };
  await writeAtomic(
    join(backupDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  try {
    for (const location of uniqueLocations) {
      if (await readlink(location) !== reviewedLinks.get(location)) {
        throw new Error(`Unavailable Skill link changed after review: ${location}`);
      }
      await rm(location, { force: true });
      await rm(markerPathForFile(location), { force: true });
      if (await pathEntryExists(location)) {
        throw new Error(`Unavailable Skill link could not be removed: ${location}`);
      }
    }
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
      await restoreEntries(manifest);
    } catch (rollbackError) {
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
