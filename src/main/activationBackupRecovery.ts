import { dirname, resolve } from "node:path";
import type { BackupManifest, TargetPaths } from "../shared/types";
import type { BackupStore } from "./backupStore";
import {
  restoreBackupWithSafety,
  selectBackupEntries
} from "./backupRestore";
import type { BackupMutationClaimer } from "./backupRestore";
import type { AgentEnvPaths } from "./paths";
import { isPathInside, pathsEqual } from "./platformPaths";

interface ManagedBackupRestorerOptions {
  paths: AgentEnvPaths;
  backupStore: BackupStore;
  targetPathsFor: (targetId: string) => Promise<TargetPaths>;
  statePathFor: (targetId: string) => string;
}

export const createManagedBackupRestorer = ({
  paths,
  backupStore,
  targetPathsFor,
  statePathFor
}: ManagedBackupRestorerOptions) => async (
  backup: BackupManifest,
  options: { expectedCurrentHashes?: ReadonlyMap<string, string | undefined> } = {}
) => {
  const exactPaths = new Set<string>();
  const resourceRoots = new Set<string>();
  const resourceContainers = new Set<string>();
  exactPaths.add(resolve(paths.sharedSkillAreaStatePath));
  const targetIds = [...new Set([backup.targetId, ...(backup.targetIds ?? [])])].filter(
    (id): id is string => Boolean(id)
  );
  for (const targetId of targetIds) {
    const targetPaths = await targetPathsFor(targetId);
    exactPaths.add(resolve(targetPaths.instructionsPath));
    exactPaths.add(resolve(targetPaths.configPath));
    exactPaths.add(resolve(statePathFor(targetId)));
    resourceContainers.add(resolve(targetPaths.configDir));
    resourceContainers.add(resolve(dirname(targetPaths.instructionsPath)));
    if (targetPaths.mcpConfigPath) exactPaths.add(resolve(targetPaths.mcpConfigPath));
    for (const root of [
      targetPaths.skillsDir,
      targetPaths.agentsDir,
      ...(targetPaths.skillScanDirs ?? []),
      ...(targetPaths.skillLocations ?? []).map((location) => location.path)
    ]) {
      if (root) resourceRoots.add(resolve(root));
    }
  }
  if (backup.profileId) exactPaths.add(resolve(paths.profilesDir, backup.profileId));

  for (const entry of backup.entries) {
    const sourcePath = resolve(entry.sourcePath);
    const allowedResource = [...resourceRoots].some((root) => {
      if (pathsEqual(sourcePath, root)) return entry.missing || entry.kind === "symlink";
      return isPathInside(root, sourcePath) && pathsEqual(dirname(sourcePath), root);
    });
    const allowedMissingContainer = Boolean(
      entry.missing &&
      [...resourceContainers].some((container) => {
        if (!pathsEqual(container, sourcePath) && !isPathInside(container, sourcePath)) {
          return false;
        }
        return [...resourceRoots].some((root) => isPathInside(sourcePath, root));
      })
    );
    if (!exactPaths.has(sourcePath) && !allowedResource && !allowedMissingContainer) {
      throw new Error(`Backup contains a path outside AgentEnv-managed locations: ${entry.sourcePath}`);
    }
  }

  await restoreBackupWithSafety({
    backup,
    backupStore,
    claimerOptions: {
      allowClaimedDescendants: true,
      missingMessage: (path) =>
        `Rollback did not preserve the current resource before mutation: ${path}`,
      changedMessage: (path) =>
        `Resource changed while rollback was being prepared: ${path}`
    },
    expectedCurrentHashes: options.expectedCurrentHashes
  });
};

export const restoreRecordedBackupMutations = async ({
  backup,
  claimer,
  restoreBackup
}: {
  backup: BackupManifest;
  claimer: BackupMutationClaimer;
  restoreBackup: (
    backup: BackupManifest,
    options?: { expectedCurrentHashes?: ReadonlyMap<string, string | undefined> }
  ) => Promise<void>;
}) => {
  const unrecordedChanges = await claimer.findUnrecordedChanges();
  if (unrecordedChanges.length > 0) {
    throw new Error(
      `Automatic recovery stopped because these paths changed without a completed ` +
      `AgentEnv write receipt: ${unrecordedChanges.join(", ")}`
    );
  }
  const touchedBackup = selectBackupEntries(backup, claimer.mutatedPaths);
  if (touchedBackup.entries.length === 0) return;
  await restoreBackup(touchedBackup, {
    expectedCurrentHashes: claimer.mutationHashes
  });
};
