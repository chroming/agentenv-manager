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
  | "unmanaged"
  | "ready";

export interface ProfileReadiness {
  status: ProfileReadinessStatus;
  label: "No profile" | "No target" | "Unsaved" | "Target unavailable" | "Needs review" | "Ready";
  message: string;
  remediationLabel?: "New Profile" | "Open Targets" | "Save now" | "Review Advanced" | "Review preview";
}

export interface ProfileReadinessInput {
  profile?: Pick<ProfileDetail, "id">;
  target?: Pick<TargetInfo, "id" | "name" | "health">;
  targetState?: Pick<TargetManagementState, "status">;
  isDirty: boolean;
  localValidationErrors?: readonly string[];
  preview?: Pick<ActivationPreview, "errors">;
}

export const hasManagedTargetDrift = (errors: readonly string[]): boolean =>
  errors.some((error) => error.startsWith(MANAGED_DRIFT_PREFIX));

export const deriveProfileReadiness = ({
  profile,
  target,
  targetState,
  isDirty,
  localValidationErrors = [],
  preview
}: ProfileReadinessInput): ProfileReadiness => {
  if (!profile) {
    return {
      status: "no-profile",
      label: "No profile",
      message: "Create a profile to continue",
      remediationLabel: "New Profile"
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

  return {
    status: "ready",
    label: "Ready",
    message: `${target.name} is ready to preview and apply`
  };
};

export const deriveApplyActionLabel = (input: ProfileReadinessInput): string => {
  const { target, localValidationErrors = [], preview, targetState } = input;
  if (!target) {
    return "Apply profile";
  }

  if (!target.health.canWrite || localValidationErrors.length > 0) {
    return `Review ${target.name} issues`;
  }

  if (preview && hasManagedTargetDrift(preview.errors)) {
    return `Resolve ${target.name} drift`;
  }

  return targetState?.status === "managed"
    ? `Preview & apply to ${target.name}`
    : `Take over ${target.name}`;
};
