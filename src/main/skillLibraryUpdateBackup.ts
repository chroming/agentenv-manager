import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathEntryExists } from "./fileUtils";
import { markerPathForFile } from "./ownershipMarkers";
import { copyPathVerified } from "./filesystemIntegrity";
import type { SkillCleanupBackupManifest } from "./skillCleanupBackupStore";

export const createLibraryUpdateBackup = async ({
  libraryId,
  targetLibraryDir,
  copiedInstallPaths,
  statePaths,
  cleanupBackupRoot,
  copyCleanupEntry,
  snapshotCleanupPaths,
  writeCleanupManifest
}: {
  libraryId: string;
  targetLibraryDir: string;
  copiedInstallPaths: string[];
  statePaths: string[];
  cleanupBackupRoot(): string;
  copyCleanupEntry(
    entries: SkillCleanupBackupManifest["entries"],
    sourcePath: string,
    backupPath: string
  ): Promise<void>;
  snapshotCleanupPaths(paths: string[]): Promise<SkillCleanupBackupManifest["expectedPaths"]>;
  writeCleanupManifest(manifest: SkillCleanupBackupManifest): Promise<void>;
}): Promise<SkillCleanupBackupManifest> => {
  const backupId = `update-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const backupDir = join(cleanupBackupRoot(), backupId);
  const libraryBackupPath = join(backupDir, "library", libraryId);
  await mkdir(dirname(libraryBackupPath), { recursive: true });
  const libraryBackupHash = await copyPathVerified(targetLibraryDir, libraryBackupPath, {
    recursive: true,
    dereference: false
  });
  const entries: SkillCleanupBackupManifest["entries"] = [];
  for (const [index, sourcePath] of copiedInstallPaths.entries()) {
    const backupPath = join(backupDir, "locations", `${index}-${basename(sourcePath)}`);
    await copyCleanupEntry(entries, sourcePath, backupPath);
    const sidecarPath = markerPathForFile(sourcePath);
    if (await pathEntryExists(sidecarPath)) {
      await copyCleanupEntry(entries, sidecarPath, `${backupPath}.agentenv-owner.json`);
    }
  }
  for (const [index, sourcePath] of statePaths.entries()) {
    const backupPath = join(
      backupDir,
      "locations",
      `${copiedInstallPaths.length + index}-${basename(sourcePath)}`
    );
    await copyCleanupEntry(entries, sourcePath, backupPath);
  }
  const manifest: SkillCleanupBackupManifest = {
    formatVersion: 2,
    id: backupId,
    libraryId,
    libraryCreated: false,
    libraryRemoved: true,
    libraryBackupPath,
    libraryBackupHash,
    operation: "update",
    status: "prepared",
    createdAt: new Date().toISOString(),
    expectedPaths: await snapshotCleanupPaths([
      targetLibraryDir,
      ...copiedInstallPaths.flatMap((path) => [path, markerPathForFile(path)]),
      ...statePaths
    ]),
    entries
  };
  await writeCleanupManifest(manifest);
  return manifest;
};
