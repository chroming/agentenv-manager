import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  ActivationPreview,
  SharedSkillPreparation,
  TargetPaths,
  TargetState
} from "../shared/types";
import { createUnifiedDiff } from "./diff";
import { redactSensitiveValues } from "./secretWarnings";
import { normalizeSkillReceipts } from "./skillReconciliationReceipts";
import type { InternalActivationPreview } from "./internalActivationPreview";
export type { InternalActivationPreview } from "./internalActivationPreview";

export const toPublicActivationPreview = (
  preview: InternalActivationPreview
): ActivationPreview => {
  const {
    targetStateFingerprint: _targetStateFingerprint,
    targetPathFingerprint: _targetPathFingerprint,
    assetBackupPaths: _assetBackupPaths,
    missingAssetDirectories: _missingAssetDirectories,
    legacyOwnershipMarkerPaths: _legacyOwnershipMarkerPaths,
    adoptedResourcePaths: _adoptedResourcePaths,
    legacyOwnedResourcePaths: _legacyOwnedResourcePaths,
    resourceManagement: _resourceManagement,
    skillDeployment: _skillDeployment,
    ...publicValue
  } = preview;
  return {
    ...publicValue,
    issues: preview.issues.map((issue) => ({
      ...issue,
      message: redactSensitiveValues(issue.message),
      detail: issue.detail ? redactSensitiveValues(issue.detail) : undefined
    })),
    changes: preview.changes.map((change) => {
      const before = redactSensitiveValues(change.before);
      const after = redactSensitiveValues(change.after);
      return {
        ...change,
        before,
        after,
        diff: createUnifiedDiff(change.path, before, after)
      };
    })
  };
};

const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

export const fingerprintTargetPaths = (targetPaths: TargetPaths) =>
  hashText(JSON.stringify({
    targetId: targetPaths.targetId,
    configDir: resolve(targetPaths.configDir),
    runtimeDir: targetPaths.runtimeDir ? resolve(targetPaths.runtimeDir) : undefined,
    instructionsPath: resolve(targetPaths.instructionsPath),
    instructionsOverridePath: targetPaths.instructionsOverridePath
      ? resolve(targetPaths.instructionsOverridePath)
      : undefined,
    configPath: resolve(targetPaths.configPath),
    mcpConfigPath: targetPaths.mcpConfigPath ? resolve(targetPaths.mcpConfigPath) : undefined,
    agentsDir: targetPaths.agentsDir ? resolve(targetPaths.agentsDir) : undefined,
    skillsDir: targetPaths.skillsDir ? resolve(targetPaths.skillsDir) : undefined,
    skillLocations: (targetPaths.skillLocations ?? [])
      .map((location) => ({
        path: resolve(location.path),
        role: location.role,
        shared: location.shared,
        sharedLocationId: location.sharedLocationId,
        management: location.management
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  }));

export const normalizeSharedSkillPreparations = (
  preparations: readonly SharedSkillPreparation[] = []
) => preparations
  .map((preparation) => ({
    ...preparation,
    sharedPaths: [...new Set(preparation.sharedPaths.map((path) => resolve(path)))].sort()
  }))
  .sort(
    (left, right) =>
      left.skillKey.localeCompare(right.skillKey) ||
      left.libraryId.localeCompare(right.libraryId) ||
      left.targetName.localeCompare(right.targetName) ||
      left.disposition.localeCompare(right.disposition) ||
      left.profileId.localeCompare(right.profileId) ||
      left.profileHash.localeCompare(right.profileHash)
  );

export const sharedSkillPreparationsEqual = (
  left: readonly SharedSkillPreparation[] = [],
  right: readonly SharedSkillPreparation[] = []
) => JSON.stringify(normalizeSharedSkillPreparations(left)) ===
  JSON.stringify(normalizeSharedSkillPreparations(right));

export const fingerprintTargetState = (state: TargetState): string => {
  const managedResources = [...(state.managedResources ?? [])]
    .map((resource) => ({ ...resource, path: resolve(resource.path) }))
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id)
    );
  const appliedSkillVersions = Object.fromEntries(
    Object.entries(state.appliedLibraryVersions?.skills ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  return hashText(JSON.stringify({
    activeProfileId: state.activeProfileId ?? null,
    appliedProfileHash: state.appliedProfileHash ?? null,
    appliedProfileSnapshot: state.appliedProfileSnapshot
      ? {
          profileId: state.appliedProfileSnapshot.profileId,
          capturedAt: state.appliedProfileSnapshot.capturedAt,
          contentHash: state.appliedProfileSnapshot.contentHash,
          snapshotHash: state.appliedProfileSnapshot.snapshotHash
        }
      : null,
    appliedLibraryVersions: { skills: appliedSkillVersions },
    managedMcpNames: [...new Set(state.managedMcpNames)].sort(),
    managedResources,
    skillReceipts: normalizeSkillReceipts(state.skillReceipts),
    sharedSkillPreparations: normalizeSharedSkillPreparations(state.sharedSkillPreparations),
    recoveryRequired: state.recoveryRequired ?? null
  }));
};
