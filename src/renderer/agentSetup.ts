import type {
  ProfileSummary,
  TargetInfo,
  TargetManagementState
} from "../shared/types";

export type AgentSetupAction =
  | { kind: "review-current" }
  | {
      kind: "continue-profile" | "open-profile" | "repair-profile";
      profileId: string;
      profileName: string;
    };

const newestFirst = (left: ProfileSummary, right: ProfileSummary) =>
  (right.createdAt ?? "").localeCompare(left.createdAt ?? "");

export const deriveAgentSetupAction = (
  targetId: string,
  profiles: ProfileSummary[],
  targetStates: TargetManagementState[]
): AgentSetupAction => {
  const targetState = targetStates.find((state) => state.targetId === targetId);
  if (targetState?.activeProfileId) {
    const activeProfile = profiles.find(
      (profile) => profile.id === targetState.activeProfileId
    );
    return {
      kind: activeProfile?.loadError ? "repair-profile" : "open-profile",
      profileId: targetState.activeProfileId,
      profileName:
        activeProfile?.name ?? targetState.activeProfileName ?? targetState.activeProfileId
    };
  }

  const capturedProfile = profiles
    .filter(
      (profile) =>
        profile.createdFromTargetId === targetId && !profile.loadError
    )
    .sort(newestFirst)[0];
  if (capturedProfile) {
    return {
      kind: "continue-profile",
      profileId: capturedProfile.id,
      profileName: capturedProfile.name
    };
  }

  return { kind: "review-current" };
};

export const deriveAgentSetupActions = (
  targets: TargetInfo[],
  profiles: ProfileSummary[],
  targetStates: TargetManagementState[]
) => Object.fromEntries(
  targets.map((target) => [
    target.id,
    deriveAgentSetupAction(target.id, profiles, targetStates)
  ])
) as Record<string, AgentSetupAction>;
