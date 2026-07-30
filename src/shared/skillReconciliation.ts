import type {
  SkillDesiredState,
  SkillInventoryEntry,
  SkillObservedState,
  SkillReconciliationResult,
  UnmanagedSkillLocation
} from "./types";

export interface ReconcileSkillInput {
  libraryId: string;
  targetName: string;
  targetPath?: string;
  desired: SkillDesiredState;
  observation?: SkillInventoryEntry;
  unmanagedLocation?: UnmanagedSkillLocation;
}

const observedState = (
  observation: SkillInventoryEntry | undefined
): SkillObservedState => {
  if (!observation) return "missing";
  if (
    observation.runtimeIssues?.some(
      (issue) => issue.code === "unreadable-skill"
    )
  ) {
    return "unavailable";
  }
  return observation.status === "managed" && observation.managedByTarget === true
    ? "managed"
    : "external";
};

export const reconcileSkill = ({
  libraryId,
  targetName,
  targetPath,
  desired,
  observation,
  unmanagedLocation
}: ReconcileSkillInput): SkillReconciliationResult => {
  const observed = observedState(observation);
  const unmanaged =
    Boolean(unmanagedLocation) &&
    (observed === "external" || observed === "unavailable");
  const base = {
    libraryId,
    targetName,
    path: observation?.path ?? targetPath,
    desired,
    observed,
    authority: unmanaged
      ? "leave-unmanaged" as const
      : "agentenv" as const,
    policyId: unmanaged ? unmanagedLocation?.id : undefined,
    contentHash: observation?.contentHash || undefined
  };

  if (unmanaged) {
    return {
      ...base,
      action: "preserve",
      outcome: desired === "install" ? "external-active" : "external-remains",
      requiresReview: false,
      localOverride: true
    };
  }

  if (desired === "omit") {
    if (observed === "missing") {
      return {
        ...base,
        action: "none",
        outcome: "absent",
        requiresReview: false,
        localOverride: false
      };
    }
    return {
      ...base,
      action: "remove",
      outcome: "absent",
      requiresReview: observed !== "managed",
      localOverride: false
    };
  }

  if (observed === "missing") {
    return {
      ...base,
      action: "install",
      outcome: "managed-active",
      requiresReview: false,
      localOverride: false
    };
  }

  if (observed === "managed") {
    const exact = observation?.contentMatchesLibrary === true;
    return {
      ...base,
      action: exact ? "none" : "replace",
      outcome: "managed-active",
      requiresReview: !exact,
      localOverride: false
    };
  }

  const exact = observation?.contentMatchesLibrary === true;
  return {
    ...base,
    action: exact ? "adopt" : "replace",
    outcome: "managed-active",
    requiresReview: !exact,
    localOverride: false
  };
};

export const toAppliedSkillReceipt = (
  result: SkillReconciliationResult
) => ({
  libraryId: result.libraryId,
  targetName: result.targetName,
  path: result.path,
  desired: result.desired,
  observed:
    result.outcome === "managed-active"
      ? "managed" as const
      : result.outcome === "absent"
        ? "missing" as const
        : result.observed,
  authority: result.authority,
  action: result.localOverride ? "preserve" as const : "none" as const,
  outcome: result.outcome,
  requiresReview: false,
  localOverride: result.localOverride,
  policyId: result.policyId,
  contentHash: result.contentHash
});
