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
import { readConversationDeletionPhase } from "./conversations/conversationDeletion";
import { listWorktreeRecoveryBackups, previewWorktreeRecoveryBackup } from "./worktrees/worktreeRecoveryBackup";
import { readAdvisory } from "./advisoryRead";

export interface BackupMaintenanceServiceOptions {
  now?: () => Date;
}

export interface BackupMaintenanceService {
  listInventory(): Promise<ManagedBackupInventory>;
  previewBackup(input: DeleteManagedBackupInput): Promise<ManagedBackupPreview>;
  deleteBackup(input: DeleteManagedBackupInput): Promise<{ deletedCount: number; freedBytes: number; freedBytesIncomplete?: boolean }>;
  cleanup(scope?: "recovery" | "deleted"): Promise<ManagedBackupCleanupResult>;
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

const readRestoredCleanupBackups = async (paths: AgentEnvPaths, selectedId?: string) => {
  const root = join(paths.backupsDir, "skill-cleanup-restored");
  let entries: string[];
  try {
    entries = selectedId ? [SafeIdSchema.parse(selectedId)] : await readdir(root);
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
  backupStore: Pick<BackupStore, "listBackups" | "readBackup" | "deleteBackup"> & Partial<Pick<BackupStore, "listBackupMetadata" | "readBackupManifest">>,
  skillLibraryStore: Pick<
    SkillLibraryStore,
    "listCleanupBackups" | "listCleanupBackupMetadata" | "previewCleanupBackup" | "deleteCleanupBackup"
  >,
  settingsStore: { readSettings(): Promise<Pick<AgentEnvSettings, "backupRetentionDays" | "deletedConversationRetentionDays">> },
  options: BackupMaintenanceServiceOptions = {}
): BackupMaintenanceService => {
  const now = options.now ?? (() => new Date());
  let activeMutation = false;
  const sizes = new Map<string, { pending: Promise<void>; bytes?: number; done?: boolean }>();
  let measurementQueue = Promise.resolve();
  const sizeFor = async (path: string, measure: boolean) => {
    let size = sizes.get(path);
    if (measure && !size) {
      size = { pending: Promise.resolve() };
      const entry = size;
      entry.pending = measurementQueue.then(async () => {
        const result = await readAdvisory(() => directorySize(path), 5000);
        if (result.available) entry.bytes = result.value;
      }).finally(() => { entry.done = true; });
      measurementQueue = entry.pending;
      sizes.set(path, entry);
    }
    if (measure && size?.bytes === undefined) await readAdvisory(() => size!.pending, 150);
    return { sizeBytes: size?.bytes ?? 0, ...(size?.bytes === undefined ? { sizeIncomplete: true, ...(size && !size.done ? { sizePending: true } : {}) } : {}) };
  };

  const listInventory = async (selection?: { kind: ManagedBackupItem["kind"] | "recovery" | "all"; id?: string }): Promise<ManagedBackupInventory> => {
    const measure = !selection;
    const general = !selection || ["target-recovery", "workspace-sync", "recovery", "all"].includes(selection.kind);
    const include = (kind: ManagedBackupItem["kind"]) => !selection || selection.kind === "all" || selection.kind === kind ||
      selection.kind === "recovery" && kind !== "conversation-delete" && kind !== "worktree-recovery";
    const issues: string[] = [];
    let protectionUnknown = false;
    const [
      backups,
      cleanupBackups,
      restoredCleanupBackups,
      settings,
      targetStates,
      workspaceRecoveryBackupIds,
      skillSourceMergeRecovery,
      worktreeRecovery
    ] = await Promise.all([
      selection?.kind === "conversation-delete" && selection.id && backupStore.readBackupManifest
        ? backupStore.readBackupManifest(selection.id).then((backup) => [{ ...backup, fileCount: backup.entries.length }])
        : general || include("conversation-delete") ? (backupStore.listBackupMetadata?.() ?? backupStore.listBackups()) : [],
      general || include("skill-cleanup") ? (skillLibraryStore.listCleanupBackupMetadata?.(selection?.kind === "skill-cleanup" ? selection.id : undefined) ?? skillLibraryStore.listCleanupBackups(selection?.kind === "skill-cleanup" ? selection.id : undefined)) : [],
      include("skill-cleanup") ? readRestoredCleanupBackups(paths, selection?.id) : [],
      settingsStore.readSettings(),
      general ? readTargetStates(paths).catch((error) => { protectionUnknown = true; issues.push(String(error)); return []; }) : [],
      general ? readWorkspaceSyncRecoveryBackupIds(paths).catch((error) => { protectionUnknown = true; issues.push(String(error)); return []; }) : [],
      general ? readSkillSourceMergeRecoveryBackupIds(paths) : { ids: [], ambiguous: false },
      !selection ? listWorktreeRecoveryBackups(paths.appDataRoot).then(
        (items) => ({ items, issues: [] as string[] }),
        (error: unknown) => ({
          items: [] as ManagedBackupItem[],
          issues: [error instanceof Error ? error.message : String(error)]
        })
      ) : { items: [], issues: [] }
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
    if (skillSourceMergeRecovery.ambiguous || protectionUnknown) {
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
      if (backup.operation === "conversation-delete") continue;
      for (const targetId of [backup.targetId, ...(backup.targetIds ?? [])]) {
        if (targetId && !latestByTarget.has(targetId)) latestByTarget.set(targetId, backup.id);
      }
    }
    const latestIds = new Set(latestByTarget.values());
    const cutoff = settings.backupRetentionDays === null
      ? undefined
      : now().getTime() - settings.backupRetentionDays * 24 * 60 * 60 * 1000;

    const targetItems = await Promise.all(backups.filter((backup) => {
      const kind = backup.operation === "conversation-delete" ? "conversation-delete" : backup.operation === "workspace-sync" ? "workspace-sync" : "target-recovery";
      return include(kind) && (!selection?.id || backup.id === selection.id);
    }).map(async (backup): Promise<ManagedBackupItem> => {
      if (backup.operation === "conversation-delete") {
        const phase = await readConversationDeletionPhase(paths.backupsDir, backup.id).catch(() => undefined);
        const retention = settings.deletedConversationRetentionDays === undefined ? 30 : settings.deletedConversationRetentionDays;
        const expiresAt = retention === null ? undefined : new Date(new Date(backup.createdAt).getTime() + retention * 86_400_000).toISOString();
        const incomplete = phase !== "deleted" && phase !== "restored";
        return {
          id: backup.id, kind: "conversation-delete", operation: backup.operation,
          createdAt: backup.createdAt, fileCount: backup.fileCount,
          ...await sizeFor(join(paths.backupsDir, backup.id), measure),
          targetId: backup.targetId, conversationTitle: backup.conversation?.title,
          deletionPhase: phase, expiresAt, restored: phase === "restored",
          cleanupStatus: incomplete ? "required" : expiresAt && expiresAt <= now().toISOString() ? "eligible" : "kept",
          requiredReason: incomplete ? "recovery-required" : undefined,
          deletable: !incomplete
        };
      }
      const requiredReason = required.get(backup.id);
      const isEligible = !requiredReason && !latestIds.has(backup.id) && cutoff !== undefined &&
        new Date(backup.createdAt).getTime() < cutoff;
      return {
        id: backup.id,
        kind: backup.operation === "workspace-sync" ? "workspace-sync" : "target-recovery",
        createdAt: backup.createdAt,
        ...await sizeFor(join(paths.backupsDir, backup.id), measure),
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
    const cleanupItems = await Promise.all(cleanupBackups.filter((backup) => include("skill-cleanup") && (!selection?.id || backup.id === selection.id)).map(async (backup): Promise<ManagedBackupItem> => {
      const requiredReason = backup.recoveryRequired ? "recovery-required" : undefined;
      const isEligible = !requiredReason && cutoff !== undefined &&
        new Date(backup.createdAt).getTime() < cutoff;
      return {
        id: backup.id,
        kind: "skill-cleanup",
        createdAt: backup.createdAt,
        ...await sizeFor(join(paths.backupsDir, "skill-cleanup", backup.id), measure),
        fileCount: backup.locationCount,
        operation: backup.operation,
        libraryId: backup.libraryId,
        cleanupStatus: requiredReason ? "required" : isEligible ? "eligible" : "kept",
        requiredReason,
        deletable: !requiredReason
      };
    }));
    const restoredCleanupItems = await Promise.all(restoredCleanupBackups.filter((backup) => !selection?.id || backup.id === selection.id).map(async (backup): Promise<ManagedBackupItem> => {
      const isEligible = cutoff !== undefined && new Date(backup.createdAt).getTime() < cutoff;
      return {
        id: backup.id,
        kind: "skill-cleanup",
        createdAt: backup.createdAt,
        ...await sizeFor(join(paths.backupsDir, "skill-cleanup-restored", backup.id), measure),
        fileCount: backup.locationCount,
        operation: backup.operation as ManagedBackupItem["operation"],
        libraryId: backup.libraryId,
        restored: true,
        cleanupStatus: isEligible ? "eligible" : "kept",
        deletable: true
      };
    }));
    const items = [...targetItems, ...cleanupItems, ...restoredCleanupItems, ...worktreeRecovery.items].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
    return {
      items,
      ...([...issues, ...worktreeRecovery.issues].length ? { issues: [...issues, ...worktreeRecovery.issues] } : {}),
      totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
      eligibleBytes: items.filter((item) => item.cleanupStatus === "eligible")
        .reduce((total, item) => total + item.sizeBytes, 0),
      eligibleCount: items.filter((item) => item.cleanupStatus === "eligible").length,
      retentionDays: settings.backupRetentionDays
    };
  };

  const removeItem = async (item: ManagedBackupItem) => {
    if (item.kind === "worktree-recovery") throw new Error("Worktree recovery backups are protected; disposal requires a whole-transaction recovery protocol");
    if (!item.deletable) throw new Error("This backup is required for recovery and cannot be deleted");
    if (item.kind === "target-recovery" || item.kind === "workspace-sync" || item.kind === "conversation-delete") await backupStore.deleteBackup(item.id);
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
    if (input.kind === "worktree-recovery") return previewWorktreeRecoveryBackup(paths.appDataRoot, input.id);
    let files: ManagedBackupFile[];
    if (input.kind === "target-recovery" || input.kind === "workspace-sync" || input.kind === "conversation-delete") {
      const manifest = await (backupStore.readBackupManifest?.(input.id) ?? backupStore.readBackup(input.id));
      const kind = manifest.operation === "conversation-delete" ? "conversation-delete" : manifest.operation === "workspace-sync" ? "workspace-sync" : "target-recovery";
      if (kind !== input.kind) throw new Error(`Backup does not exist: ${input.id}`);
      files = manifest.entries.map((entry) => ({
        kind: entry.kind === "directory"
          || (entry.kind === "symlink" && entry.linkType !== "file")
          ? "directory" as const
          : "file" as const,
        path: entry.sourcePath,
        state: entry.missing ? "missing" : "saved"
      }));
    } else if ((await readRestoredCleanupBackups(paths, input.id)).some((item) => item.id === input.id)) {
      const restored = await readRestoredCleanupBackups(paths, input.id);
      files = restored.find((backup) => backup.id === input.id)?.files ?? [];
    } else {
      files = await skillLibraryStore.previewCleanupBackup(input.id);
    }
    return { id: input.id, kind: input.kind, files };
  };

  const deleteBackup = async (input: DeleteManagedBackupInput) => {
    if (input.kind === "worktree-recovery") throw new Error("Worktree recovery backups are protected; disposal requires a whole-transaction recovery protocol");
    if (activeMutation) throw new Error("Backup cleanup is already running");
    activeMutation = true;
    try {
      const inventory = await listInventory(input);
      const item = inventory.items.find((candidate) => candidate.id === input.id && candidate.kind === input.kind);
      if (!item) throw new Error(`Backup does not exist: ${input.id}`);
      await removeItem(item);
      return { deletedCount: 1, freedBytes: item.sizeBytes, ...(item.sizeIncomplete ? { freedBytesIncomplete: true } : {}) };
    } finally {
      activeMutation = false;
    }
  };

  const cleanup = async (scope?: "recovery" | "deleted"): Promise<ManagedBackupCleanupResult> => {
    if (activeMutation) throw new Error("Backup cleanup is already running");
    activeMutation = true;
    try {
      const inventory = await listInventory({ kind: scope === "deleted" ? "conversation-delete" : scope === "recovery" ? "recovery" : "all" });
      const eligible = inventory.items.filter((item) => item.kind !== "worktree-recovery" && item.deletable && item.cleanupStatus === "eligible" && (!scope || (item.kind === "conversation-delete") === (scope === "deleted")));
      let freedBytes = 0;
      let deletedCount = 0;
      const failures: ManagedBackupCleanupResult["failures"] = [];
      const deletedItems: DeleteManagedBackupInput[] = [];
      let freedBytesIncomplete = false;
      for (const item of eligible) {
        try {
          await removeItem(item);
          deletedCount += 1;
          freedBytes += item.sizeBytes;
          freedBytesIncomplete ||= Boolean(item.sizeIncomplete);
          deletedItems.push({ id: item.id, kind: item.kind });
        } catch (error) {
          failures.push({
            id: item.id,
            kind: item.kind,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return { deletedCount, freedBytes, failures, deletedItems, ...(freedBytesIncomplete ? { freedBytesIncomplete: true } : {}) };
    } finally {
      activeMutation = false;
    }
  };

  return { listInventory, previewBackup, deleteBackup, cleanup };
};
