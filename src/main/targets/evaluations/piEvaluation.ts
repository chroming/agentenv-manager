import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../../fileUtils";
import type {
  AgentEvaluationCapability,
  EvaluationAvailability,
  EvaluationEvent,
  EvaluationProbeInput
} from "../types";
import {
  copyVerifiedCredential,
  createIsolatedEnvironment,
  evaluationRuntimeReadRoots,
  isRecord,
  numberValue,
  prepareEvaluationDirectories,
  probeCliVersion,
  textContent,
  unavailableEvaluation
} from "./sharedEvaluation";

const PROJECT_AGENT_RESOURCES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".pi",
  ".agents"
] as const;

const inspect = async (input: EvaluationProbeInput): Promise<EvaluationAvailability> => {
  const unavailable = unavailableEvaluation("Pi", input);
  if (unavailable) return unavailable;
  const cliVersion = input.knownCliVersion ??
    await probeCliVersion(input.executablePath!, input.platform);
  return {
    available: true,
    cliVersion,
    fidelity: "full",
    mcpIncludedCount: 0,
    mcpOmittedCount: 0,
    requiresMcpExclusion: false,
    warnings: cliVersion ? [] : ["Pi version could not be read"]
  };
};

const copyPiRuntimeSelection = async (
  sourceRoot: string,
  destinationRoot: string,
  platform: NodeJS.Platform
) => {
  await Promise.all([
    copyVerifiedCredential(
      join(sourceRoot, "auth.json"),
      join(destinationRoot, "auth.json"),
      "Pi credentials",
      platform
    ),
    copyVerifiedCredential(
      join(sourceRoot, "models-store.json"),
      join(destinationRoot, "models-store.json"),
      "Pi model catalog",
      platform
    )
  ]);
  try {
    const parsed = JSON.parse(await readFile(join(sourceRoot, "settings.json"), "utf8"));
    if (!isRecord(parsed)) return;
    const selected = Object.fromEntries(
      ["defaultProvider", "defaultModel", "defaultThinkingLevel"]
        .filter((key) => typeof parsed[key] === "string")
        .map((key) => [key, parsed[key]])
    );
    if (Object.keys(selected).length > 0) {
      await writeAtomic(join(destinationRoot, "settings.json"), `${JSON.stringify(selected, null, 2)}\n`, {
        mode: 0o600,
        platform
      });
    }
  } catch {
    // Pi can still use environment credentials and its own defaults.
  }
};

const parseEvent = (line: string): EvaluationEvent | undefined => {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(event) || event.type !== "message_end" || !isRecord(event.message)) {
    return undefined;
  }
  if (event.message.role !== "assistant") return undefined;
  const text = textContent(event.message.content);
  const usage = isRecord(event.message.usage) ? event.message.usage : {};
  const cost = isRecord(usage.cost) ? usage.cost : {};
  if (typeof event.message.errorMessage === "string" && event.message.errorMessage.trim()) {
    return { type: "error", message: event.message.errorMessage };
  }
  if (!text) return undefined;
  return {
    type: "response",
    text,
    model: typeof event.message.model === "string" ? event.message.model : undefined,
    usage: {
      inputTokens: numberValue(usage.input),
      cachedInputTokens: numberValue(usage.cacheRead),
      outputTokens: numberValue(usage.output),
      totalTokens: numberValue(usage.totalTokens),
      reportedCostUsd: numberValue(cost.total)
    }
  };
};

export const createPiEvaluationCapability = (): AgentEvaluationCapability => ({
  projectResourcePaths: PROJECT_AGENT_RESOURCES,
  checkAvailability: inspect,
  createLaunchSpec: async (input) => {
    const availability = await inspect(input);
    if (!availability.available || !input.executablePath) {
      throw new Error(availability.reason ?? "Pi comparison is unavailable");
    }
    const xdg = await prepareEvaluationDirectories(input);
    await copyPiRuntimeSelection(
      input.targetPaths.configDir,
      input.evaluationTargetPaths.configDir,
      input.platform
    );
    const sessionsDir = join(input.evaluationTempDir, "pi-sessions");
    await mkdir(sessionsDir, { recursive: true, mode: 0o700 });
    const env = createIsolatedEnvironment(input, xdg, {
      PI_CODING_AGENT_DIR: input.evaluationTargetPaths.configDir,
      PI_CODING_AGENT_SESSION_DIR: sessionsDir
    });
    delete env.CODEX_HOME;
    delete env.OPENCODE_CONFIG;
    delete env.OPENCODE_CONFIG_CONTENT;
    return {
      executablePath: input.executablePath,
      args: [
        "--mode",
        "json",
        "--print",
        "--no-session",
        "--no-extensions",
        "--no-prompt-templates",
        "--no-themes",
        "--approve",
        input.prompt
      ],
      cwd: input.evaluationProject,
      env,
      writableRoot: join(input.evaluationHome, ".."),
      runtimeReadRoots: await evaluationRuntimeReadRoots(input.executablePath),
      cliVersion: availability.cliVersion,
      fidelity: availability.fidelity,
      warnings: availability.warnings
    };
  },
  parseEvent
});
