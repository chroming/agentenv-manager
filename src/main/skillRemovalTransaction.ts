import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type { SkillCleanupResult } from "../shared/types";
import { pathExists, pathEntryExists } from "./fileUtils";
import { copyPathVerified, hashPathEntry } from "./filesystemIntegrity";
import { markerPathForFile } from "./ownershipMarkers";
import { removeSkillDeployment } from "./skillDeployment";
import type { CleanupPathClaimer, SkillCleanupBackupManifest } from "./skillCleanupBackupStore";

export interface SkillRemovalReferences {
  paths: string[];
  expectedPaths: Array<{ path: string; sha256?: string }>;
  validate?(): Promise<void>;
  apply(claim: CleanupPathClaimer): Promise<void>;
}

export const createSkillRemovalTransaction = (dependencies: {
  libraryDir(): Promise<string>;
  cleanupBackupRoot(): string;
  copyCleanupEntry(entries: SkillCleanupBackupManifest["entries"], source: string, destination: string): Promise<void>;
  snapshotCleanupPaths(paths: string[]): Promise<Array<{ path: string; sha256?: string }>>;
  writeCleanupManifest(manifest: SkillCleanupBackupManifest): Promise<void>;
  createCleanupPathClaimer(manifest: SkillCleanupBackupManifest): CleanupPathClaimer;
  setCleanupStatus(manifest: SkillCleanupBackupManifest, status: "complete"): Promise<void>;
  failAfterCleanupRollback(manifest: SkillCleanupBackupManifest, context: string, error: unknown): Promise<never>;
}) => async (id: string, managedInstallPaths: string[] = [], references?: SkillRemovalReferences): Promise<SkillCleanupResult> => {
  const safeId = SafeIdSchema.parse(id), targetLibraryDir = join(await dependencies.libraryDir(), safeId);
  if (!await pathExists(join(targetLibraryDir, "SKILL.md"))) throw new Error(`Library skill does not exist: ${safeId}`);
  const verifyReviewedPaths = async () => {
    for (const expected of references?.expectedPaths ?? []) {
      if (await hashPathEntry(expected.path) !== expected.sha256) throw new Error(`Skill removal changed after preview: ${expected.path}. Review removal again.`);
    }
  };
  await verifyReviewedPaths();
  const backupId = `remove-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const backupDir = join(dependencies.cleanupBackupRoot(), backupId), libraryBackupPath = join(backupDir, "library", safeId);
  const uniqueInstallPaths = [...new Set(managedInstallPaths)];
  const protectedPaths = [...new Set([...uniqueInstallPaths.flatMap((path) => [path, markerPathForFile(path)]), ...(references?.paths ?? [])])];
  const entries: SkillCleanupBackupManifest["entries"] = [];
  await mkdir(dirname(libraryBackupPath), { recursive: true });
  const libraryBackupHash = await copyPathVerified(targetLibraryDir, libraryBackupPath, { recursive: true, dereference: false });
  for (const [index, source] of protectedPaths.entries()) {
    if (await pathEntryExists(source)) await dependencies.copyCleanupEntry(entries, source, join(backupDir, "locations", `${index}-${basename(source)}`));
  }
  await verifyReviewedPaths();
  const manifest: SkillCleanupBackupManifest = {
    formatVersion: 2, id: backupId, libraryId: safeId, libraryCreated: false, libraryRemoved: true,
    libraryBackupPath, libraryBackupHash, operation: "remove", status: "prepared", createdAt: new Date().toISOString(),
    expectedPaths: await dependencies.snapshotCleanupPaths([targetLibraryDir, ...protectedPaths]), entries
  };
  await dependencies.writeCleanupManifest(manifest);
  try {
    const claim = dependencies.createCleanupPathClaimer(manifest);
    await references?.validate?.();
    await references?.apply(claim);
    for (const path of uniqueInstallPaths) {
      await claim(path, markerPathForFile(path));
      await removeSkillDeployment(path, { allowedRoot: dirname(path) });
      await claim.recordMutation(path, markerPathForFile(path));
    }
    await claim(targetLibraryDir);
    await rm(targetLibraryDir, { recursive: true, force: true });
    await claim.recordMutation(targetLibraryDir);
    await dependencies.setCleanupStatus(manifest, "complete");
    return { backupId, libraryId: safeId, managedLocations: uniqueInstallPaths, operation: "remove" };
  } catch (error) { return dependencies.failAfterCleanupRollback(manifest, `Removing ${safeId}`, error); }
};
