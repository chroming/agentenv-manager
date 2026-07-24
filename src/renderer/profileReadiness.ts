import type {
  ApplyIssue,
  ActivationPreview,
  ProfileDetail,
  TargetInfo,
  TargetManagementState
} from "../shared/types";

export type ProfileReadinessStatus =
  | "no-profile"
  | "no-target"
  | "dirty"
  | "target-unavailable"
  | "validation-error"
  | "review-required"
  | "preview-error"
  | "apply-pending"
  | "applied"
  | "unmanaged"
  | "ready";

export interface ProfileReadiness {
  status: ProfileReadinessStatus;
  label: "No profile" | "No Agent" | "Unsaved" | "Agent unavailable" | "Needs review" | "Apply pending" | "Applied" | "Ready";
  message: string;
  remediationLabel?: "Open Agents" | "Save now" | "Open Recovery";
}

export interface ProfileReadinessInput {
  profile?: Pick<ProfileDetail, "id" | "contentHash">;
  target?: Pick<TargetInfo, "id" | "name" | "health">;
  targetState?: Pick<TargetManagementState, "status" | "lifecycleStatus" | "lifecycleReason" | "activeProfileId" | "appliedProfileHash" | "errorCount">;
  isDirty: boolean;
  localValidationErrors?: readonly string[];
  preview?: Pick<ActivationPreview, "issues">;
  dependenciesCurrent?: boolean;
}

export const hasManagedTargetDrift = (
  issues: readonly Pick<ApplyIssue, "code">[]
): boolean => issues.some((issue) => issue.code === "managed-resource-drift");

export const deriveProfileReadiness = ({
  profile,
  target,
  targetState,
  isDirty,
  localValidationErrors = [],
  preview,
  dependenciesCurrent
}: ProfileReadinessInput): ProfileReadiness => {
  if (!profile) {
    return {
      status: "no-profile",
      label: "No profile",
      message: "Create a profile to continue"
    };
  }

  if (!target) {
    return {
      status: "no-target",
      label: "No Agent",
      message: "Select an Agent to continue"
    };
  }

  if (isDirty) {
    return {
      status: "dirty",
      label: "Unsaved",
      message: "Save this profile before previewing changes",
      remediationLabel: "Save now"
    };
  }

  if (!target.health.canWrite) {
    return {
      status: "target-unavailable",
      label: "Agent unavailable",
      message: `${target.name} is unavailable`,
      remediationLabel: "Open Agents"
    };
  }

  if (localValidationErrors.length > 0) {
    return {
      status: "validation-error",
      label: "Needs review",
      message: "This profile has validation issues"
    };
  }

  if (preview?.issues.some((issue) => issue.disposition === "block")) {
    return {
      status: "preview-error",
      label: "Needs review",
      message: "Preview found blocking issues"
    };
  }

  if (preview?.issues.some((issue) => issue.disposition === "review")) {
    return {
      status: "review-required",
      label: "Needs review",
      message: "Preview includes changes that will be protected by a Backup"
    };
  }

  if (targetState?.status !== "managed") {
    return {
      status: "unmanaged",
      label: "Ready",
      message: `${target.name} is ready to take over`
    };
  }

  if (targetState.lifecycleStatus === "recovery-required") {
    return {
      status: "preview-error",
      label: "Needs review",
      message: `${target.name} requires recovery`,
      remediationLabel: "Open Recovery"
    };
  }

  if (targetState.lifecycleStatus === "drifted" || targetState.errorCount > 0) {
    return {
      status: "preview-error",
      label: "Needs review",
      message: `${target.name} changed outside AgentEnv`
    };
  }

  if (
    targetState.activeProfileId === profile.id &&
    (targetState.lifecycleStatus === "pending" ||
      dependenciesCurrent === false ||
      !targetState.appliedProfileHash ||
      targetState.appliedProfileHash !== profile.contentHash)
  ) {
    return {
      status: "apply-pending",
      label: "Apply pending",
      message: dependenciesCurrent === false
        ? `Library resources changed after this profile was applied to ${target.name}`
        : targetState.appliedProfileHash
          ? `Saved changes have not been applied to ${target.name}`
        : `${target.name} applied version is unknown; preview before continuing`
    };
  }

  if (
    targetState.activeProfileId === profile.id &&
    (targetState.lifecycleStatus === "applied" || !targetState.lifecycleStatus) &&
    Boolean(profile.contentHash) &&
    targetState.appliedProfileHash === profile.contentHash &&
    dependenciesCurrent !== false
  ) {
    return {
      status: "applied",
      label: "Applied",
      message: `${target.name} matches this profile`
    };
  }

  return {
    status: "ready",
    label: "Ready",
    message: `${target.name} is ready to preview and apply`
  };
};

export const deriveApplyActionLabel = (input: ProfileReadinessInput): string => {
  const { target, localValidationErrors = [], preview, targetState, isDirty } = input;
  if (!target) {
    return "Apply profile";
  }

  if (!target.health.canWrite || localValidationErrors.length > 0) {
    return `Review ${target.name} issues`;
  }

  if (isDirty) {
    return "Save profile first";
  }

  const readiness = deriveProfileReadiness(input);
  if (readiness.status === "applied") {
    return `Applied to ${target.name}`;
  }
  if (readiness.status === "preview-error" && (targetState?.errorCount ?? 0) > 0) {
    return `Review ${target.name} issues`;
  }

  return targetState?.status === "managed"
    ? `Preview & apply to ${target.name}`
    : `Take over ${target.name}`;
};
