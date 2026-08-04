import type { ActivationPreview, ProfileDetail, TargetInfo } from "../shared/types";

export type ValidationLevel = "ok" | "warning" | "error" | "pending";

export interface ValidationRow {
  source: "access" | "instructions" | "skills" | "conflicts";
  label: string;
  value: string;
  detail?: string;
  level: ValidationLevel;
}

export const createValidationRows = (
  profile: ProfileDetail,
  target?: TargetInfo,
  preview?: ActivationPreview
): ValidationRow[] => {
  const targetLevel: ValidationLevel =
    target?.health.status === "ready"
      ? "ok"
      : target?.health.status === "missing"
        ? "error"
        : target
          ? "warning"
          : "pending";
  const blockingIssues = preview?.issues.filter((issue) => issue.disposition === "block") ?? [];

  return [
    {
      source: "access",
      label: `${target?.name ?? "Agent"} access`,
      value:
        target?.health.status === "ready"
          ? "OK"
          : target?.health.status === "missing"
            ? "Blocked"
          : target?.health.status === "guarded"
              ? "Guarded"
              : target?.health.status === "unknown"
                ? "Check failed"
              : target
                ? "Needs setup"
                : "Pending",
      detail: target?.health.summary,
      level: targetLevel
    },
    {
      source: "instructions",
      label: target?.instructionsLabel ?? "Instructions",
      value: profile.instructions.trim().length > 0 ? "OK" : "Empty",
      detail:
        profile.instructions.trim().length === 0
          ? "Applying this Profile clears managed instructions"
          : undefined,
      level: profile.instructions.trim().length === 0 ? "warning" : "ok"
    },
    {
      source: "skills",
      label: "Skills",
      value: `${profile.resources.skills.length}`,
      detail: "Preview verifies Library availability and Agent ownership",
      level: "pending"
    },
    {
      source: "conflicts",
      label: "Live conflicts",
      value: preview ? (blockingIssues.length > 0 ? "Blocked" : "OK") : "Pending",
      detail: preview
        ? blockingIssues.length > 0
          ? `${blockingIssues.length} issue${blockingIssues.length === 1 ? "" : "s"} found`
          : "Preview checks passed"
        : "Run preview to check live files",
      level: preview ? (blockingIssues.length > 0 ? "error" : "ok") : "pending"
    }
  ];
};
