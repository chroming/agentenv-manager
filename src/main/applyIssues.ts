import type {
  ApplyIssue,
  ApplyIssueCode,
  ApplyIssueDisposition,
  ApplyIssueResolution,
  ApplyIssueResourceKind
} from "../shared/types";

export interface ApplyIssueInput {
  code: ApplyIssueCode;
  resourceKind: ApplyIssueResourceKind;
  resourceId?: string;
  path?: string;
  message: string;
  detail?: string;
}

interface ApplyIssuePolicy {
  disposition: ApplyIssueDisposition;
  resolution: ApplyIssueResolution;
}

export const APPLY_ISSUE_POLICY: Record<ApplyIssueCode, ApplyIssuePolicy> = {
  "target-unavailable": { disposition: "block", resolution: "external-action" },
  "profile-validation": { disposition: "block", resolution: "edit-profile" },
  "secret-warning": { disposition: "notice", resolution: "automatic" },
  "native-setting-preserved": { disposition: "notice", resolution: "preserve" },
  "instruction-alias": { disposition: "notice", resolution: "preserve" },
  "invalid-native-config": { disposition: "block", resolution: "external-action" },
  "missing-native-mcp": { disposition: "block", resolution: "edit-profile" },
  "unsupported-mcp-management": { disposition: "block", resolution: "edit-profile" },
  "target-instruction-limit": { disposition: "block", resolution: "edit-profile" },
  "runtime-reload-required": { disposition: "notice", resolution: "external-action" },
  "duplicate-native-mcp": { disposition: "block", resolution: "external-action" },
  "agent-owned-native-mcp": { disposition: "block", resolution: "external-action" },
  "unsafe-native-mcp-update": { disposition: "block", resolution: "external-action" },
  "globally-disabled-skill": { disposition: "notice", resolution: "automatic" },
  "missing-library-skill": { disposition: "block", resolution: "edit-profile" },
  "outside-skill-replacement": { disposition: "review", resolution: "backup-replace" },
  "outside-skill-removal": { disposition: "review", resolution: "backup-replace" },
  "kept-outside-skill": { disposition: "notice", resolution: "preserve" },
  "managed-resource-drift": { disposition: "review", resolution: "backup-replace" },
  "managed-resource-missing": { disposition: "notice", resolution: "automatic" },
  "duplicate-runtime-skill": { disposition: "block", resolution: "edit-profile" },
  "native-disabled-skill": { disposition: "block", resolution: "external-action" },
  "runtime-observation": { disposition: "notice", resolution: "preserve" },
  "runtime-state-unavailable": { disposition: "block", resolution: "external-action" },
  "runtime-skill-conflict": { disposition: "block", resolution: "external-action" },
  "unsupported-skill-management": { disposition: "block", resolution: "edit-profile" },
  "shared-skill-conflict": { disposition: "block", resolution: "external-action" },
  "shared-skill-deferred": { disposition: "notice", resolution: "preserve" },
  "skill-root-isolation": { disposition: "review", resolution: "backup-replace" },
  "invalid-skill-root": { disposition: "block", resolution: "external-action" },
  "recovery-required": { disposition: "block", resolution: "open-recovery" },
  "operation-precondition": { disposition: "block", resolution: "external-action" },
  "operation-notice": { disposition: "notice", resolution: "preserve" }
};

const issueIdentity = ({
  code,
  resourceKind,
  resourceId = "",
  path = ""
}: Pick<ApplyIssueInput, "code" | "resourceKind" | "resourceId" | "path">) =>
  [code, resourceKind, resourceId, path].join("\u0000");

export const createApplyIssue = (input: ApplyIssueInput): ApplyIssue => {
  const policy = APPLY_ISSUE_POLICY[input.code];
  return {
    id: issueIdentity(input),
    ...input,
    ...policy
  };
};

const dispositionPriority: Record<ApplyIssueDisposition, number> = {
  notice: 0,
  review: 1,
  block: 2
};

export const dedupeApplyIssues = (issues: ApplyIssue[]): ApplyIssue[] => {
  const byResource = new Map<string, ApplyIssue>();
  for (const issue of issues) {
    const key = issue.path
      ? [
          issue.resourceKind,
          issue.resourceId ?? issue.code,
          issue.path
        ].join("\u0000")
      : issueIdentity(issue);
    const current = byResource.get(key);
    if (
      !current ||
      dispositionPriority[issue.disposition] > dispositionPriority[current.disposition]
    ) {
      byResource.set(key, issue);
    }
  }
  return [...byResource.values()].sort((left, right) => {
    const disposition =
      dispositionPriority[right.disposition] - dispositionPriority[left.disposition];
    if (disposition !== 0) return disposition;
    return `${left.resourceKind}:${left.resourceId ?? ""}:${left.path ?? ""}`.localeCompare(
      `${right.resourceKind}:${right.resourceId ?? ""}:${right.path ?? ""}`
    );
  });
};

export const blockingApplyIssues = (issues: readonly ApplyIssue[]) =>
  issues.filter((issue) => issue.disposition === "block");

export const reviewApplyIssues = (issues: readonly ApplyIssue[]) =>
  issues.filter((issue) => issue.disposition === "review");

export const replaceableApplyPaths = (issues: readonly ApplyIssue[]) =>
  new Set(
    issues
      .filter(
        (issue) =>
          issue.disposition === "review" &&
          issue.resolution === "backup-replace" &&
          issue.path
      )
      .map((issue) => issue.path as string)
  );
