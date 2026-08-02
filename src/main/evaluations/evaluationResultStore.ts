import { readFile } from "node:fs/promises";
import type {
  OneShotEvaluationDelta,
  OneShotEvaluationResult,
  OneShotEvaluationSideResult
} from "../../shared/evaluations";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { redactSensitiveValues } from "../secretWarnings";

export interface EvaluationResultStore {
  readLatest(): Promise<OneShotEvaluationResult | undefined>;
  saveLatest(
    result: OneShotEvaluationResult,
    options?: {
      privatePaths?: string[];
      pathRedactions?: Array<{ path: string; replacement: string }>;
    }
  ): Promise<OneShotEvaluationResult>;
}

export interface EvaluationResultStoreOptions {
  path: string;
  platform?: NodeJS.Platform;
  maxPromptBytes?: number;
  maxResponseBytes?: number;
  maxDiffBytes?: number;
  maxErrorBytes?: number;
}

const truncateUtf8 = (value: string, maxBytes: number) => {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return { value, truncated: false };
  const suffix = "\n\n[Truncated by AgentEnv]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const buffer = Buffer.from(value, "utf8");
  return {
    value: `${buffer.subarray(0, Math.max(0, maxBytes - suffixBytes)).toString("utf8")}${suffix}`,
    truncated: true
  };
};

const stripTerminalControlSequences = (value: string) => value
  .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)?/g, "")
  .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g, "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");

const replacePrivatePaths = (
  value: string,
  redactions: Array<{ path: string; replacement: string }>
) => redactions
  .filter(({ path }) => Boolean(path))
  .sort((left, right) => right.path.length - left.path.length)
  .reduce((content, { path, replacement }) => content.replaceAll(path, replacement), value);

const sanitizeText = (
  value: string,
  redactions: Array<{ path: string; replacement: string }>,
  maxBytes: number
) => truncateUtf8(
  redactSensitiveValues(replacePrivatePaths(stripTerminalControlSequences(value), redactions)),
  maxBytes
);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string"));

const isOptionalFiniteNumber = (value: unknown) =>
  value === undefined || (typeof value === "number" && Number.isFinite(value));

const isUsage = (value: unknown) => {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
    "reportedCostUsd"
  ].every((key) => isOptionalFiniteNumber(usage[key]));
};

const isFileDiffs = (value: unknown) => Array.isArray(value) && value.every((change) =>
  Boolean(change && typeof change.path === "string" && typeof change.diff === "string" &&
    (change.action === undefined || ["add", "remove", "replace"].includes(change.action))));

const isSideResult = (value: unknown): value is OneShotEvaluationSideResult => {
  if (!value || typeof value !== "object") return false;
  const side = value as Partial<OneShotEvaluationSideResult>;
  return Boolean(
    (side.environment === "current" || side.environment === "proposed") &&
    typeof side.environmentContentHash === "string" &&
    isStringRecord(side.skillContentHashes) &&
    (side.cliVersion === undefined || typeof side.cliVersion === "string") &&
    (side.model === undefined || typeof side.model === "string") &&
    typeof side.startedAt === "string" &&
    typeof side.completedAt === "string" &&
    typeof side.durationMs === "number" && Number.isFinite(side.durationMs) &&
    isOptionalFiniteNumber(side.exitCode) &&
    typeof side.finalResponse === "string" &&
    typeof side.diff === "string" &&
    isFileDiffs(side.fileDiffs) &&
    Array.isArray(side.changedFiles) && side.changedFiles.every((path) => typeof path === "string") &&
    isUsage(side.usage) &&
    (side.fidelity === "full" || side.fidelity === "partial") &&
    Array.isArray(side.warnings) && side.warnings.every((warning) => typeof warning === "string") &&
    (side.error === undefined || typeof side.error === "string")
  );
};

const isDelta = (value: unknown): value is OneShotEvaluationDelta => {
  if (!value || typeof value !== "object") return false;
  const delta = value as Partial<OneShotEvaluationDelta>;
  return typeof delta.diff === "string" && isFileDiffs(delta.fileDiffs) &&
    Array.isArray(delta.changedFiles) && delta.changedFiles.every((path) => typeof path === "string");
};

const isWorkspace = (value: unknown) => {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Record<string, unknown>;
  return (workspace.kind === "empty" || workspace.kind === "folder") &&
    (workspace.path === undefined || typeof workspace.path === "string") &&
    typeof workspace.name === "string" &&
    typeof workspace.contentHash === "string" &&
    typeof workspace.fileCount === "number" && Number.isFinite(workspace.fileCount) &&
    typeof workspace.totalBytes === "number" && Number.isFinite(workspace.totalBytes) &&
    typeof workspace.omittedCount === "number" && Number.isFinite(workspace.omittedCount);
};

const isResult = (value: unknown): value is OneShotEvaluationResult => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OneShotEvaluationResult>;
  return Boolean(
    typeof candidate.runId === "string" &&
    typeof candidate.profileId === "string" &&
    typeof candidate.profileName === "string" &&
    typeof candidate.profileContentHash === "string" &&
    isStringRecord(candidate.skillContentHashes) &&
    typeof candidate.targetId === "string" &&
    typeof candidate.targetName === "string" &&
    isWorkspace(candidate.workspace) &&
    typeof candidate.prompt === "string" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.completedAt === "string" &&
    typeof candidate.durationMs === "number" && Number.isFinite(candidate.durationMs) &&
    isSideResult(candidate.current) &&
    isSideResult(candidate.proposed) &&
    isDelta(candidate.delta) &&
    (candidate.baselineSource === "fresh-run" || candidate.baselineSource === "verified-previous-run") &&
    typeof candidate.comparisonSignature === "string" &&
    (candidate.fidelity === "full" || candidate.fidelity === "partial") &&
    Array.isArray(candidate.warnings) && candidate.warnings.every(
      (warning) => typeof warning === "string"
    ) &&
    (candidate.error === undefined || typeof candidate.error === "string")
  );
};

const sanitizeFileChanges = (
  value: Pick<OneShotEvaluationDelta, "diff" | "fileDiffs" | "changedFiles">,
  redactions: Array<{ path: string; replacement: string }>,
  maxDiffBytes: number
) => {
  const diff = sanitizeText(value.diff, redactions, maxDiffBytes);
  let remainingBytes = maxDiffBytes;
  let truncated = diff.truncated;
  const fileDiffs = [] as OneShotEvaluationDelta["fileDiffs"];
  for (const change of value.fileDiffs) {
    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }
    const safe = sanitizeText(change.diff, redactions, remainingBytes);
    fileDiffs.push({ ...change, diff: safe.value });
    remainingBytes -= Buffer.byteLength(safe.value, "utf8");
    truncated ||= safe.truncated;
  }
  truncated ||= fileDiffs.length < value.fileDiffs.length;
  return { diff: diff.value, fileDiffs, changedFiles: value.changedFiles, truncated };
};

const sanitizeSide = (
  side: OneShotEvaluationSideResult,
  redactions: Array<{ path: string; replacement: string }>,
  options: EvaluationResultStoreOptions
) => {
  const response = sanitizeText(
    side.finalResponse,
    redactions,
    options.maxResponseBytes ?? 512 * 1024
  );
  const changes = sanitizeFileChanges(side, redactions, options.maxDiffBytes ?? 2 * 1024 * 1024);
  const error = side.error
    ? sanitizeText(side.error, redactions, options.maxErrorBytes ?? 32 * 1024)
    : undefined;
  return {
    value: {
      ...side,
      finalResponse: response.value,
      diff: changes.diff,
      fileDiffs: changes.fileDiffs,
      warnings: side.warnings.map((warning) => sanitizeText(warning, redactions, 16 * 1024).value),
      ...(error ? { error: error.value } : {})
    },
    truncated: response.truncated || changes.truncated || error?.truncated === true
  };
};

export const createEvaluationResultStore = (
  options: EvaluationResultStoreOptions
): EvaluationResultStore => ({
  readLatest: async () => {
    try {
      const value: unknown = JSON.parse(await readFile(options.path, "utf8"));
      return isResult(value) ? value : undefined;
    } catch (error) {
      if (isMissingFileError(error) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  },
  saveLatest: async (result, saveOptions = {}) => {
    const redactions = [
      ...(saveOptions.privatePaths ?? []).map((path) => ({
        path,
        replacement: "<comparison-workspace>"
      })),
      ...(result.workspace.path ? [{
        path: result.workspace.path,
        replacement: "<selected-workspace>"
      }] : []),
      ...(saveOptions.pathRedactions ?? [])
    ];
    const prompt = sanitizeText(result.prompt, redactions, options.maxPromptBytes ?? 64 * 1024);
    const current = sanitizeSide(result.current, redactions, options);
    const proposed = sanitizeSide(result.proposed, redactions, options);
    const delta = sanitizeFileChanges(result.delta, redactions, options.maxDiffBytes ?? 2 * 1024 * 1024);
    const error = result.error
      ? sanitizeText(result.error, redactions, options.maxErrorBytes ?? 32 * 1024)
      : undefined;
    const truncated = prompt.truncated || current.truncated || proposed.truncated ||
      delta.truncated || error?.truncated === true;
    const { path: _workspacePath, ...storedWorkspace } = result.workspace;
    const safeResult: OneShotEvaluationResult = {
      ...result,
      workspace: storedWorkspace,
      prompt: prompt.value,
      current: current.value,
      proposed: proposed.value,
      delta: {
        diff: delta.diff,
        fileDiffs: delta.fileDiffs,
        changedFiles: delta.changedFiles
      },
      warnings: [
        ...result.warnings.map((warning) => sanitizeText(warning, redactions, 16 * 1024).value),
        ...(truncated ? ["Stored comparison output was truncated to protect local storage"] : [])
      ],
      ...(error ? { error: error.value } : {})
    };
    await writeAtomic(options.path, `${JSON.stringify(safeResult, null, 2)}\n`, {
      mode: 0o600,
      platform: options.platform
    });
    return safeResult;
  }
});
