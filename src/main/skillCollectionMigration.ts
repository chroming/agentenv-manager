import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { materializeTargetResourcePolicy, profileResourceMode } from "../shared/profileResources";
import { reconcileSkill, toAppliedSkillReceipt } from "../shared/skillReconciliation";
import { normalizeSkillKey } from "../shared/skillIdentity";
import { isSharedSkillInventoryEntry } from "../shared/skillLocationSemantics";
import type {
  BackupManifest,
  ManagedResourceSnapshot,
  ProfileDetail,
  SkillCleanupResult,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetPaths,
  TargetState
} from "../shared/types";
import { pathEntryExists, pathExists } from "./fileUtils";
import { isPathInside } from "./platformPaths";
import { markerPathForFile } from "./ownershipMarkers";
import { hashSkillContent } from "./skillContentHash";
import { removeSkillDeployment } from "./skillDeployment";
import { normalizeSkillReceipts } from "./skillReconciliationReceipts";
import {
  BackupRecoveryError,
  createBackupMutationClaimer,
  selectBackupEntries
} from "./backupRestore";

export interface SkillCollectionMigrationInput {
  collectionPath: string;
  canonicalPath: string;
  profileReceipts: Record<string, {
    profileId: string;
    contentHash: string;
  }>;
  members: Array<{
    skillKey: string;
    libraryId: string;
    sharedPath: string;
    consumerTargetIds: string[];
    useLibraryVersion?: boolean;
    sourceContentHash?: string;
  }>;
}

interface SkillCollectionMigrationDependencies {
  claimTargets(targetIds: string[]): Promise<void>;
  releaseTargets(targetIds: string[]): void;
  targetName(targetId: string): string;
  targetPathsFor(targetId: string): Promise<TargetPaths>;
  readTargetStateFile(targetId: string): Promise<{
    path: string;
    pathHash?: string;
    state: TargetState;
  }>;
  writeTargetState(
    targetId: string,
    state: TargetState,
    options?: { expectedPathHash?: string }
  ): Promise<void>;
  readProfile(profileId: string): Promise<ProfileDetail>;
  applyLibraryAvailability(
    profile: ProfileDetail,
    library: SkillLibraryEntry[]
  ): ProfileDetail;
  listSkills(): Promise<SkillLibraryEntry[]>;
  scanInventory(
    targetPaths: TargetPaths[],
    library: SkillLibraryEntry[]
  ): Promise<SkillInventoryEntry[]>;
  deployLibrarySkill(input: {
    targetPaths: TargetPaths;
    targetName: string;
    libraryId: string;
    profileId: string;
  }): Promise<void>;
  hashComparablePath(path: string): Promise<string | undefined>;
  createBackup(
    paths: string[],
    metadata: {
      operation: "shared-skill-migration";
      targetIds: string[];
      profileName: string;
    }
  ): Promise<BackupManifest>;
  restoreBackup(
    backup: BackupManifest,
    options?: { expectedCurrentHashes?: ReadonlyMap<string, string | undefined> }
  ): Promise<void>;
  snapshotManagedResources(
    paths: string[],
    targetPaths: TargetPaths
  ): Promise<ManagedResourceSnapshot[]>;
  appendHistory(entry: {
    type: "shared-skill-migration";
    skillKey: string;
    libraryId: string;
    targetIds: string[];
    backupId: string;
  }): Promise<void>;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const completeSkillCollectionMigrationTransaction = async (
  { collectionPath, canonicalPath, profileReceipts, members }: SkillCollectionMigrationInput,
  dependencies: SkillCollectionMigrationDependencies
): Promise<SkillCleanupResult> => {
  const normalizedCollectionPath = resolve(collectionPath);
  const normalizedCanonicalPath = await realpath(canonicalPath)
    .then((path) => resolve(path))
    .catch(() => resolve(canonicalPath));
  const uniqueMembers = [...new Map(
    members.map((member) => [
      `${normalizeSkillKey(member.skillKey)}\0${member.libraryId}\0${resolve(member.sharedPath)}`,
      {
        ...member,
        skillKey: normalizeSkillKey(member.skillKey),
        sharedPath: resolve(member.sharedPath),
        consumerTargetIds: [...new Set(member.consumerTargetIds)].sort()
      }
    ])
  ).values()];
  if (uniqueMembers.length === 0) {
    throw new Error("Skill collection has no discovered Skills to migrate.");
  }
  if (
    uniqueMembers.some((member) =>
      !isPathInside(normalizedCollectionPath, member.sharedPath)
    )
  ) {
    throw new Error("Skill collection contains a path outside its reviewed link.");
  }

  const targetIds = [...new Set(
    uniqueMembers.flatMap((member) => member.consumerTargetIds)
  )].sort();
  if (targetIds.length === 0) {
    throw new Error("Skill collection has no installed Agent consumers to migrate.");
  }
  if (
    Object.keys(profileReceipts).length !== targetIds.length ||
    targetIds.some((targetId) => !profileReceipts[targetId])
  ) {
    throw new Error("Skill collection Profile review is incomplete. Review the collection again.");
  }
  await dependencies.claimTargets(targetIds);

  try {
    const collectionStats = await lstat(normalizedCollectionPath).catch(() => undefined);
    if (!collectionStats?.isSymbolicLink()) {
      throw new Error(`Skill collection link changed before migration: ${normalizedCollectionPath}`);
    }
    const currentCanonicalPath = await realpath(normalizedCollectionPath).catch(() => undefined);
    if (!currentCanonicalPath || resolve(currentCanonicalPath) !== normalizedCanonicalPath) {
      throw new Error(`Skill collection link target changed before migration: ${normalizedCollectionPath}`);
    }

    const skillLibrary = await dependencies.listSkills();
    const libraryById = new Map(skillLibrary.map((skill) => [skill.id, skill]));
    for (const member of uniqueMembers) {
      const librarySkill = libraryById.get(member.libraryId);
      if (!librarySkill) {
        throw new Error(`Library Skill is unavailable: ${member.libraryId}`);
      }
      if (!(await pathExists(join(member.sharedPath, "SKILL.md")))) {
        throw new Error(`Collection Skill changed before migration: ${member.sharedPath}`);
      }
      if (member.useLibraryVersion) {
        const currentSourceHash = await hashSkillContent(member.sharedPath);
        if (!member.sourceContentHash || currentSourceHash !== member.sourceContentHash) {
          throw new Error(
            `Collection Skill ${member.skillKey} changed after its Library version was selected. Review the collection again.`
          );
        }
      } else if (
        (await dependencies.hashComparablePath(member.sharedPath)) !==
        (await dependencies.hashComparablePath(librarySkill.path))
      ) {
        throw new Error(
          `Collection Skill ${member.skillKey} no longer matches Library. Review the collection again.`
        );
      }
    }

    type CollectionTargetOperation = {
      member: (typeof uniqueMembers)[number];
      intent: {
        disposition: "install" | "omit";
        profileId: string;
        targetName: string;
      };
      targetPath: string;
    };
    const contexts: Array<{
      targetId: string;
      targetPaths: TargetPaths;
      statePath: string;
      statePathHash?: string;
      state: TargetState;
      operations: CollectionTargetOperation[];
    }> = [];

    for (const targetId of targetIds) {
      const targetName = dependencies.targetName(targetId);
      const targetPaths = await dependencies.targetPathsFor(targetId);
      if (!targetPaths.skillsDir) {
        throw new Error(`${targetName} does not expose a skills directory.`);
      }
      const stateFile = await dependencies.readTargetStateFile(targetId);
      if (!stateFile.state.activeProfileId) {
        throw new Error(
          `${targetName} has no active Profile. Apply a Profile before migrating this collection.`
        );
      }
      if (stateFile.state.recoveryRequired) {
        throw new Error(`${targetName} requires recovery before migration.`);
      }
      const profileReceipt = profileReceipts[targetId];
      if (stateFile.state.activeProfileId !== profileReceipt.profileId) {
        throw new Error(`${targetName}'s active Profile changed during collection review.`);
      }
      const sourceProfile = await dependencies.readProfile(stateFile.state.activeProfileId);
      if (sourceProfile.contentHash !== profileReceipt.contentHash) {
        throw new Error(`${targetName}'s saved Profile changed during collection review.`);
      }
      if (profileResourceMode(sourceProfile.resources, targetId, "skills") === "ignore") {
        throw new Error(
          `${targetName} leaves Skills unchanged. Choose Use Profile or Turn off for Skills, save, then retry cleanup.`
        );
      }
      const effectiveProfile = materializeTargetResourcePolicy(
        dependencies.applyLibraryAvailability(sourceProfile, skillLibrary),
        targetId
      );
      const inventory = await dependencies.scanInventory([targetPaths], skillLibrary);
      const operations: CollectionTargetOperation[] = [];
      for (const member of uniqueMembers.filter(
        (item) => item.consumerTargetIds.includes(targetId)
      )) {
        const profileReference = effectiveProfile.resources.skills.find(
          (reference) => reference.libraryId === member.libraryId
        );
        const intent = {
          disposition: profileReference?.enabled ? "install" as const : "omit" as const,
          profileId: sourceProfile.id,
          targetName: profileReference?.targetName ?? member.libraryId
        };
        const targetPath = join(targetPaths.skillsDir, intent.targetName);
        const occupyingItem = inventory.find(
          (item) =>
            !isSharedSkillInventoryEntry(item) && resolve(item.path) === resolve(targetPath)
        );
        if (
          occupyingItem &&
          (occupyingItem.status !== "managed" ||
            occupyingItem.libraryId !== member.libraryId)
        ) {
          throw new Error(
            `${targetName} cannot switch ${member.skillKey}: ${targetPath} is not the prepared AgentEnv copy.`
          );
        }
        operations.push({ member, intent, targetPath });
      }
      contexts.push({
        targetId,
        targetPaths,
        statePath: stateFile.path,
        statePathHash: stateFile.pathHash,
        state: stateFile.state,
        operations
      });
    }

    const backup = await dependencies.createBackup(
      [
        normalizedCollectionPath,
        ...contexts.flatMap((context) => [
          context.statePath,
          ...context.operations.flatMap((operation) => [
            operation.targetPath,
            markerPathForFile(operation.targetPath)
          ])
        ])
      ].filter((path, index, all) => all.indexOf(path) === index),
      {
        operation: "shared-skill-migration",
        targetIds,
        profileName: basename(normalizedCollectionPath)
      }
    );
    const claimPath = createBackupMutationClaimer(backup, {
      missingMessage: (path) => `Skill collection migration did not preserve ${path}`,
      changedMessage: (path) => `Skill collection path changed after backup: ${path}`
    });
    const installedPaths: string[] = [];

    try {
      for (const context of contexts) {
        await claimPath(context.statePath);
        await dependencies.writeTargetState(context.targetId, {
          ...context.state,
          recoveryRequired: {
            operation: "apply",
            error: "Skill collection migration was interrupted before completion",
            backupId: backup.id,
            occurredAt: new Date().toISOString()
          }
        }, { expectedPathHash: context.statePathHash });
        await claimPath.recordMutation(context.statePath);
      }
      await claimPath(normalizedCollectionPath);
      await rm(normalizedCollectionPath);
      await claimPath.recordMutation(normalizedCollectionPath);

      for (const context of contexts) {
        let managedResources = [...(context.state.managedResources ?? [])];
        for (const operation of context.operations) {
          await claimPath(operation.targetPath, markerPathForFile(operation.targetPath));
          managedResources = managedResources.filter(
            (resource) => resolve(resource.path) !== resolve(operation.targetPath)
          );
          if (operation.intent.disposition === "install") {
            await dependencies.deployLibrarySkill({
              targetPaths: context.targetPaths,
              targetName: operation.intent.targetName,
              libraryId: operation.member.libraryId,
              profileId: operation.intent.profileId
            });
            installedPaths.push(operation.targetPath);
            managedResources.push(
              ...await dependencies.snapshotManagedResources(
                [operation.targetPath],
                context.targetPaths
              )
            );
          } else {
            await removeSkillDeployment(operation.targetPath, {
              allowedRoot: context.targetPaths.skillsDir ?? dirname(operation.targetPath)
            });
          }
          await claimPath.recordMutation(
            operation.targetPath,
            markerPathForFile(operation.targetPath)
          );
        }
        const currentInventory = await dependencies.scanInventory(
          [context.targetPaths],
          skillLibrary
        );
        const migratedPaths = new Set(
          context.operations.map((operation) => resolve(operation.targetPath))
        );
        const migratedReferences = new Set(
          context.operations.map(
            (operation) => `${operation.member.libraryId}\0${operation.intent.targetName}`
          )
        );
        const migratedReceipts = context.operations.map((operation) => {
          const observation = currentInventory.find(
            (item) => resolve(item.path) === resolve(operation.targetPath)
          );
          return toAppliedSkillReceipt(reconcileSkill({
            libraryId: operation.member.libraryId,
            targetName: operation.intent.targetName,
            targetPath: operation.targetPath,
            desired: operation.intent.disposition,
            observation
          }));
        });
        const skillReceipts = normalizeSkillReceipts([
          ...(context.state.skillReceipts ?? []).filter((receipt) =>
            !(receipt.path && migratedPaths.has(resolve(receipt.path))) &&
            !migratedReferences.has(`${receipt.libraryId}\0${receipt.targetName}`)
          ),
          ...migratedReceipts
        ]);
        const appliedSkillVersions = {
          ...(context.state.appliedLibraryVersions?.skills ?? {})
        };
        for (const operation of context.operations) {
          if (operation.intent.disposition === "install") {
            const contentHash = libraryById.get(operation.member.libraryId)?.contentHash;
            if (contentHash) {
              appliedSkillVersions[operation.member.libraryId] = contentHash;
            }
          } else {
            delete appliedSkillVersions[operation.member.libraryId];
          }
        }
        const migratedMemberKeys = new Set(
          context.operations.map(
            (operation) => `${operation.member.skillKey}\0${operation.member.libraryId}`
          )
        );
        await dependencies.writeTargetState(context.targetId, {
          ...context.state,
          managedResources,
          appliedLibraryVersions: {
            ...context.state.appliedLibraryVersions,
            skills: appliedSkillVersions
          },
          skillReceipts,
          sharedSkillPreparations: (context.state.sharedSkillPreparations ?? []).filter(
            (item) => !migratedMemberKeys.has(`${item.skillKey}\0${item.libraryId}`)
          )
        }, {
          expectedPathHash: claimPath.mutationHashes.get(resolve(context.statePath))
        });
        await claimPath.recordMutation(context.statePath);
      }

      if (await pathEntryExists(normalizedCollectionPath)) {
        throw new Error(`Skill collection link removal verification failed: ${normalizedCollectionPath}`);
      }
      if (!(await pathExists(normalizedCanonicalPath))) {
        throw new Error(`Skill collection source became unavailable: ${normalizedCanonicalPath}`);
      }
      for (const context of contexts) {
        for (const operation of context.operations) {
          const shouldExist = operation.intent.disposition === "install";
          if ((await pathExists(join(operation.targetPath, "SKILL.md"))) !== shouldExist) {
            throw new Error(`Agent Skill verification failed: ${operation.targetPath}`);
          }
        }
      }
      await dependencies.appendHistory({
        type: "shared-skill-migration",
        skillKey: basename(normalizedCollectionPath),
        libraryId: "_collection",
        targetIds,
        backupId: backup.id
      });
    } catch (error) {
      try {
        const unrecordedChanges = await claimPath.findUnrecordedChanges();
        if (unrecordedChanges.length > 0) {
          throw new Error(
            `Automatic collection recovery stopped because paths changed without a completed ` +
            `write receipt: ${unrecordedChanges.join(", ")}`
          );
        }
        await dependencies.restoreBackup(
          selectBackupEntries(backup, claimPath.mutatedPaths),
          { expectedCurrentHashes: claimPath.mutationHashes }
        );
      } catch (restoreError) {
        const recoveryError =
          `Skill collection migration failed: ${errorMessage(error)}; automatic restore failed: ${errorMessage(restoreError)}`;
        await Promise.all(
          contexts.map(async (context) => {
            try {
              const currentStateFile = await dependencies.readTargetStateFile(context.targetId);
              const currentState = currentStateFile.state;
              await dependencies.writeTargetState(context.targetId, {
                ...currentState,
                recoveryRequired: {
                  operation: "rollback",
                  error: recoveryError,
                  backupId: backup.id,
                  safetyBackupId:
                    restoreError instanceof BackupRecoveryError
                      ? restoreError.safetyBackupId
                      : undefined,
                  occurredAt: new Date().toISOString()
                }
              }, { expectedPathHash: currentStateFile.pathHash });
            } catch {
              // The backup remains the manual recovery path.
            }
          })
        );
        throw new Error(`${recoveryError}. Recovery required for backup ${backup.id}.`);
      }
      throw new Error(
        `Skill collection migration failed and was restored: ${errorMessage(error)}`
      );
    }

    return {
      backupId: backup.id,
      libraryId: "_collection",
      managedLocations: [normalizedCollectionPath, ...installedPaths],
      operation: "retire"
    };
  } finally {
    dependencies.releaseTargets(targetIds);
  }
};
