import type { ProfileResourceMode } from "./schemas";

export type OneShotEvaluationStatus =
  | "preparing"
  | "running"
  | "cancelling"
  | "completed"
  | "incomplete"
  | "failed-to-run"
  | "cancelled";

export type OneShotEvaluationFidelity = "full" | "partial";

export interface OneShotEvaluationResourceScope {
  mode: ProfileResourceMode;
  includedCount: number;
  omittedCount?: number;
}

export interface OneShotEvaluationPreviewInput {
  profileId: string;
  targetId: string;
  workspace?: OneShotEvaluationWorkspaceInput;
  excludeMcp?: boolean;
}

export type OneShotEvaluationWorkspaceInput =
  | { kind: "empty" }
  | { kind: "folder"; path: string };

export interface OneShotEvaluationWorkspaceSummary {
  kind: "empty" | "folder";
  path?: string;
  name: string;
  contentHash: string;
  fileCount: number;
  totalBytes: number;
  git?: {
    revision: string;
    branch?: string;
    hasUncommittedChanges: boolean;
  };
  omittedCount: number;
}

export interface OneShotEvaluationPreview {
  previewId: string;
  profileId: string;
  profileName: string;
  profileContentHash: string;
  targetId: string;
  targetName: string;
  cliVersion?: string;
  workspace: OneShotEvaluationWorkspaceSummary;
  runsRequired: 1 | 2;
  baselineSource: "fresh-run" | "verified-previous-run";
  currentResources: {
    instructions: OneShotEvaluationResourceScope;
    skills: OneShotEvaluationResourceScope;
    mcp: OneShotEvaluationResourceScope;
  };
  proposedResources: {
    instructions: OneShotEvaluationResourceScope;
    skills: OneShotEvaluationResourceScope;
    mcp: OneShotEvaluationResourceScope;
  };
  fidelity: OneShotEvaluationFidelity;
  requiresMcpExclusion: boolean;
  warnings: string[];
  createdAt: string;
}

export interface OneShotEvaluationStartInput {
  previewId: string;
  prompt: string;
}

export interface OneShotEvaluationUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  reportedCostUsd?: number;
}

export interface OneShotEvaluationFileDiff {
  path: string;
  diff: string;
  action?: "add" | "remove" | "replace";
}

export interface OneShotEvaluationSideResult {
  environment: "current" | "proposed";
  environmentContentHash: string;
  skillContentHashes: Record<string, string>;
  cliVersion?: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode?: number;
  finalResponse: string;
  diff: string;
  fileDiffs: OneShotEvaluationFileDiff[];
  changedFiles: string[];
  usage?: OneShotEvaluationUsage;
  fidelity: OneShotEvaluationFidelity;
  warnings: string[];
  error?: string;
}

export interface OneShotEvaluationDelta {
  diff: string;
  fileDiffs: OneShotEvaluationFileDiff[];
  changedFiles: string[];
}

export interface OneShotEvaluationResult {
  runId: string;
  profileId: string;
  profileName: string;
  profileContentHash: string;
  skillContentHashes: Record<string, string>;
  targetId: string;
  targetName: string;
  workspace: OneShotEvaluationWorkspaceSummary;
  prompt: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  current: OneShotEvaluationSideResult;
  proposed: OneShotEvaluationSideResult;
  delta: OneShotEvaluationDelta;
  baselineSource: "fresh-run" | "verified-previous-run";
  comparisonSignature: string;
  fidelity: OneShotEvaluationFidelity;
  warnings: string[];
  error?: string;
}

export interface OneShotEvaluationRun {
  runId: string;
  profileId: string;
  profileName: string;
  targetId: string;
  targetName: string;
  workspace: OneShotEvaluationWorkspaceSummary;
  status: OneShotEvaluationStatus;
  stage: string;
  startedAt: string;
  canCancel: boolean;
  result?: OneShotEvaluationResult;
  error?: string;
}

export interface OneShotEvaluationReadInput {
  runId?: string;
}

export const oneShotEvaluationIsActive = (
  status: OneShotEvaluationStatus
): boolean =>
  status === "preparing" || status === "running" || status === "cancelling";
