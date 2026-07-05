import type {
  ActivationPreview,
  ProfileDetail,
  TargetInfo,
  TargetManagementState
} from "../shared/types";

const MANAGED_DRIFT_PREFIX = "External changes detected in AgentEnv-managed";

export type ProfileReadinessStatus =
  | "no-profile"
  | "no-target"
  | "dirty"
  | "target-unavailable"
  | "validation-error"
  | "preview-error"
  | "apply-pending"
  | "applied"
  | "unmanaged"
  | "ready";

export interface ProfileReadiness {
  status: ProfileReadinessStatus;
  label: "No profile" | "No target" | "Unsaved" | "Target unavailable" | "Needs review" | "Apply pending" | "Applied" | "Ready";
  message: string;
  remediationLabel?: "Open Targets" | "Save now" | "Review Advanced" | "Review preview";
}

export interface ProfileReadinessInput {
  profile?: Pick<ProfileDetail, "id" | "contentHash">;
  target?: Pick<TargetInfo, "id" | "name" | "health">;
  targetState?: Pick<TargetManagementState, "status" | "lifecycleStatus" | "lifecycleReason" | "activeProfileId" | "appliedProfileHash" | "errorCount">;
  isDirty: boolean;
  localValidationErrors?: readonly string[];
  preview?: Pick<ActivationPreview, "errors">;
  dependenciesCurrent?: boolean;
}

export const hasManagedTargetDrift = (errors: readonly string[]): boolean =>
  errors.some((error) => error.startsWith(MANAGED_DRIFT_PREFIX));

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
      label: "No target",
      message: "Select a target to continue",
      remediationLabel: "Open Targets"
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
      label: "Target unavailable",
      message: `${target.name} is unavailable`,
      remediationLabel: "Open Targets"
    };
  }

  if (localValidationErrors.length > 0) {
    return {
      status: "validation-error",
      label: "Needs review",
      message: "This profile has validation issues",
      remediationLabel: "Review Advanced"
    };
  }

  if (preview && preview.errors.length > 0) {
    return {
      status: "preview-error",
      label: "Needs review",
      message: "Preview found blocking issues",
      remediationLabel: "Review preview"
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
      remediationLabel: "Review preview"
    };
  }

  if (targetState.lifecycleStatus === "drifted" || targetState.errorCount > 0) {
    return {
      status: "preview-error",
      label: "Needs review",
      message: `${target.name} changed outside AgentEnv`,
      remediationLabel: "Review preview"
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

  if (preview && hasManagedTargetDrift(preview.errors)) {
    return `Resolve ${target.name} drift`;
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
