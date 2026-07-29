import type { BackupStore } from "./backupStore";
import type {
  BackupManifest,
  SkillCleanupBackupSummary
} from "../shared/types";

interface RollbackSharedSkillMigrationInput {
  backupStore: BackupStore;
  backupId: string;
  claimTargets(targetIds: string[]): Promise<void>;
  releaseTargets(targetIds: string[]): void;
  restoreBackup(backup: BackupManifest): Promise<void>;
  appendHistory(entry: {
    type: "rollback-shared-skill-migration";
    backupId: string;
    targetIds: string[];
  }): Promise<void>;
}

export const listSharedSkillMigrationBackupSummaries = async (
  backupStore: BackupStore
): Promise<SkillCleanupBackupSummary[]> =>
  (await backupStore.listBackups())
    .filter((backup) => backup.operation === "shared-skill-migration")
    .map((backup) => ({
      id: backup.id,
      libraryId: backup.profileName ?? "shared-skill",
      createdAt: backup.createdAt,
      locationCount: backup.fileCount,
      operation: "retire" as const
    }));

export const rollbackSharedSkillMigrationBackup = async ({
  backupStore,
  backupId,
  claimTargets,
  releaseTargets,
  restoreBackup,
  appendHistory
}: RollbackSharedSkillMigrationInput): Promise<void> => {
  const backup = await backupStore.readBackup(backupId);
  if (backup.operation !== "shared-skill-migration") {
    throw new Error(`Backup is not a shared Skill migration: ${backupId}`);
  }
  const targetIds = backup.targetIds ?? [];
  await claimTargets(targetIds);
  try {
    await restoreBackup(backup);
    await appendHistory({
      type: "rollback-shared-skill-migration",
      backupId,
      targetIds
    });
  } finally {
    releaseTargets(targetIds);
  }
};
