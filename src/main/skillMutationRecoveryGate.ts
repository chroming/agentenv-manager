import type { BackupStore } from "./backupStore";
import type { SkillLibraryStore } from "./skillLibraryStore";
import { realpath } from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import { isPathInside } from "./platformPaths";
import {
  listPendingSkillSourceMerges,
  recoverInterruptedSkillSourceMerges
} from "./skillSourceMergeService";

export interface SkillMutationRecoveryGate {
  recover(): Promise<void>;
  refresh(): Promise<void>;
  assertMutationAllowed(channel: string, affectedPaths?: readonly string[]): void;
  run<T>(channel: string, operation: () => Promise<T> | T, affectedPaths?: readonly string[]): Promise<T>;
  pendingIds(): string[];
}

const isRecoveryCommand = (channel: string) =>
  channel === "skills:rollback-cleanup" ||
  channel === "data:restore";

const canAffectSkillState = (channel: string) =>
  /^(skills|profiles|activation|targets|workspace-sync):/.test(channel);

const canonicalRecoveryPath = async (path: string): Promise<string> => {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return join(await canonicalRecoveryPath(dirname(path)), basename(path));
  }
};

const recoveryPathKeys = async (paths: readonly string[]) => [...new Set((await Promise.all(
  paths.map(async (path) => [resolve(path), await canonicalRecoveryPath(resolve(path))])
)).flat().map((path) => process.platform === "linux" ? path : path.toLowerCase()))];

const overlaps = (left: string, right: string) =>
  isPathInside(left, right, { allowRoot: true }) || isPathInside(right, left, { allowRoot: true });

export const createSkillMutationRecoveryGate = (options: {
  appDataRoot: string;
  backupStore: BackupStore;
  skillLibraryStore: Pick<
    SkillLibraryStore,
    "listPendingCleanupRecoveries" | "recoverInterruptedCleanupBackups"
  > & Partial<Pick<SkillLibraryStore, "readCleanupRecoveryPaths">>;
}): SkillMutationRecoveryGate => {
  let blockedIds: string[] = [];
  const recoveryPaths = new Map<string, string[]>();

  const refresh = async () => {
    const [cleanupBackups, sourceMerges] = await Promise.all([
      options.skillLibraryStore.listPendingCleanupRecoveries(),
      listPendingSkillSourceMerges(options.appDataRoot)
    ]);
    blockedIds = [
      ...cleanupBackups.map((id) => `cleanup:${id}`),
      ...sourceMerges.map((id) => `source-merge:${id}`)
    ].sort();
    recoveryPaths.clear();
    for (const id of cleanupBackups) {
      try {
        const paths = await options.skillLibraryStore.readCleanupRecoveryPaths?.(id);
        if (paths?.length) recoveryPaths.set(`cleanup:${id}`, await recoveryPathKeys(paths));
      } catch { /* Unverifiable journals retain the conservative gate. */ }
    }
  };

  const recover = async () => {
    await options.skillLibraryStore.recoverInterruptedCleanupBackups();
    await recoverInterruptedSkillSourceMerges(options.appDataRoot, options.backupStore);
    await refresh();
  };

  const assertMutationAllowed = (channel: string, affectedPaths?: readonly string[]) => {
    if (
      blockedIds.length === 0 ||
      isRecoveryCommand(channel) ||
      !canAffectSkillState(channel)
    ) {
      return;
    }
    const relevantIds = blockedIds.filter((id) => {
      const paths = recoveryPaths.get(id);
      return !paths || !affectedPaths?.length || paths.some((path) => affectedPaths.some((affected) => overlaps(path, affected)));
    });
    if (!relevantIds.length) return;
    throw new Error(
      `Skill recovery is required before changing Library, Profile, or Agent resources. ` +
      `Open Local Skills > Cleanup history to review and restore the affected operation, or export diagnostics from Settings if recovery is unavailable. Your files have not been changed. ` +
      `Preserved recovery records: ${relevantIds.join(", ")}`
    );
  };

  const run = async <T>(channel: string, operation: () => Promise<T> | T, affectedPaths?: readonly string[]): Promise<T> => {
    const scope = affectedPaths ? await recoveryPathKeys(affectedPaths).catch(() => undefined) : undefined;
    assertMutationAllowed(channel, scope);
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
