import type { ProfileResourceMode } from "./schemas";

export type OneShotEvaluationStatus =
  | "preparing"
  | "running"
  | "cancelling"
  | "completed"
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
  projectPath: string;
  excludeMcp?: boolean;
}

export interface OneShotEvaluationPreview {
  previewId: string;
  profileId: string;
  profileName: string;
  profileContentHash: string;
  targetId: string;
  targetName: string;
  cliVersion?: string;
  projectPath: string;
  projectRevision: string;
  projectHasUncommittedChanges: boolean;
  resources: {
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

export interface OneShotEvaluationResult {
  runId: string;
  profileId: string;
  profileName: string;
  profileContentHash: string;
  skillContentHashes: Record<string, string>;
  targetId: string;
  targetName: string;
  cliVersion?: string;
  model?: string;
  projectPath: string;
  projectRevision: string;
  prompt: string;
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

export interface OneShotEvaluationRun {
  runId: string;
  profileId: string;
  profileName: string;
  targetId: string;
  targetName: string;
  projectPath: string;
  projectRevision: string;
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
