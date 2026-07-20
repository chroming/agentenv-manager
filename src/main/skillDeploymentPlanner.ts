import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { ProfileSkill } from "../shared/schemas";
import type {
  ProfileDetail,
  SharedSkillPreparation,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetPaths
} from "../shared/types";
import type { CaptureReceipt } from "./captureReceiptStore";

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
    | "matching-unmanaged"
    | "shared-compatible"
    | "external-exact"
    | "occupied";
}

export interface SkillDeploymentPlan {
  effectiveSkills: ProfileSkill[];
  approvedUnmanagedSkills: Array<{ path: string; contentHash: string }>;
  decisions: SkillDeploymentDecision[];
  sharedPreparations: SharedSkillPreparation[];
  sharedPaths: string[];
  errors: string[];
  warnings: string[];
}

export interface SkillDeploymentPlanInput {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  profileHash: string;
  skillLibrary: SkillLibraryEntry[];
  inventory: SkillInventoryEntry[];
  takeover: boolean;
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
    entry.libraryId === libraryId &&
    entry.contentMatchesLibrary === true &&
    entry.contentHash === currentLibraryHash
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
      legacyLocation: entry.legacyLocation ?? null,
      ignoreRuleId: entry.ignoreRuleId ?? null,
      ignoreReason: entry.ignoreReason ?? null,
      externalOwnership: entry.externalOwnership
        ? {
            manager: entry.externalOwnership.manager,
            canonicalPath: entry.externalOwnership.canonicalPath,
            confidence: entry.externalOwnership.confidence,
            state: entry.externalOwnership.state
          }
        : null
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return createHash("sha256").update(JSON.stringify(comparable)).digest("hex");
};

export const buildSkillDeploymentPlan = ({
  profile,
  targetPaths,
  profileHash,
  skillLibrary,
  inventory,
  takeover,
  captureReceipt
}: SkillDeploymentPlanInput): SkillDeploymentPlan => {
  const inventoryByPath = new Map(
    inventory.map((entry) => [resolve(entry.path), entry])
  );
  const libraryById = new Map(skillLibrary.map((skill) => [skill.id, skill]));
  const canonicalLibraryPaths = new Set(skillLibrary.map((skill) => resolve(skill.path)));
  const enabledReferences = profile.resources.skills.filter((reference) => reference.enabled);
  const deferredReferences = new Set<string>();
  const approvedSkills = new Map<string, string>();
  const decisions: SkillDeploymentDecision[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const sharedPaths = new Set<string>();
  const sharedPreparations: SharedSkillPreparation[] = [];
  const sharedBySkill = new Map<
    string,
    { skillKey: string; libraryId: string; paths: Set<string> }
  >();

  for (const entry of inventory) {
    if (
      !entry.sharedLocation ||
      !entry.libraryId ||
      entry.contentMatchesLibrary !== true ||
      entry.ignoreReason === "keep-shared" ||
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
    const exactUnmanaged = Boolean(
      reference &&
      occupyingItem &&
      !isTargetOwned(occupyingItem) &&
      occupyingItem.status !== "external" &&
      occupyingItem.status !== "ignored" &&
      (matchesCurrentLibrary(occupyingItem, shared.libraryId, currentLibraryHash) ||
        matchingCaptureCopy(
          captureReceipt,
          reference,
          occupyingItem,
          currentLibraryHash
        ))
    );
    const adoptTargetCopy = Boolean(reference && takeover && exactUnmanaged && targetPath);
    const keepManagedTargetCopy = Boolean(
      reference &&
      occupyingItem &&
      isTargetOwned(occupyingItem) &&
      occupyingItem.libraryId === shared.libraryId
    );

    if (
      occupyingItem?.status === "managed" &&
      occupyingItem.libraryId !== shared.libraryId
    ) {
      errors.push(
        `Cannot prepare shared Skill ${shared.skillKey}: ${targetPath} is managed as Library Skill ${occupyingItem.libraryId}.`
      );
      decisions.push({
        libraryId: shared.libraryId,
        targetName,
        path: targetPath,
        action: "block",
        reason: "occupied"
      });
      continue;
    }
    if (occupyingItem && !isTargetOwned(occupyingItem) && !adoptTargetCopy) {
      errors.push(
        `Cannot prepare shared Skill ${shared.skillKey}: ${targetPath} is occupied by a non-AgentEnv Skill.`
      );
      decisions.push({
        libraryId: shared.libraryId,
        targetName,
        path: targetPath,
        action: "block",
        reason: "occupied"
      });
      continue;
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
          : "matching-unmanaged"
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
    warnings.push(
      adoptTargetCopy
        ? `Shared Skill ${shared.skillKey} stays active from its compatibility directory; Apply will adopt the matching Agent copy before shared migration is completed.`
        : keepManagedTargetCopy
          ? `Shared Skill ${shared.skillKey} and its AgentEnv-managed Agent copy remain active until shared migration removes the compatibility copy.`
          : reference
            ? `Shared Skill ${shared.skillKey} stays active from its compatibility directory until shared migration installs the Agent-specific copy.`
            : `Shared Skill ${shared.skillKey} stays active until shared migration removes the compatibility copy; this Profile will omit it afterward.`
    );
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
    if (
      occupyingItem.status === "external" &&
      matchesCurrentLibrary(occupyingItem, reference.libraryId, currentLibraryHash)
    ) {
      decisions.push({
        libraryId: reference.libraryId,
        targetName: reference.targetName,
        path: targetPath,
        action: "preserve",
        reason: "external-exact"
      });
      continue;
    }
    const capturedExact = matchingCaptureCopy(
      captureReceipt,
      reference,
      occupyingItem,
      currentLibraryHash
    );
    const matchingUnmanaged = matchesCurrentLibrary(
      occupyingItem,
      reference.libraryId,
      currentLibraryHash
    );
    if (
      takeover &&
      occupyingItem.status !== "external" &&
      occupyingItem.status !== "ignored" &&
      (capturedExact || matchingUnmanaged)
    ) {
      approvedSkills.set(targetPath, occupyingItem.contentHash);
      decisions.push({
        libraryId: reference.libraryId,
        targetName: reference.targetName,
        path: targetPath,
        action: "adopt",
        reason: capturedExact ? "captured-exact" : "matching-unmanaged"
      });
      continue;
    }
    decisions.push({
      libraryId: reference.libraryId,
      targetName: reference.targetName,
      path: targetPath,
      action: "block",
      reason: "occupied"
    });
  }

  return {
    effectiveSkills: profile.resources.skills.filter(
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
    sharedPreparations: sharedPreparations.sort((left, right) =>
      left.skillKey.localeCompare(right.skillKey)
    ),
    sharedPaths: [...sharedPaths].sort(),
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)]
  };
};
