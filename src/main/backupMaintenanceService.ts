import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type {
  AgentEnvSettings,
  DeleteManagedBackupInput,
  ManagedBackupFile,
  ManagedBackupCleanupResult,
  ManagedBackupInventory,
  ManagedBackupItem,
  ManagedBackupPreview,
  ManagedBackupRequiredReason,
  TargetState
} from "../shared/types";
import type { BackupStore } from "./backupStore";
import type { AgentEnvPaths } from "./paths";
import type { SkillLibraryStore } from "./skillLibraryStore";
import { SafeIdSchema } from "../shared/schemas";

export interface BackupMaintenanceServiceOptions {
  now?: () => Date;
}

export interface BackupMaintenanceService {
  listInventory(): Promise<ManagedBackupInventory>;
  previewBackup(input: DeleteManagedBackupInput): Promise<ManagedBackupPreview>;
  deleteBackup(input: DeleteManagedBackupInput): Promise<{ deletedCount: number; freedBytes: number }>;
  cleanup(): Promise<ManagedBackupCleanupResult>;
}

const isMissingFileError = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");

const directorySize = async (path: string): Promise<number> => {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    throw error;
  }
  if (!stats.isDirectory()) return stats.size;
  const entries = await readdir(path);
  const sizes = await Promise.all(entries.map((entry) => directorySize(join(path, entry))));
  return sizes.reduce((total, size) => total + size, 0);
};

const readTargetStates = async (paths: AgentEnvPaths): Promise<Array<{ targetId: string; state: TargetState }>> => {
  let entries: string[];
  try {
    entries = await readdir(paths.targetStatesDir);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const states = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map(async (entry) => {
    try {
      const state = JSON.parse(await readFile(join(paths.targetStatesDir, entry), "utf8")) as TargetState;
      return { targetId: entry.slice(0, -5), state };
    } catch (error) {
      throw new Error(
        `Cannot safely evaluate backup protections for ${entry}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }));
  return states;
};

const readRestoredCleanupBackups = async (paths: AgentEnvPaths) => {
  const root = join(paths.backupsDir, "skill-cleanup-restored");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const backups = await Promise.all(entries.map(async (entry) => {
    try {
      const id = SafeIdSchema.parse(entry);
      const manifest = JSON.parse(await readFile(join(root, id, "manifest.json"), "utf8")) as {
        createdAt?: unknown;
        libraryId?: unknown;
        operation?: unknown;
        entries?: unknown;
      };
      if (
        typeof manifest.createdAt !== "string" ||
        typeof manifest.libraryId !== "string" ||
        !Array.isArray(manifest.entries)
      ) return undefined;
      return {
        id,
        createdAt: manifest.createdAt,
        libraryId: manifest.libraryId,
        operation: manifest.operation,
        locationCount: manifest.entries.length,
        files: manifest.entries.flatMap((item): ManagedBackupFile[] => {
          if (
            !item ||
            typeof item !== "object" ||
            !("sourcePath" in item) ||
            typeof item.sourcePath !== "string" ||
            !isAbsolute(item.sourcePath) ||
            item.sourcePath.endsWith(".agentenv-owner.json")
          ) {
            return [];
          }
          return [{ kind: "directory", path: item.sourcePath, state: "saved" }];
        })
      };
    } catch {
      return undefined;
    }
  }));
  return backups.filter((backup): backup is NonNullable<typeof backup> => Boolean(backup));
};

const readWorkspaceSyncRecoveryBackupIds = async (paths: AgentEnvPaths) => {
  try {
    const journal = JSON.parse(await readFile(paths.workspaceSyncJournalPath, "utf8")) as {
      backupId?: unknown;
      safetyBackupId?: unknown;
    };
    return [journal.backupId, journal.safetyBackupId]
      .filter((id): id is string => typeof id === "string");
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw new Error("Cannot safely evaluate Workspace Sync recovery state");
  }
};

const readSkillSourceMergeRecoveryBackupIds = async (paths: AgentEnvPaths) => {
  const root = join(paths.appDataRoot, "skill-source-merge-backups");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return { ids: [] as string[], ambiguous: false };
    throw error;
  }
  const ids: string[] = [];
  let ambiguous = false;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      ambiguous = true;
      continue;
    }
    try {
      const manifest = JSON.parse(
        await readFile(join(root, entry.name, "manifest.json"), "utf8")
      ) as {
        status?: unknown;
        safetyBackupId?: unknown;
        transactionBackupId?: unknown;
      };
      if (manifest.status !== "recovery-required") continue;
      for (const value of [manifest.transactionBackupId, manifest.safetyBackupId]) {
        if (typeof value !== "string" || !SafeIdSchema.safeParse(value).success) {
          ambiguous = true;
        } else {
          ids.push(value);
        }
      }
    } catch {
      ambiguous = true;
    }
  }
  return { ids: [...new Set(ids)], ambiguous };
};

export const createBackupMaintenanceService = (
  paths: AgentEnvPaths,
  backupStore: Pick<BackupStore, "listBackups" | "readBackup" | "deleteBackup">,
  skillLibraryStore: Pick<
    SkillLibraryStore,
    "listCleanupBackups" | "previewCleanupBackup" | "deleteCleanupBackup"
  >,
  settingsStore: { readSettings(): Promise<Pick<AgentEnvSettings, "backupRetentionDays">> },
  options: BackupMaintenanceServiceOptions = {}
): BackupMaintenanceService => {
  const now = options.now ?? (() => new Date());
  let activeMutation = false;

  const listInventory = async (): Promise<ManagedBackupInventory> => {
    const [
      backups,
      cleanupBackups,
      restoredCleanupBackups,
      settings,
      targetStates,
      workspaceRecoveryBackupIds,
      skillSourceMergeRecovery
    ] = await Promise.all([
      backupStore.listBackups(),
      skillLibraryStore.listCleanupBackups(),
      readRestoredCleanupBackups(paths),
      settingsStore.readSettings(),
      readTargetStates(paths),
      readWorkspaceSyncRecoveryBackupIds(paths),
      readSkillSourceMergeRecoveryBackupIds(paths)
    ]);
    const required = new Map<string, ManagedBackupRequiredReason>();
    for (const { state } of targetStates) {
      if (state.recoveryRequired?.backupId) {
        required.set(state.recoveryRequired.backupId, "recovery-required");
      }
      if (state.recoveryRequired?.safetyBackupId) {
        required.set(state.recoveryRequired.safetyBackupId, "recovery-required");
      }
    }
    for (const backupId of workspaceRecoveryBackupIds) {
      required.set(backupId, "workspace-sync-recovery");
    }
    for (const backupId of skillSourceMergeRecovery.ids) {
      required.set(backupId, "recovery-required");
    }
    if (skillSourceMergeRecovery.ambiguous) {
      for (const backup of backups) required.set(backup.id, "recovery-required");
    }
    for (const backup of cleanupBackups) {
      if (backup.safetyBackupId) required.set(backup.safetyBackupId, "recovery-required");
    }
    for (const { targetId, state } of targetStates) {
      if (!state.activeProfileId) continue;
      const baseline = backups
        .filter((backup) =>
          (backup.targetId === targetId || backup.targetIds?.includes(targetId)) &&
          backup.operation === "apply"
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      if (baseline && !required.has(baseline.id)) required.set(baseline.id, "takeover-baseline");
    }
    const latestByTarget = new Map<string, string>();
    for (const backup of backups) {
      for (const targetId of [backup.targetId, ...(backup.targetIds ?? [])]) {
        if (targetId && !latestByTarget.has(targetId)) latestByTarget.set(targetId, backup.id);
      }
    }
    const latestIds = new Set(latestByTarget.values());
    const cutoff = settings.backupRetentionDays === null
      ? undefined
      : now().getTime() - settings.backupRetentionDays * 24 * 60 * 60 * 1000;

    const targetItems = await Promise.all(backups.map(async (backup): Promise<ManagedBackupItem> => {
      const requiredReason = required.get(backup.id);
      const isEligible = !requiredReason && !latestIds.has(backup.id) && cutoff !== undefined &&
        new Date(backup.createdAt).getTime() < cutoff;
      return {
        id: backup.id,
        kind: backup.operation === "workspace-sync" ? "workspace-sync" : "target-recovery",
        createdAt: backup.createdAt,
        sizeBytes: await directorySize(join(paths.backupsDir, backup.id)),
        fileCount: backup.fileCount,
        operation: backup.operation,
        targetId: backup.targetId,
        profileName: backup.profileName,
        cleanupStatus: requiredReason
          ? "required"
          : latestIds.has(backup.id)
            ? "retained"
            : isEligible
              ? "eligible"
              : "kept",
        requiredReason,
        deletable: !requiredReason
      };
    }));
    const cleanupItems = await Promise.all(cleanupBackups.map(async (backup): Promise<ManagedBackupItem> => {
      const requiredReason = backup.recoveryRequired ? "recovery-required" : undefined;
      const isEligible = !requiredReason && cutoff !== undefined &&
        new Date(backup.createdAt).getTime() < cutoff;
      return {
        id: backup.id,
        kind: "skill-cleanup",
        createdAt: backup.createdAt,
        sizeBytes: await directorySize(join(paths.backupsDir, "skill-cleanup", backup.id)),
        fileCount: backup.locationCount,
        operation: backup.operation,
        libraryId: backup.libraryId,
        cleanupStatus: requiredReason ? "required" : isEligible ? "eligible" : "kept",
        requiredReason,
        deletable: !requiredReason
      };
    }));
    const restoredCleanupItems = await Promise.all(restoredCleanupBackups.map(async (backup): Promise<ManagedBackupItem> => {
      const isEligible = cutoff !== undefined && new Date(backup.createdAt).getTime() < cutoff;
      return {
        id: backup.id,
        kind: "skill-cleanup",
        createdAt: backup.createdAt,
        sizeBytes: await directorySize(join(paths.backupsDir, "skill-cleanup-restored", backup.id)),
        fileCount: backup.locationCount,
        operation: backup.operation as ManagedBackupItem["operation"],
        libraryId: backup.libraryId,
        restored: true,
        cleanupStatus: isEligible ? "eligible" : "kept",
        deletable: true
      };
    }));
    const items = [...targetItems, ...cleanupItems, ...restoredCleanupItems].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
    return {
      items,
      totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
      eligibleBytes: items.filter((item) => item.cleanupStatus === "eligible")
        .reduce((total, item) => total + item.sizeBytes, 0),
      eligibleCount: items.filter((item) => item.cleanupStatus === "eligible").length,
      retentionDays: settings.backupRetentionDays
    };
  };

  const removeItem = async (item: ManagedBackupItem) => {
    if (!item.deletable) throw new Error("This backup is required for recovery and cannot be deleted");
    if (item.kind === "target-recovery" || item.kind === "workspace-sync") await backupStore.deleteBackup(item.id);
    else if (item.restored) {
      const safeId = SafeIdSchema.parse(item.id);
      await rm(join(paths.backupsDir, "skill-cleanup-restored", safeId), {
        recursive: true,
        force: true
      });
    } else await skillLibraryStore.deleteCleanupBackup(item.id);
  };

  const previewBackup = async (
    input: DeleteManagedBackupInput
  ): Promise<ManagedBackupPreview> => {
    const inventory = await listInventory();
    const item = inventory.items.find(
      (candidate) => candidate.id === input.id && candidate.kind === input.kind
    );
    if (!item) throw new Error(`Backup does not exist: ${input.id}`);

    let files: ManagedBackupFile[];
    if (item.kind === "target-recovery" || item.kind === "workspace-sync") {
      const manifest = await backupStore.readBackup(item.id);
      files = manifest.entries.map((entry) => ({
        kind: entry.kind === "directory"
          || (entry.kind === "symlink" && entry.linkType !== "file")
          ? "directory" as const
          : "file" as const,
        path: entry.sourcePath,
        state: entry.missing ? "missing" : "saved"
      }));
    } else if (item.restored) {
      const restored = await readRestoredCleanupBackups(paths);
      files = restored.find((backup) => backup.id === item.id)?.files ?? [];
    } else {
      files = await skillLibraryStore.previewCleanupBackup(item.id);
    }
    return { id: item.id, kind: item.kind, files };
  };

  const deleteBackup = async (input: DeleteManagedBackupInput) => {
    if (activeMutation) throw new Error("Backup cleanup is already running");
    activeMutation = true;
    try {
      const inventory = await listInventory();
      const item = inventory.items.find((candidate) => candidate.id === input.id && candidate.kind === input.kind);
      if (!item) throw new Error(`Backup does not exist: ${input.id}`);
      await removeItem(item);
      return { deletedCount: 1, freedBytes: item.sizeBytes };
    } finally {
      activeMutation = false;
    }
  };

  const cleanup = async (): Promise<ManagedBackupCleanupResult> => {
    if (activeMutation) throw new Error("Backup cleanup is already running");
    activeMutation = true;
    try {
      const inventory = await listInventory();
      const eligible = inventory.items.filter((item) => item.cleanupStatus === "eligible");
      let freedBytes = 0;
      let deletedCount = 0;
      const failures: ManagedBackupCleanupResult["failures"] = [];
      for (const item of eligible) {
        try {
          await removeItem(item);
          deletedCount += 1;
          freedBytes += item.sizeBytes;
        } catch (error) {
          failures.push({
            id: item.id,
            kind: item.kind,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return { deletedCount, freedBytes, failures };
    } finally {
      activeMutation = false;
    }
  };

  return { listInventory, previewBackup, deleteBackup, cleanup };
};
