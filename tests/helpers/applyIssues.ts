import type { ApplyIssue } from "../../src/shared/types";

export const blockingMessages = (issues: readonly ApplyIssue[]) =>
  issues
    .filter((issue) => issue.disposition === "block")
    .map((issue) => [issue.message, issue.detail, issue.path].filter(Boolean).join(" "));

export const reviewMessages = (issues: readonly ApplyIssue[]) =>
  issues
    .filter((issue) => issue.disposition === "review")
    .map((issue) => [issue.message, issue.detail, issue.path].filter(Boolean).join(" "));

export const noticeMessages = (issues: readonly ApplyIssue[]) =>
  issues
    .filter((issue) => issue.disposition === "notice")
    .map((issue) => [issue.message, issue.detail, issue.path].filter(Boolean).join(" "));
