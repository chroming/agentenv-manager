import type { BackupStore } from "./backupStore";
import type { SkillLibraryStore } from "./skillLibraryStore";
import {
  listPendingSkillSourceMerges,
  recoverInterruptedSkillSourceMerges
} from "./skillSourceMergeService";

export interface SkillMutationRecoveryGate {
  recover(): Promise<void>;
  refresh(): Promise<void>;
  assertMutationAllowed(channel: string): void;
  run<T>(channel: string, operation: () => Promise<T> | T): Promise<T>;
  pendingIds(): string[];
}

const isRecoveryCommand = (channel: string) =>
  channel === "skills:rollback-cleanup" ||
  channel === "data:restore";

const canAffectSkillState = (channel: string) =>
  /^(skills|profiles|activation|targets|workspace-sync):/.test(channel);

export const createSkillMutationRecoveryGate = (options: {
  appDataRoot: string;
  backupStore: BackupStore;
  skillLibraryStore: Pick<
    SkillLibraryStore,
    "listPendingCleanupRecoveries" | "recoverInterruptedCleanupBackups"
  >;
}): SkillMutationRecoveryGate => {
  let blockedIds: string[] = [];

  const refresh = async () => {
    const [cleanupBackups, sourceMerges] = await Promise.all([
      options.skillLibraryStore.listPendingCleanupRecoveries(),
      listPendingSkillSourceMerges(options.appDataRoot)
    ]);
    blockedIds = [
      ...cleanupBackups.map((id) => `cleanup:${id}`),
      ...sourceMerges.map((id) => `source-merge:${id}`)
    ].sort();
  };

  const recover = async () => {
    await options.skillLibraryStore.recoverInterruptedCleanupBackups();
    await recoverInterruptedSkillSourceMerges(options.appDataRoot, options.backupStore);
    await refresh();
  };

  const assertMutationAllowed = (channel: string) => {
    if (
      blockedIds.length === 0 ||
      isRecoveryCommand(channel) ||
      !canAffectSkillState(channel)
    ) {
      return;
    }
    throw new Error(
      `Skill recovery is required before changing Library, Profile, or Agent resources. ` +
      `Preserved recovery records: ${blockedIds.join(", ")}`
    );
  };

  const run = async <T>(channel: string, operation: () => Promise<T> | T): Promise<T> => {
    assertMutationAllowed(channel);
    try {
      return await operation();
    } catch (error) {
      await refresh().catch(() => undefined);
      throw error;
    } finally {
      if (isRecoveryCommand(channel)) await refresh().catch(() => undefined);
    }
  };

  return {
    recover,
    refresh,
    assertMutationAllowed,
    run,
    pendingIds: () => [...blockedIds]
  };
};
