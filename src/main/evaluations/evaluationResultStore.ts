import { readFile } from "node:fs/promises";
import type { OneShotEvaluationResult } from "../../shared/evaluations";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { redactSensitiveValues } from "../secretWarnings";

export interface EvaluationResultStore {
  readLatest(): Promise<OneShotEvaluationResult | undefined>;
  saveLatest(
    result: OneShotEvaluationResult,
    options?: { privatePaths?: string[] }
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

const replacePrivatePaths = (value: string, paths: string[]) =>
  paths
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (content, path) => content.replaceAll(path, "<evaluation-workspace>"),
      value
    );

const sanitizeText = (value: string, paths: string[], maxBytes: number) =>
  truncateUtf8(redactSensitiveValues(replacePrivatePaths(value, paths)), maxBytes);

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
    (candidate.cliVersion === undefined || typeof candidate.cliVersion === "string") &&
    (candidate.model === undefined || typeof candidate.model === "string") &&
    typeof candidate.projectPath === "string" &&
    typeof candidate.projectRevision === "string" &&
    typeof candidate.prompt === "string" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.completedAt === "string" &&
    typeof candidate.durationMs === "number" && Number.isFinite(candidate.durationMs) &&
    isOptionalFiniteNumber(candidate.exitCode) &&
    typeof candidate.finalResponse === "string" &&
    typeof candidate.diff === "string" &&
    Array.isArray(candidate.fileDiffs) && candidate.fileDiffs.every((change) =>
      Boolean(change && typeof change.path === "string" && typeof change.diff === "string" &&
        (change.action === undefined || ["add", "remove", "replace"].includes(change.action)))) &&
    Array.isArray(candidate.changedFiles) && candidate.changedFiles.every(
      (path) => typeof path === "string"
    ) &&
    Array.isArray(candidate.warnings) && candidate.warnings.every(
      (warning) => typeof warning === "string"
    ) &&
    isUsage(candidate.usage) &&
    (candidate.error === undefined || typeof candidate.error === "string") &&
    (candidate.fidelity === "full" || candidate.fidelity === "partial")
  );
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
    const paths = saveOptions.privatePaths ?? [];
    const prompt = sanitizeText(result.prompt, paths, options.maxPromptBytes ?? 64 * 1024);
    const response = sanitizeText(
      result.finalResponse,
      paths,
      options.maxResponseBytes ?? 512 * 1024
    );
    const maxDiffBytes = options.maxDiffBytes ?? 2 * 1024 * 1024;
    const diff = sanitizeText(result.diff, paths, maxDiffBytes);
    const error = result.error
      ? sanitizeText(result.error, paths, options.maxErrorBytes ?? 32 * 1024)
      : undefined;
    let remainingFileDiffBytes = maxDiffBytes;
    let fileDiffsTruncated = false;
    const fileDiffs = [] as OneShotEvaluationResult["fileDiffs"];
    for (const change of result.fileDiffs) {
      if (remainingFileDiffBytes <= 0) {
        fileDiffsTruncated = true;
        break;
      }
      const sanitized = sanitizeText(change.diff, paths, remainingFileDiffBytes);
      fileDiffs.push({ ...change, diff: sanitized.value });
      remainingFileDiffBytes = Math.max(
        0,
        remainingFileDiffBytes - Buffer.byteLength(sanitized.value, "utf8")
      );
      fileDiffsTruncated ||= sanitized.truncated;
    }
    fileDiffsTruncated ||= fileDiffs.length < result.fileDiffs.length;
    const truncated = prompt.truncated || response.truncated || diff.truncated ||
      fileDiffsTruncated || error?.truncated;
    const safeResult: OneShotEvaluationResult = {
      ...result,
      prompt: prompt.value,
      finalResponse: response.value,
      diff: diff.value,
      fileDiffs,
      warnings: [
        ...result.warnings.map((warning) => sanitizeText(warning, paths, 16 * 1024).value),
        ...(truncated ? ["Stored evaluation output was truncated to protect local storage"] : [])
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
