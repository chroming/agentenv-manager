import type { ProfileSummary, TargetInfo, TargetManagementState } from "../shared/types";

export const isRemoteTargetId = (targetId: string) => targetId.startsWith("ssh:");

export const mergeLocalTargetStates = (
  current: TargetManagementState[],
  local: TargetManagementState[]
) => [
  ...local,
  ...current.filter((state) => isRemoteTargetId(state.targetId))
];

export const mergeLocalTargetStatesWithProfiles = (
  current: TargetManagementState[],
  local: TargetManagementState[],
  profiles: ProfileSummary[]
) => mergeLocalTargetStates(current, local.map((state) => ({
  ...state,
  activeProfileName: profiles.find((profile) => profile.id === state.activeProfileId)?.name ??
    state.activeProfileName
})));

export const mergeRemoteTargetStates = (
  current: TargetManagementState[],
  remote: TargetManagementState[]
) => [
  ...current.filter((state) => !isRemoteTargetId(state.targetId)),
  ...remote
];

export const preserveSelectedTarget = (
  current: string | undefined,
  localTargets: TargetInfo[]
) => current && (
  isRemoteTargetId(current) || localTargets.some((target) => target.id === current)
)
  ? current
  : localTargets[0]?.id;
