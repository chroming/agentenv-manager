import type {
  ApplyIssue,
  ApplyIssueCode,
  ApplyIssueDisposition,
  ApplyIssueResolution,
  ApplyIssueResourceKind
} from "../shared/types";

export interface ApplyIssueInput {
  code: ApplyIssueCode;
  disposition: ApplyIssueDisposition;
  resolution: ApplyIssueResolution;
  resourceKind: ApplyIssueResourceKind;
  resourceId?: string;
  path?: string;
  message: string;
  detail?: string;
}

const issueIdentity = ({
  code,
  resourceKind,
  resourceId = "",
  path = ""
}: Pick<ApplyIssueInput, "code" | "resourceKind" | "resourceId" | "path">) =>
  [code, resourceKind, resourceId, path].join("\u0000");

export const createApplyIssue = (input: ApplyIssueInput): ApplyIssue => ({
  id: issueIdentity(input),
  ...input
});

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
