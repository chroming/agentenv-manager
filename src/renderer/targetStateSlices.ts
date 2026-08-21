import type { TargetInfo, TargetManagementState } from "../shared/types";

export const isRemoteTargetId = (targetId: string) => targetId.startsWith("ssh:");

export const mergeLocalTargetStates = (
  current: TargetManagementState[],
  local: TargetManagementState[]
) => [
  ...local,
  ...current.filter((state) => isRemoteTargetId(state.targetId))
];

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
