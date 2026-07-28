import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { ProfileSkill } from "../shared/schemas";
import { normalizeSkillKey } from "../shared/skillIdentity";
import { profileManagesResource } from "../shared/profileResources";
import type {
  ApplyIssue,
  ProfileDetail,
  SharedSkillPreparation,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetPaths
} from "../shared/types";
import type { CaptureReceipt } from "./captureReceiptStore";
import { createApplyIssue, dedupeApplyIssues } from "./applyIssues";

export type SkillDeploymentDecisionAction =
  | "install"
  | "preserve"
  | "adopt"
  | "replace"
  | "defer"
  | "block";

export interface SkillDeploymentDecision {
  libraryId: string;
  targetName: string;
  path?: string;
  action: SkillDeploymentDecisionAction;
  reason:
    | "target-missing"
    | "managed-exact"
    | "managed-changed"
    | "captured-exact"
    | "matching-outside"
    | "shared-compatible"
    | "kept-outside"
    | "occupied";
}

export interface SkillDeploymentPlan {
  effectiveSkills: ProfileSkill[];
  approvedUnmanagedSkills: Array<{ path: string; contentHash: string }>;
  decisions: SkillDeploymentDecision[];
  sharedPreparations: SharedSkillPreparation[];
  sharedPaths: string[];
  removalPaths: string[];
  issues: ApplyIssue[];
}

export interface SkillDeploymentPlanInput {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  profileHash: string;
  skillLibrary: SkillLibraryEntry[];
  inventory: SkillInventoryEntry[];
  captureReceipt?: CaptureReceipt;
}

const referenceKey = (reference: Pick<ProfileSkill, "libraryId" | "targetName">) =>
  `${reference.libraryId}:${reference.targetName}`;

const isTargetOwned = (entry: SkillInventoryEntry) =>
  entry.status === "managed" && entry.managedByTarget === true;

const matchingCaptureCopy = (
  receipt: CaptureReceipt | undefined,
  reference: ProfileSkill,
  entry: SkillInventoryEntry,
  currentLibraryHash: string | undefined
) =>
  Boolean(
    currentLibraryHash &&
    entry.contentHash === currentLibraryHash &&
    receipt?.skills.some(
      (skill) =>
        skill.libraryId === reference.libraryId &&
        skill.targetName === reference.targetName &&
        skill.copies.some(
          (copy) =>
            resolve(copy.path) === resolve(entry.path) &&
            copy.contentHash === entry.contentHash
        )
    )
  );

const matchesCurrentLibrary = (
  entry: SkillInventoryEntry,
  libraryId: string,
  currentLibraryHash: string | undefined
) =>
  Boolean(
    currentLibraryHash &&
    entry.contentHash === currentLibraryHash &&
    (entry.libraryId === libraryId || entry.libraryId === undefined)
  );

export const fingerprintSkillInventory = (inventory: SkillInventoryEntry[]): string => {
  const comparable = inventory
    .map((entry) => ({
      path: resolve(entry.path),
      status: entry.status,
      libraryId: entry.libraryId ?? null,
      skillKey: entry.skillKey,
      runtimeName: entry.runtimeName ?? null,
      deploymentName: entry.deploymentName ?? null,
      runtimeOwner: entry.runtimeOwner ?? null,
      managedByTarget: entry.managedByTarget ?? null,
      runtimeAvailability: entry.runtimeAvailability ?? null,
      contentHash: entry.contentHash,
      contentMatchesLibrary: entry.contentMatchesLibrary ?? null,
      locationRole: entry.locationRole ?? null,
      sharedLocation: entry.sharedLocation ?? null,
      sharedLocationId: entry.sharedLocationId ?? null,
      legacyLocation: entry.legacyLocation ?? null,
      pathPolicyId: entry.pathPolicyId ?? null,
      pathPolicy: entry.pathPolicy ?? null,
      locationManagement: entry.locationManagement ?? null
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return createHash("sha256").update(JSON.stringify(comparable)).digest("hex");
};

export const deploymentRelevantSkillInventory = ({
  inventory,
  profile,
  skillLibrary,
  targetPaths
}: {
  inventory: SkillInventoryEntry[];
  profile: ProfileDetail;
  skillLibrary: SkillLibraryEntry[];
  targetPaths: TargetPaths;
}) => {
  const libraryById = new Map(skillLibrary.map((skill) => [skill.id, skill]));
  const profileLibraryIds = new Set(
    profile.resources.skills.map((reference) => reference.libraryId)
  );
  const profileDeploymentNames = new Set(
    profile.resources.skills.map((reference) => normalizeSkillKey(reference.targetName))
  );
  const desiredRuntimeNames = new Set(
    profile.resources.skills
      .filter((reference) => reference.enabled)
      .map((reference) =>
        normalizeSkillKey(
          libraryById.get(reference.libraryId)?.name ?? reference.targetName
        )
      )
  );
  const exactTargetPaths = new Set(
    targetPaths.skillsDir
      ? profile.resources.skills.map((reference) =>
          resolve(join(targetPaths.skillsDir as string, reference.targetName))
        )
      : []
  );

  return inventory.filter((entry) => {
    const path = resolve(entry.path);
    if (exactTargetPaths.has(path)) return true;
    if (entry.managedByTarget === true) return true;
    if (
      entry.sharedLocation &&
      entry.libraryId &&
      entry.contentMatchesLibrary === true &&
      entry.pathPolicy !== "keep-shared"
    ) {
      return true;
    }
    if (entry.libraryId && profileLibraryIds.has(entry.libraryId)) return true;
    if (
      profileDeploymentNames.has(
        normalizeSkillKey(entry.deploymentName ?? entry.id)
      )
    ) {
      return true;
    }
    return (
      entry.locationRole !== "discovery-only" &&
      entry.runtimeAvailability !== "disabled" &&
      desiredRuntimeNames.has(normalizeSkillKey(entry.runtimeName ?? entry.name))
    );
  });
};

export const fingerprintSkillDeploymentFacts = (
  input: Parameters<typeof deploymentRelevantSkillInventory>[0]
) => fingerprintSkillInventory(deploymentRelevantSkillInventory(input));

export const buildSkillDeploymentPlan = ({
  profile,
  targetPaths,
  profileHash,
  skillLibrary,
  inventory,
  captureReceipt
}: SkillDeploymentPlanInput): SkillDeploymentPlan => {
  if (!profileManagesResource(profile.resources, targetPaths.targetId, "skills")) {
    return {
      effectiveSkills: profile.resources.skills,
      approvedUnmanagedSkills: [],
      decisions: [],
      sharedPreparations: [],
      sharedPaths: [],
      removalPaths: [],
      issues: []
    };
  }
  const inventoryByPath = new Map(
    inventory.map((entry) => [resolve(entry.path), entry])
  );
  const libraryById = new Map(skillLibrary.map((skill) => [skill.id, skill]));
  const canonicalLibraryPaths = new Set(skillLibrary.map((skill) => resolve(skill.path)));
  const enabledReferences = profile.resources.skills.filter((reference) => reference.enabled);
  const deferredReferences = new Set<string>();
  const syntheticDisabledReferences: ProfileSkill[] = [];
  const approvedSkills = new Map<string, string>();
  const decisions: SkillDeploymentDecision[] = [];
  const issues: ApplyIssue[] = [];
  const sharedPaths = new Set<string>();
  const removalPaths = new Set<string>();
  const sharedPreparations: SharedSkillPreparation[] = [];
  const sharedBySkill = new Map<
    string,
    { skillKey: string; libraryId: string; paths: Set<string> }
  >();

  for (const entry of inventory) {
    if (!entry.sharedLocation || entry.pathPolicy !== "keep-shared") continue;
    const runtimeKeys = new Set(
      [
        entry.skillKey,
        entry.runtimeName,
        entry.deploymentName,
        entry.id,
        entry.name
      ]
        .filter((value): value is string => Boolean(value))
        .map(normalizeSkillKey)
    );
    const reference = profile.resources.skills.find(
      (item) =>
        item.libraryId === entry.libraryId ||
        runtimeKeys.has(normalizeSkillKey(item.targetName)) ||
        runtimeKeys.has(normalizeSkillKey(libraryById.get(item.libraryId)?.name ?? ""))
    );
    if (reference) {
      deferredReferences.add(referenceKey(reference));
    }
    decisions.push({
      libraryId: reference?.libraryId ?? entry.libraryId ?? entry.id,
      targetName: reference?.targetName ?? entry.deploymentName ?? entry.id,
      path: entry.path,
      action: "preserve",
      reason: "kept-outside"
    });
    issues.push(createApplyIssue({
      code: "kept-outside-skill",
      resourceKind: "skill",
      resourceId: entry.runtimeName ?? entry.id,
      path: entry.path,
      message: `${entry.runtimeName ?? entry.id} stays active from its shared compatibility path`
    }));
  }

  for (const entry of inventory) {
    if (
      !entry.sharedLocation ||
      !entry.libraryId ||
      entry.contentMatchesLibrary !== true ||
      entry.pathPolicy === "keep-shared" ||
      canonicalLibraryPaths.has(resolve(entry.path))
    ) {
      continue;
    }
    const key = `${entry.skillKey}:${entry.libraryId}`;
    const group = sharedBySkill.get(key) ?? {
      skillKey: entry.skillKey,
      libraryId: entry.libraryId,
      paths: new Set<string>()
    };
    group.paths.add(resolve(entry.path));
    sharedBySkill.set(key, group);
  }

  for (const shared of sharedBySkill.values()) {
    const reference = enabledReferences.find(
      (item) => item.libraryId === shared.libraryId
    );
    const targetName = reference?.targetName ?? shared.libraryId;
    const targetPath = targetPaths.skillsDir
      ? resolve(join(targetPaths.skillsDir, targetName))
      : undefined;
    const occupyingItem = targetPath ? inventoryByPath.get(targetPath) : undefined;
    const currentLibraryHash = libraryById.get(shared.libraryId)?.contentHash;
    const exactOutside = Boolean(
      reference &&
      occupyingItem &&
      !isTargetOwned(occupyingItem) &&
      occupyingItem.status !== "kept-outside" &&
      (matchesCurrentLibrary(occupyingItem, shared.libraryId, currentLibraryHash) ||
        matchingCaptureCopy(
          captureReceipt,
          reference,
          occupyingItem,
          currentLibraryHash
        ))
    );
    const adoptTargetCopy = Boolean(reference && exactOutside && targetPath);
    const keepManagedTargetCopy = Boolean(
      reference &&
      occupyingItem &&
      isTargetOwned(occupyingItem) &&
      occupyingItem.libraryId === shared.libraryId
    );
    const replaceManagedTargetCopy = Boolean(
      reference &&
      occupyingItem &&
      isTargetOwned(occupyingItem) &&
      occupyingItem.libraryId !== shared.libraryId
    );
    const replaceTargetCopy = Boolean(
      reference &&
      occupyingItem &&
      !isTargetOwned(occupyingItem) &&
      occupyingItem.status !== "kept-outside" &&
      !adoptTargetCopy &&
      targetPath
    );

    if (
      occupyingItem &&
      !isTargetOwned(occupyingItem) &&
      !adoptTargetCopy &&
      !replaceTargetCopy
    ) {
      issues.push(createApplyIssue({
        code: "kept-outside-skill",
        resourceKind: "skill",
        resourceId: shared.skillKey,
        path: targetPath,
        message: `${shared.skillKey} stays outside AgentEnv on ${targetPaths.targetId}`
      }));
      decisions.push({
        libraryId: shared.libraryId,
        targetName,
        path: targetPath,
        action: "preserve",
        reason: "kept-outside"
      });
      if (reference) deferredReferences.add(referenceKey(reference));
      continue;
    }

    if (replaceTargetCopy && targetPath) {
      issues.push(createApplyIssue({
        code: "outside-skill-replacement",
        resourceKind: "skill",
        resourceId: shared.skillKey,
        path: targetPath,
        message: `Existing Skill ${shared.skillKey} will be backed up and brought under AgentEnv`
      }));
    }

    const groupPaths = [...shared.paths].sort();
    groupPaths.forEach((path) => sharedPaths.add(path));
    sharedPreparations.push({
      skillKey: shared.skillKey,
      libraryId: shared.libraryId,
      sharedPaths: groupPaths,
      targetName,
      disposition: reference ? "install" : "omit",
      profileId: profile.id,
      profileHash
    });

    if (adoptTargetCopy && targetPath && occupyingItem && reference) {
      approvedSkills.set(targetPath, occupyingItem.contentHash);
      decisions.push({
        libraryId: shared.libraryId,
        targetName,
        path: targetPath,
        action: "adopt",
        reason: matchingCaptureCopy(
          captureReceipt,
          reference,
          occupyingItem,
          currentLibraryHash
        )
          ? "captured-exact"
          : "matching-outside"
      });
    } else if (keepManagedTargetCopy && targetPath && occupyingItem) {
      const exact = matchesCurrentLibrary(
        occupyingItem,
        shared.libraryId,
        currentLibraryHash
      );
      decisions.push({
        libraryId: shared.libraryId,
        targetName,
        path: targetPath,
        action: exact ? "preserve" : "replace",
        reason: exact ? "managed-exact" : "managed-changed"
      });
    } else if (replaceTargetCopy && targetPath) {
      decisions.push({
        libraryId: shared.libraryId,
        targetName,
        path: targetPath,
        action: "replace",
        reason: "occupied"
      });
    } else if (replaceManagedTargetCopy && targetPath) {
      decisions.push({
        libraryId: shared.libraryId,
        targetName,
        path: targetPath,
        action: "replace",
        reason: "occupied"
      });
    } else {
      if (reference) deferredReferences.add(referenceKey(reference));
      decisions.push({
        libraryId: shared.libraryId,
        targetName,
        path: groupPaths[0],
        action: "defer",
        reason: "shared-compatible"
      });
    }
    const message = adoptTargetCopy
        ? `Shared Skill ${shared.skillKey} stays active from its compatibility directory; Apply will adopt the matching Agent copy before shared migration is completed.`
        : keepManagedTargetCopy
          ? `Shared Skill ${shared.skillKey} and its AgentEnv-managed Agent copy remain active until shared migration removes the compatibility copy.`
          : replaceTargetCopy
            ? `Shared Skill ${shared.skillKey} stays active from its compatibility directory while Apply replaces the Agent copy.`
          : replaceManagedTargetCopy
            ? `Shared Skill ${shared.skillKey} stays active while Apply switches the Agent copy to this Library Skill.`
          : reference
            ? `Shared Skill ${shared.skillKey} stays active from its compatibility directory until shared migration installs the Agent-specific copy.`
            : `Shared Skill ${shared.skillKey} stays active until shared migration removes the compatibility copy; this Profile will omit it afterward.`;
    issues.push(createApplyIssue({
      code: "shared-skill-deferred",
      resourceKind: "skill",
      resourceId: shared.skillKey,
      path: groupPaths[0],
      message
    }));
  }

  for (const reference of enabledReferences) {
    if (deferredReferences.has(referenceKey(reference)) || !targetPaths.skillsDir) continue;
    if (
      decisions.some(
        (decision) =>
          decision.libraryId === reference.libraryId &&
          decision.targetName === reference.targetName
      )
    ) {
      continue;
    }
    const targetPath = resolve(join(targetPaths.skillsDir, reference.targetName));
    const occupyingItem = inventoryByPath.get(targetPath);
    const currentLibraryHash = libraryById.get(reference.libraryId)?.contentHash;
    if (!occupyingItem) {
      decisions.push({
        libraryId: reference.libraryId,
        targetName: reference.targetName,
        path: targetPath,
        action: "install",
        reason: "target-missing"
      });
      continue;
    }
    if (isTargetOwned(occupyingItem)) {
      const exact = matchesCurrentLibrary(
        occupyingItem,
        reference.libraryId,
        currentLibraryHash
      );
      decisions.push({
        libraryId: reference.libraryId,
        targetName: reference.targetName,
        path: targetPath,
        action: exact ? "preserve" : "replace",
        reason: exact ? "managed-exact" : "managed-changed"
      });
      continue;
    }
    if (occupyingItem.status === "kept-outside") {
      deferredReferences.add(referenceKey(reference));
      decisions.push({
        libraryId: reference.libraryId,
        targetName: reference.targetName,
        path: targetPath,
        action: "preserve",
        reason: "kept-outside"
      });
      issues.push(createApplyIssue({
        code: "kept-outside-skill",
        resourceKind: "skill",
        resourceId: reference.targetName,
        path: targetPath,
        message: `${reference.targetName} stays outside AgentEnv on ${targetPaths.targetId}`
      }));
      continue;
    }
    const capturedExact = matchingCaptureCopy(
      captureReceipt,
      reference,
      occupyingItem,
      currentLibraryHash
    );
    const matchingOutside = matchesCurrentLibrary(
      occupyingItem,
      reference.libraryId,
      currentLibraryHash
    );
    if (capturedExact || matchingOutside) {
      approvedSkills.set(targetPath, occupyingItem.contentHash);
      decisions.push({
        libraryId: reference.libraryId,
        targetName: reference.targetName,
        path: targetPath,
        action: "adopt",
        reason: capturedExact ? "captured-exact" : "matching-outside"
      });
      continue;
    }
    issues.push(createApplyIssue({
      code: "outside-skill-replacement",
      resourceKind: "skill",
      resourceId: reference.targetName,
      path: targetPath,
      message: `Existing Skill ${reference.targetName} will be backed up and brought under AgentEnv`,
      detail: occupyingItem.externalEvidence
        ? `AgentEnv found ${occupyingItem.externalEvidence.displayName ?? occupyingItem.externalEvidence.manager} metadata. This is evidence only; the destination path is still eligible for takeover.`
        : undefined
    }));
    decisions.push({
      libraryId: reference.libraryId,
      targetName: reference.targetName,
      path: targetPath,
      action: "replace",
      reason: "occupied"
    });
  }

  if (targetPaths.skillsDir) {
    for (const reference of profile.resources.skills.filter((item) => !item.enabled)) {
      const targetPath = resolve(join(targetPaths.skillsDir, reference.targetName));
      const occupyingItem = inventoryByPath.get(targetPath);
      if (!occupyingItem) continue;
      if (occupyingItem.status === "kept-outside") {
        deferredReferences.add(referenceKey(reference));
        decisions.push({
          libraryId: reference.libraryId,
          targetName: reference.targetName,
          path: targetPath,
          action: "preserve",
          reason: "kept-outside"
        });
        issues.push(createApplyIssue({
          code: "kept-outside-skill",
          resourceKind: "skill",
          resourceId: reference.targetName,
          path: targetPath,
          message: `${reference.targetName} stays outside AgentEnv on ${targetPaths.targetId}`
        }));
      } else if (!isTargetOwned(occupyingItem)) {
        issues.push(createApplyIssue({
          code: "outside-skill-removal",
          resourceKind: "skill",
          resourceId: reference.targetName,
          path: targetPath,
          message: `${reference.targetName} is disabled in this Profile and will be backed up and removed`
        }));
      }
    }

    const desiredTargetPaths = new Set(
      profile.resources.skills.map((reference) =>
        resolve(join(targetPaths.skillsDir as string, reference.targetName))
      )
    );
    const controllableRoots = new Set([
      resolve(targetPaths.skillsDir),
      ...(targetPaths.skillLocations ?? [])
        .filter(
          (location) =>
            location.management === "managed" &&
            location.shared !== true &&
            location.role !== "discovery-only"
        )
        .map((location) => resolve(location.path))
    ]);
    for (const item of inventory) {
      if (
        !controllableRoots.has(dirname(resolve(item.path))) ||
        item.locationRole === "discovery-only" ||
        desiredTargetPaths.has(resolve(item.path))
      ) {
        continue;
      }
      if (item.status === "kept-outside") {
        decisions.push({
          libraryId: item.libraryId ?? item.id,
          targetName: item.deploymentName ?? item.id,
          path: item.path,
          action: "preserve",
          reason: "kept-outside"
        });
        issues.push(createApplyIssue({
          code: "kept-outside-skill",
          resourceKind: "skill",
          resourceId: item.runtimeName ?? item.id,
          path: item.path,
          message: `${item.runtimeName ?? item.id} is not in this Profile and stays outside AgentEnv`
        }));
        continue;
      }
      const libraryId = item.libraryId ?? item.id;
      const targetName = item.deploymentName ?? item.id;
      if (dirname(resolve(item.path)) === resolve(targetPaths.skillsDir)) {
        syntheticDisabledReferences.push({
          libraryId,
          targetName,
          enabled: false
        });
      } else {
        removalPaths.add(resolve(item.path));
      }
      if (!isTargetOwned(item)) {
        issues.push(createApplyIssue({
          code: "outside-skill-removal",
          resourceKind: "skill",
          resourceId: item.runtimeName ?? item.id,
          path: item.path,
          message: `${item.runtimeName ?? item.id} is not in this Profile and will be backed up and removed`
        }));
      }
    }
  }

  return {
    effectiveSkills: [...profile.resources.skills, ...syntheticDisabledReferences].filter(
      (reference) => !deferredReferences.has(referenceKey(reference))
    ),
    approvedUnmanagedSkills: [...approvedSkills]
      .map(([path, contentHash]) => ({ path, contentHash }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    decisions: decisions.sort((left, right) =>
      `${left.libraryId}:${left.targetName}`.localeCompare(
        `${right.libraryId}:${right.targetName}`
      )
    ),
    sharedPreparations: sharedPreparations.sort(
      (left, right) =>
        left.skillKey.localeCompare(right.skillKey) ||
        left.libraryId.localeCompare(right.libraryId) ||
        left.targetName.localeCompare(right.targetName) ||
        left.disposition.localeCompare(right.disposition)
    ),
    sharedPaths: [...sharedPaths].sort(),
    removalPaths: [...removalPaths].sort(),
    issues: dedupeApplyIssues(issues)
  };
};
