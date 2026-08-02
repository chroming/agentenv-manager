import { dirname, join } from "node:path";
import { readTextIfExists } from "../../fileUtils";
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
  prepareEvaluationDirectories,
  probeCliVersion,
  stripAnsi,
  unavailableEvaluation
} from "./sharedEvaluation";

const PROJECT_AGENT_RESOURCES = [
  "GEMINI.md",
  ".gemini",
  ".agents"
] as const;

const inspectMcp = async (input: EvaluationProbeInput) => {
  try {
    const parsed = JSON.parse(await readTextIfExists(input.targetPaths.configPath) || "{}");
    if (!isRecord(parsed)) return { count: 0, unreadable: true };
    return {
      count: isRecord(parsed.mcpServers) ? Object.keys(parsed.mcpServers).length : 0,
      unreadable: false
    };
  } catch {
    return { count: 0, unreadable: true };
  }
};

const inspect = async (input: EvaluationProbeInput): Promise<EvaluationAvailability> => {
  const unavailable = unavailableEvaluation("Antigravity CLI", input);
  if (unavailable) return unavailable;
  const [{ count: mcpOmittedCount, unreadable }, cliVersion] = await Promise.all([
    inspectMcp(input),
    input.knownCliVersion
      ? Promise.resolve(input.knownCliVersion)
      : probeCliVersion(input.executablePath!, input.platform)
  ]);
  const warnings: string[] = [];
  if (!cliVersion) warnings.push("Antigravity CLI version could not be read");
  if (mcpOmittedCount > 0) {
    warnings.push("MCP configurations are excluded from isolated Profile comparison");
  } else if (unreadable) {
    warnings.push("Antigravity MCP configuration could not be read and was excluded");
  }
  return {
    available: true,
    cliVersion,
    fidelity: mcpOmittedCount > 0 || unreadable ? "partial" : "full",
    mcpIncludedCount: 0,
    mcpOmittedCount,
    requiresMcpExclusion: false,
    warnings
  };
};

const parseEvent = (line: string): EvaluationEvent | undefined => {
  const text = stripAnsi(line).trimEnd();
  return text ? { type: "response", text: `${text}\n` } : undefined;
};

export const createAntigravityEvaluationCapability = (): AgentEvaluationCapability => ({
  projectResourcePaths: PROJECT_AGENT_RESOURCES,
  checkAvailability: inspect,
  createLaunchSpec: async (input) => {
    const availability = await inspect(input);
    if (!availability.available || !input.executablePath) {
      throw new Error(availability.reason ?? "Antigravity comparison is unavailable");
    }
    const xdg = await prepareEvaluationDirectories(input);
    const sourceRuntime = join(dirname(input.targetPaths.configDir), "antigravity-cli");
    const evaluationRuntime = join(dirname(input.evaluationTargetPaths.configDir), "antigravity-cli");
    await Promise.all([
      copyVerifiedCredential(
        join(sourceRuntime, "antigravity-oauth-token"),
        join(evaluationRuntime, "antigravity-oauth-token"),
        "Antigravity credentials",
        input.platform
      ),
      copyVerifiedCredential(
        join(sourceRuntime, "installation_id"),
        join(evaluationRuntime, "installation_id"),
        "Antigravity installation identity",
        input.platform
      )
    ]);
    const env = createIsolatedEnvironment(input, xdg);
    delete env.CODEX_HOME;
    delete env.OPENCODE_CONFIG;
    delete env.OPENCODE_CONFIG_CONTENT;
    return {
      executablePath: input.executablePath,
      args: [
        "--print",
        input.prompt,
        "--print-timeout",
        "30m",
        "--mode",
        "accept-edits",
        "--dangerously-skip-permissions",
        "--new-project",
        "--log-file",
        join(input.evaluationTempDir, "antigravity.log")
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
