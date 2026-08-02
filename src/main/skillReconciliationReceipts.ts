import { join, resolve } from "node:path";
import {
  reconcileSkill,
  toAppliedSkillReceipt
} from "../shared/skillReconciliation";
import type {
  AppliedSkillReceipt,
  ProfileDetail,
  SkillInventoryEntry,
  TargetPaths
} from "../shared/types";
import type { SkillDeploymentPlan } from "./skillDeploymentPlanner";

export const normalizeSkillReceipts = (
  entries: readonly AppliedSkillReceipt[] = []
) =>
  entries
    .map((entry) => ({
      ...entry,
      path: entry.path ? resolve(entry.path) : undefined
    }))
    .sort(
      (left, right) =>
        (left.path ?? "").localeCompare(right.path ?? "") ||
        left.libraryId.localeCompare(right.libraryId) ||
        left.targetName.localeCompare(right.targetName) ||
        left.desired.localeCompare(right.desired)
    );

export const skillReceiptsEqual = (
  left: readonly AppliedSkillReceipt[] = [],
  right: readonly AppliedSkillReceipt[] = []
) =>
  JSON.stringify(
    normalizeSkillReceipts(left).map((receipt) => ({
      ...receipt,
      contentHash: undefined
    }))
  ) ===
  JSON.stringify(
    normalizeSkillReceipts(right).map((receipt) => ({
      ...receipt,
      contentHash: undefined
    }))
  );

export const skillReceiptsFor = ({
  profile,
  targetPaths,
  inventory,
  decisions
}: {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  inventory: SkillInventoryEntry[];
  decisions: SkillDeploymentPlan["decisions"];
}): AppliedSkillReceipt[] => {
  const inventoryByPath = new Map(
    inventory.map((entry) => [resolve(entry.path), entry])
  );
  const matchedPaths = new Set<string>();
  const results = profile.resources.skills.map((reference) => {
    const decision = decisions.find(
      (item) =>
        item.libraryId === reference.libraryId &&
        item.targetName === reference.targetName
    );
    const targetPath =
      decision?.path ??
      (targetPaths.skillsDir
        ? join(targetPaths.skillsDir, reference.targetName)
        : undefined);
    const observation = targetPath
      ? inventoryByPath.get(resolve(targetPath))
      : undefined;
    if (observation) matchedPaths.add(resolve(observation.path));
    return toAppliedSkillReceipt(
      reconcileSkill({
        libraryId: reference.libraryId,
        targetName: reference.targetName,
        targetPath,
        desired: reference.enabled ? "install" : "omit",
        observation,
        unmanagedLocation:
          observation?.status === "left-unmanaged" &&
          observation.unmanagedLocationId
            ? {
                id: observation.unmanagedLocationId,
                path: observation.path,
                targetId: observation.sharedLocation
                  ? undefined
                  : targetPaths.targetId,
                coverage: observation.unmanagedCoverage ?? "exact",
                createdAt: "",
                updatedAt: ""
              }
            : undefined
      })
    );
  });

  for (const observation of inventory) {
    if (
      observation.status !== "left-unmanaged" ||
      matchedPaths.has(resolve(observation.path))
    ) {
      continue;
    }
    results.push(
      toAppliedSkillReceipt(
        reconcileSkill({
          libraryId: observation.libraryId ?? observation.id,
          targetName: observation.deploymentName ?? observation.id,
          targetPath: observation.path,
          desired: "omit",
          observation,
          unmanagedLocation: observation.unmanagedLocationId
            ? {
                id: observation.unmanagedLocationId,
                path: observation.path,
                targetId: observation.sharedLocation
                  ? undefined
                  : targetPaths.targetId,
                coverage: observation.unmanagedCoverage ?? "exact",
                createdAt: "",
                updatedAt: ""
              }
            : undefined
        })
      )
    );
  }
  return normalizeSkillReceipts(results);
};
