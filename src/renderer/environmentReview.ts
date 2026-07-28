import {
  buildSkillCleanupGroups,
  type SkillCleanupPreparedTarget
} from "../shared/skillCleanup";
import type {
  ProfileSummary,
  SkillInventoryEntry,
  TargetManagementState
} from "../shared/types";

export type EnvironmentScanStatus = "checking" | "ready" | "error";

export type EnvironmentReviewState =
  | "checking"
  | "unavailable"
  | "shared-review"
  | "setup"
  | "agent-review"
  | "ready"
  | "no-agents";

export interface EnvironmentReviewSummary {
  state: EnvironmentReviewState;
  installedTargetIds: string[];
  installedAgentCount: number;
  usableProfileCount: number;
  sharedSkillCount: number;
  sharedAutomaticCount: number;
  sharedDecisionCount: number;
  affectedTargetIds: string[];
  attentionTargetIds: string[];
}

interface EnvironmentReviewInput {
  scanStatus: EnvironmentScanStatus;
  inventory: SkillInventoryEntry[];
  installedTargetIds: string[];
  profiles: ProfileSummary[];
  targetStates: TargetManagementState[];
  preparedTargetsBySkill?: Record<string, SkillCleanupPreparedTarget[]>;
}

const attentionLifecycleStatuses = new Set<
  TargetManagementState["lifecycleStatus"]
>(["pending", "drifted", "recovery-required", "applied-with-outside"]);

export const deriveEnvironmentReview = ({
  scanStatus,
  inventory,
  installedTargetIds,
  profiles,
  targetStates,
  preparedTargetsBySkill
}: EnvironmentReviewInput): EnvironmentReviewSummary => {
  const installedTargetSet = new Set(installedTargetIds);
  const usableProfileCount = profiles.filter((profile) => !profile.loadError).length;
  const sharedGroups = buildSkillCleanupGroups(inventory, {
    installedTargetIds,
    preparedTargetsBySkill
  }).filter(
    (group) =>
      Boolean(group.sharedMigration) && group.sharedMigration?.state !== "kept"
  );
  const affectedTargetIds = [
    ...new Set(
      sharedGroups.flatMap((group) => group.sharedMigration?.consumers ?? [])
    )
  ].sort();
  const attentionTargetIds = targetStates
    .filter(
      (target) =>
        installedTargetSet.has(target.targetId) &&
        attentionLifecycleStatuses.has(target.lifecycleStatus)
    )
    .map((target) => target.targetId)
    .sort();

  const summary: Omit<EnvironmentReviewSummary, "state"> = {
    installedTargetIds: [...installedTargetIds],
    installedAgentCount: installedTargetIds.length,
    usableProfileCount,
    sharedSkillCount: sharedGroups.length,
    sharedAutomaticCount: sharedGroups.filter(
      (group) => group.resolution === "automatic"
    ).length,
    sharedDecisionCount: sharedGroups.filter(
      (group) => group.resolution === "manual"
    ).length,
    affectedTargetIds,
    attentionTargetIds
  };

  if (scanStatus === "checking") {
    return { ...summary, state: "checking" };
  }
  if (scanStatus === "error") {
    return { ...summary, state: "unavailable" };
  }
  if (sharedGroups.length > 0) {
    return { ...summary, state: "shared-review" };
  }
  if (attentionTargetIds.length > 0) {
    return { ...summary, state: "agent-review" };
  }
  if (installedTargetIds.length === 0) {
    return { ...summary, state: "no-agents" };
  }
  if (usableProfileCount === 0) {
    return { ...summary, state: "setup" };
  }
  return { ...summary, state: "ready" };
};
