import { chmod, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { BackupManifest } from "../shared/types";
import type { BackupStore } from "./backupStore";
import {
  replacePathAtomically,
  replacePathWithCopy
} from "./fileUtils";
import { hashPathEntry } from "./filesystemIntegrity";
import { isPathInside } from "./platformPaths";

export interface BackupMutationClaimerOptions {
  allowClaimedDescendants?: boolean;
  missingMessage?: (path: string) => string;
  changedMessage?: (path: string) => string;
}

export type BackupMutationClaimer = ((...sourcePaths: string[]) => Promise<void>) & {
  readonly claimedPaths: ReadonlySet<string>;
  readonly expectedHashes: ReadonlyMap<string, string | undefined>;
  readonly mutatedPaths: ReadonlySet<string>;
  readonly mutationHashes: ReadonlyMap<string, string | undefined>;
  recordMutation(...sourcePaths: string[]): Promise<void>;
  findUnrecordedChanges(): Promise<string[]>;
};

export class BackupRecoveryError extends Error {
  readonly requestedBackupId: string;
  readonly safetyBackupId: string;

  constructor(message: string, requestedBackupId: string, safetyBackupId: string) {
    super(message);
    this.name = "BackupRecoveryError";
    this.requestedBackupId = requestedBackupId;
    this.safetyBackupId = safetyBackupId;
  }
}

export interface BackupSafetyRestoreOptions {
  backup: BackupManifest;
  backupStore: Pick<BackupStore, "createBackup">;
  claimerOptions?: BackupMutationClaimerOptions;
  continueOnError?: boolean;
  restoreSafetyOnFailure?: boolean;
  safetyBackup?: BackupManifest;
  safetyProfileName?: string;
  expectedCurrentHashes?: ReadonlyMap<string, string | undefined>;
}

export const verifyRestoredBackupEntries = async (backup: BackupManifest) => {
  const failures: string[] = [];
  for (const entry of backup.entries) {
    const actual = await hashPathEntry(entry.sourcePath);
    if (entry.missing ? actual !== undefined : actual !== entry.sha256) {
      failures.push(entry.sourcePath);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Restored data failed verification: ${failures.join(", ")}`);
  }
};

export const restoreBackupEntries = async (
  backup: BackupManifest,
  options: {
    afterMutation?: (
      path: string,
      resultingHash: string | undefined
    ) => Promise<void> | void;
    beforeMutation?: (path: string) => Promise<void>;
    continueOnError?: boolean;
    expectedCurrentHashes?: ReadonlyMap<string, string | undefined>;
  } = {}
) => {
  const expectedCurrentHashes = options.expectedCurrentHashes
    ? new Map(
        backup.entries.flatMap((entry) => {
          const path = resolve(entry.sourcePath);
          return options.expectedCurrentHashes?.has(path)
            ? [[path, options.expectedCurrentHashes.get(path)] as const]
            : [];
        })
      )
    : undefined;
  if (expectedCurrentHashes) {
    for (const [path, expectedHash] of expectedCurrentHashes) {
      if (await hashPathEntry(path) !== expectedHash) {
        throw new Error(
          `Restore target changed before mutation; recovery has not started: ${path}`
        );
      }
    }
  }
  const entries = [...backup.entries].filter((entry) => {
    const path = resolve(entry.sourcePath);
    return !backup.entries.some((ancestor) => {
      const ancestorPath = resolve(ancestor.sourcePath);
      return (
        ancestorPath !== path &&
        isPathInside(ancestorPath, path) &&
        (ancestor.missing || ancestor.kind === "directory" || ancestor.kind === "symlink")
      );
    });
  }).sort((left, right) => {
    const leftDepth = resolve(left.sourcePath).split(sep).length;
    const rightDepth = resolve(right.sourcePath).split(sep).length;
    if (left.missing && right.missing) {
      return rightDepth - leftDepth || left.sourcePath.localeCompare(right.sourcePath);
    }
    return leftDepth - rightDepth || left.sourcePath.localeCompare(right.sourcePath);
  });
  const failures: string[] = [];
  const restoreEntry = async (entry: BackupManifest["entries"][number]) => {
    await options.beforeMutation?.(entry.sourcePath);
    const resolvedPath = resolve(entry.sourcePath);
    const hasExpectedCurrentHash =
      expectedCurrentHashes?.has(resolvedPath) ?? false;
    const expectedCurrentHash = expectedCurrentHashes?.get(resolvedPath);
    const currentHash = await hashPathEntry(entry.sourcePath);
    if (hasExpectedCurrentHash && currentHash !== expectedCurrentHash) {
      throw new Error(`Restore target changed before mutation: ${entry.sourcePath}`);
    }
    const replacementOptions = hasExpectedCurrentHash
      ? { expectedTargetHash: expectedCurrentHash }
      : {};
    let mutationStarted = false;
    let mutationReported = false;
    const reportMutation = async (resultingHash: string | undefined) => {
      if (mutationReported || (entry.missing && currentHash === undefined)) return;
      mutationReported = true;
      await options.afterMutation?.(entry.sourcePath, resultingHash);
    };
    try {
      if (entry.missing) {
        if (
          hasExpectedCurrentHash &&
          await hashPathEntry(entry.sourcePath) !== expectedCurrentHash
        ) {
          throw new Error(`Restore target changed before removal: ${entry.sourcePath}`);
        }
        mutationStarted = true;
        await rm(entry.sourcePath, { recursive: true, force: true });
      } else if (entry.kind === "directory") {
        mutationStarted = true;
        await replacePathWithCopy(entry.backupPath ?? "", entry.sourcePath, {
          dereference: false,
          ...replacementOptions
        });
      } else if (entry.kind === "symlink") {
        const linkTarget =
          entry.linkTarget ?? await readlink(entry.backupPath ?? "");
        mutationStarted = true;
        await replacePathAtomically(
          entry.sourcePath,
          (stagingPath) => symlink(linkTarget, stagingPath, entry.linkType ?? "dir"),
          replacementOptions
        );
      } else {
        const content = await readFile(entry.backupPath ?? "");
        mutationStarted = true;
        await replacePathAtomically(entry.sourcePath, async (stagingPath) => {
          const mode = entry.mode ?? 0o600;
          await writeFile(stagingPath, content, { mode });
          if (process.platform !== "win32") await chmod(stagingPath, mode);
        }, replacementOptions);
      }
      const resultingHash = await hashPathEntry(entry.sourcePath);
      await reportMutation(resultingHash);
      const expectedResultHash = entry.missing ? undefined : entry.sha256;
      if (resultingHash !== expectedResultHash) {
        throw new Error(`Restored data failed verification: ${entry.sourcePath}`);
      }
    } catch (error) {
      if (mutationStarted && !mutationReported) {
        const resultingHash = await hashPathEntry(entry.sourcePath).catch(() => currentHash);
        await reportMutation(resultingHash).catch(() => undefined);
      }
      throw error;
    }
    if (expectedCurrentHashes) {
      for (const candidate of expectedCurrentHashes.keys()) {
        if (
          candidate !== resolvedPath &&
          (isPathInside(resolvedPath, candidate) || isPathInside(candidate, resolvedPath))
        ) {
          expectedCurrentHashes.set(candidate, await hashPathEntry(candidate));
        }
      }
    }
  };
  for (const entry of entries) {
    try {
      await restoreEntry(entry);
    } catch (error) {
      if (!options.continueOnError) throw error;
      failures.push(
        `${entry.sourcePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`Backup restore could not restore every path: ${failures.join("; ")}`);
  }
  await verifyRestoredBackupEntries(backup);
};

export const createBackupMutationClaimer = (
  backup: BackupManifest,
  options: BackupMutationClaimerOptions = {}
): BackupMutationClaimer => {
  const expectedHashes = new Map(
    backup.entries.map((entry) => [
      resolve(entry.sourcePath),
      entry.missing ? undefined : entry.sha256
    ])
  );
  const claimedPaths = new Set<string>();
  const mutatedPaths = new Set<string>();
  const mutationHashes = new Map<string, string | undefined>();

  const claim = async (...sourcePaths: string[]) => {
    for (const sourcePath of sourcePaths) {
      const path = resolve(sourcePath);
      const previouslyClaimedPaths = [...claimedPaths].filter(
        (candidate) => candidate === path || isPathInside(candidate, path)
      );
      for (const candidate of previouslyClaimedPaths) {
        const expected = mutatedPaths.has(candidate)
          ? mutationHashes.get(candidate)
          : expectedHashes.get(candidate);
        const actual = await hashPathEntry(candidate);
        if (actual !== expected) {
          const baseMessage =
            options.changedMessage?.(candidate) ??
            `Path changed after its previous mutation receipt: ${candidate}`;
          throw new Error(
            `${baseMessage} (expected ${expected ?? "missing"}, found ${actual ?? "missing"})`
          );
        }
      }
      if (claimedPaths.has(path)) continue;
      const missingAncestors = [...expectedHashes.entries()]
        .filter(([candidate, expected]) =>
          expected === undefined &&
          candidate !== path &&
          isPathInside(candidate, path)
        )
        .sort(([left], [right]) => left.length - right.length);
      for (const [ancestor] of missingAncestors) {
        if (claimedPaths.has(ancestor)) continue;
        if (await hashPathEntry(ancestor) !== undefined) {
          throw new Error(
            options.changedMessage?.(ancestor) ??
            `Path changed after backup and before mutation: ${ancestor}`
          );
        }
        claimedPaths.add(ancestor);
      }
      if ([...mutatedPaths].some((candidate) => isPathInside(candidate, path))) {
        claimedPaths.add(path);
        continue;
      }
      if (expectedHashes.has(path)) {
        const expected = expectedHashes.get(path);
        const actual = await hashPathEntry(sourcePath);
        if (actual !== expected) {
          const baseMessage =
            options.changedMessage?.(sourcePath) ??
            `Path changed after backup and before mutation: ${sourcePath}`;
          throw new Error(
            `${baseMessage} (expected ${expected ?? "missing"}, found ${actual ?? "missing"})`
          );
        }
        claimedPaths.add(path);
        continue;
      }
      if (
        options.allowClaimedDescendants &&
        [...claimedPaths].some((candidate) => isPathInside(candidate, path))
      ) {
        claimedPaths.add(path);
        continue;
      }
      throw new Error(
        options.missingMessage?.(sourcePath) ??
        `Backup did not preserve the path before mutation: ${sourcePath}`
      );
    }
  };
  return Object.assign(claim, {
    claimedPaths,
    expectedHashes,
    mutatedPaths,
    mutationHashes,
    recordMutation: async (...sourcePaths: string[]) => {
      for (const sourcePath of sourcePaths) {
        const path = resolve(sourcePath);
        if (!claimedPaths.has(path)) {
          throw new Error(`Cannot record an unclaimed mutation: ${sourcePath}`);
        }
        mutationHashes.set(path, await hashPathEntry(path));
        mutatedPaths.add(path);
        for (const ancestor of claimedPaths) {
          if (
            ancestor !== path &&
            expectedHashes.get(ancestor) === undefined &&
            isPathInside(ancestor, path)
          ) {
            mutationHashes.set(ancestor, await hashPathEntry(ancestor));
            mutatedPaths.add(ancestor);
          }
        }
      }
    },
    findUnrecordedChanges: async () => {
      const changed: string[] = [];
      for (const path of claimedPaths) {
        if (mutatedPaths.has(path)) continue;
        try {
          if (await hashPathEntry(path) !== expectedHashes.get(path)) changed.push(path);
        } catch {
          changed.push(path);
        }
      }
      return changed;
    }
  });
};

export const selectBackupEntries = (
  backup: BackupManifest,
  sourcePaths: Iterable<string>
): BackupManifest => {
  const selected = new Set([...sourcePaths].map((path) => resolve(path)));
  return {
    ...backup,
    entries: backup.entries.filter((entry) => selected.has(resolve(entry.sourcePath)))
  };
};

export const restoreBackupWithSafety = async ({
  backup,
  backupStore,
  claimerOptions,
  continueOnError,
  restoreSafetyOnFailure = true,
  safetyBackup: preparedSafetyBackup,
  safetyProfileName,
  expectedCurrentHashes
}: BackupSafetyRestoreOptions): Promise<BackupManifest> => {
  const safetyBackup = preparedSafetyBackup ?? await backupStore.createBackup(
    [...new Set(backup.entries.map((entry) => entry.sourcePath))],
    {
      operation: "rollback-safety",
      targetId: backup.targetId,
      targetIds: backup.targetIds,
      profileId: backup.profileId,
      profileName:
        safetyProfileName ??
      (backup.profileName ? `${backup.profileName} before rollback` : "Before rollback")
    }
  );
  if (expectedCurrentHashes) {
    const mismatches: string[] = [];
    for (const entry of backup.entries) {
      const path = resolve(entry.sourcePath);
      if (!expectedCurrentHashes.has(path)) {
        mismatches.push(`${entry.sourcePath} (missing mutation receipt)`);
        continue;
      }
      try {
        if (await hashPathEntry(path) !== expectedCurrentHashes.get(path)) {
          mismatches.push(entry.sourcePath);
        }
      } catch {
        mismatches.push(`${entry.sourcePath} (unreadable)`);
      }
    }
    if (mismatches.length > 0) {
      throw new BackupRecoveryError(
        `Automatic rollback stopped because current data no longer matches this operation's ` +
        `verified writes. Newer data was preserved at ${mismatches.join(", ")}. ` +
        `Backup ${backup.id} contains the requested recovery state and safety backup ` +
        `${safetyBackup.id} contains the current state.`,
        backup.id,
        safetyBackup.id
      );
    }
  }
  const claimRestorePath = createBackupMutationClaimer(safetyBackup, claimerOptions);
  const mutationHashes = new Map<string, string | undefined>();
  const selectedRestorePaths = backup.entries.map((entry) => resolve(entry.sourcePath));
  const restorePathWithAncestors = (path: string) => {
    const resolvedPath = resolve(path);
    return [
      ...selectedRestorePaths
        .filter(
          (candidate) => candidate !== resolvedPath && isPathInside(candidate, resolvedPath)
        )
        .sort((left, right) => left.length - right.length),
      resolvedPath
    ];
  };
  try {
    await restoreBackupEntries(backup, {
      beforeMutation: async (path) => {
        await claimRestorePath(...restorePathWithAncestors(path));
      },
      continueOnError,
      expectedCurrentHashes: expectedCurrentHashes ?? claimRestorePath.expectedHashes,
      afterMutation: async (path) => {
        const mutationPaths = restorePathWithAncestors(path);
        await claimRestorePath.recordMutation(...mutationPaths);
        for (const mutationPath of mutationPaths) {
          mutationHashes.set(
            mutationPath,
            claimRestorePath.mutationHashes.get(mutationPath)
          );
        }
      }
    });
  } catch (restoreError) {
    if (!restoreSafetyOnFailure) {
      throw new BackupRecoveryError(
        `Rollback restored every path it could and left failed paths unchanged. ` +
        `Backup ${backup.id} contains the requested state; safety backup ${safetyBackup.id} ` +
        `contains the state from before rollback. ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`,
        backup.id,
        safetyBackup.id
      );
    }
    const recoverablePaths: string[] = [];
    const externallyChangedPaths: string[] = [];
    for (const [path, resultingHash] of mutationHashes) {
      try {
        if (await hashPathEntry(path) === resultingHash) {
          recoverablePaths.push(path);
          continue;
        }
      } catch {
        // An unreadable path cannot be proven to still be owned by this restore.
      }
      if (!recoverablePaths.includes(path)) {
        externallyChangedPaths.push(path);
      }
    }
    const touchedSafetyBackup = selectBackupEntries(
      safetyBackup,
      recoverablePaths
    );
    if (touchedSafetyBackup.entries.length > 0) {
      try {
        await restoreBackupEntries(touchedSafetyBackup, {
          continueOnError: true,
          expectedCurrentHashes: mutationHashes
        });
      } catch (safetyRestoreError) {
        throw new BackupRecoveryError(
          `Rollback failed and the pre-rollback state could not be restored automatically. ` +
          `Backup ${backup.id} contains the requested state; safety backup ${safetyBackup.id} ` +
          `contains the state from before rollback. Restore error: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }. Safety recovery error: ${
            safetyRestoreError instanceof Error ? safetyRestoreError.message : String(safetyRestoreError)
          }`,
          backup.id,
          safetyBackup.id
        );
      }
    }
    if (externallyChangedPaths.length > 0) {
      throw new BackupRecoveryError(
        `Rollback stopped because restored paths changed again during recovery. ` +
        `The newer paths were preserved: ${externallyChangedPaths.join(", ")}. ` +
        `Backup ${backup.id} contains the requested state and safety backup ${safetyBackup.id} ` +
        `contains the pre-rollback state.`,
        backup.id,
        safetyBackup.id
      );
    }
    if (touchedSafetyBackup.entries.length === 0) throw restoreError;
    throw new Error(
      `Rollback failed; the state from before rollback was restored from safety backup ${safetyBackup.id}. ${
        restoreError instanceof Error ? restoreError.message : String(restoreError)
      }`
    );
  }
  return safetyBackup;
};
