import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "jsonc-parser";
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
  numberValue,
  prepareEvaluationDirectories,
  probeCliVersion,
  textContent,
  unavailableEvaluation
} from "./sharedEvaluation";

const PROJECT_AGENT_RESOURCES = [
  "CLAUDE.md",
  ".claude",
  ".agents",
  "AGENTS.md"
] as const;
const CLAUDE_EVALUATION_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_EFFORT_LEVEL"
] as const;
const AUTH_TIMEOUT_MS = 5_000;
const AUTH_OUTPUT_LIMIT = 8 * 1024;
const MACOS_SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";

export const claudeAuthUnavailableReason = (output: string) => {
  try {
    const value = JSON.parse(output);
    if (isRecord(value) && value.loggedIn === false) {
      return "Claude Code is not signed in. Run Claude Code and use /login before using Compare.";
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const probeClaudeAuth = async (input: EvaluationProbeInput): Promise<string | undefined> => {
  if (
    input.environment.ANTHROPIC_API_KEY?.trim() ||
    input.environment.CLAUDE_CODE_OAUTH_TOKEN?.trim() ||
    (await readTextIfExists(join(input.targetPaths.configDir, ".credentials.json"))).trim()
  ) {
    return undefined;
  }
  if (
    input.platform !== "darwin" ||
    !input.executablePath ||
    !existsSync(MACOS_SANDBOX_EXECUTABLE)
  ) {
    return undefined;
  }
  const probeRoot = await mkdtemp(join(tmpdir(), "agentenv-claude-auth-"));
  try {
    return await new Promise((resolve) => {
      const policy = [
        "(version 1)",
        "(allow default)",
        `(deny file-write* (require-not (subpath ${JSON.stringify(probeRoot)})))`
      ].join(" ");
      const child = spawn(MACOS_SANDBOX_EXECUTABLE, [
        "-p",
        policy,
        input.executablePath!,
        "auth",
        "status"
      ], {
        env: {
          ...input.environment,
          CLAUDE_CODE_TMPDIR: probeRoot,
          CLAUDE_TMPDIR: probeRoot,
          BUN_TMPDIR: probeRoot,
          TMPDIR: probeRoot,
          TMP: probeRoot,
          TEMP: probeRoot
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const finish = (value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value ? claudeAuthUnavailableReason(value) : undefined);
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes <= AUTH_OUTPUT_LIMIT) chunks.push(chunk);
      });
      child.once("error", () => finish());
      child.once("close", () => finish(Buffer.concat(chunks).toString("utf8")));
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish();
      }, AUTH_TIMEOUT_MS);
      timer.unref();
    });
  } finally {
    await rm(probeRoot, { recursive: true, force: true });
  }
};

const objectAt = (content: string, key: string) => {
  try {
    const value = parse(content || "{}");
    return isRecord(value) && isRecord(value[key]) ? value[key] : {};
  } catch {
    return undefined;
  }
};

const readClaudeEvaluationEnvironment = async (input: EvaluationProbeInput) => {
  try {
    const value = parse(await readTextIfExists(input.targetPaths.configPath) || "{}");
    const env = isRecord(value) && isRecord(value.env) ? value.env : {};
    return Object.fromEntries(
      CLAUDE_EVALUATION_ENV_KEYS.flatMap((key) =>
        typeof env[key] === "string" && env[key].trim()
          ? [[key, env[key]]]
          : [])
    );
  } catch {
    return {};
  }
};

const inspectMcp = async (input: EvaluationProbeInput) => {
  const policy = input.profile.resources.mcpByTarget["claude-code"] ?? {
    mode: "ignore" as const,
    selections: []
  };
  if (policy.mode === "disable") return { count: 0, unreadable: false };
  if (policy.mode === "manage") {
    return {
      count: policy.selections.filter((selection) => selection.enabled).length,
      unreadable: false
    };
  }
  const paths = [input.targetPaths.configPath, input.targetPaths.mcpConfigPath]
    .filter((path): path is string => Boolean(path));
  let count = 0;
  for (const path of paths) {
    const servers = objectAt(await readTextIfExists(path), "mcpServers");
    if (!servers) return { count, unreadable: true };
    count += Object.keys(servers).length;
  }
  return { count, unreadable: false };
};

const inspect = async (input: EvaluationProbeInput): Promise<EvaluationAvailability> => {
  const unavailable = unavailableEvaluation("Claude Code", input);
  if (unavailable) return unavailable;
  const [{ count: mcpOmittedCount, unreadable }, cliVersion, authReason] = await Promise.all([
    inspectMcp(input),
    input.knownCliVersion
      ? Promise.resolve(input.knownCliVersion)
      : probeCliVersion(input.executablePath!, input.platform),
    probeClaudeAuth(input)
  ]);
  if (authReason) {
    return {
      available: false,
      reason: authReason,
      fidelity: "partial",
      mcpIncludedCount: 0,
      mcpOmittedCount,
      requiresMcpExclusion: false,
      warnings: []
    };
  }
  const warnings: string[] = [];
  if (!cliVersion) warnings.push("Claude Code version could not be read");
  if (mcpOmittedCount > 0) {
    warnings.push("MCP configurations are excluded from isolated Profile comparison");
  } else if (unreadable) {
    warnings.push("Claude Code MCP configuration could not be read and was excluded");
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
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(event)) return undefined;
  if (event.type === "assistant" && isRecord(event.message)) {
    const text = textContent(event.message.content);
    const usage = isRecord(event.message.usage) ? event.message.usage : {};
    if (!text) return undefined;
    return {
      type: "response",
      text,
      model: typeof event.message.model === "string" ? event.message.model : undefined,
      usage: {
        inputTokens: numberValue(usage.input_tokens),
        cachedInputTokens: numberValue(usage.cache_read_input_tokens),
        outputTokens: numberValue(usage.output_tokens)
      }
    };
  }
  if (event.type === "result" && event.is_error === true) {
    const message = typeof event.result === "string" ? event.result : "Claude Code comparison failed";
    return { type: "error", message };
  }
  return undefined;
};

export const createClaudeEvaluationCapability = (): AgentEvaluationCapability => ({
  projectResourcePaths: PROJECT_AGENT_RESOURCES,
  checkAvailability: inspect,
  createLaunchSpec: async (input) => {
    const availability = await inspect(input);
    if (!availability.available || !input.executablePath) {
      throw new Error(availability.reason ?? "Claude Code comparison is unavailable");
    }
    const xdg = await prepareEvaluationDirectories(input);
    await copyVerifiedCredential(
      join(input.targetPaths.configDir, ".credentials.json"),
      join(input.evaluationTargetPaths.configDir, ".credentials.json"),
      "Claude Code credentials",
      input.platform
    );
    const configuredEnvironment = await readClaudeEvaluationEnvironment(input);
    const env = createIsolatedEnvironment(input, xdg, {
      ...configuredEnvironment,
      CLAUDE_CONFIG_DIR: input.evaluationTargetPaths.configDir,
      CLAUDE_CODE_TMPDIR: input.evaluationTempDir,
      CLAUDE_TMPDIR: input.evaluationTempDir,
      BUN_TMPDIR: input.evaluationTempDir
    });
    delete env.CODEX_HOME;
    delete env.OPENCODE_CONFIG;
    delete env.OPENCODE_CONFIG_CONTENT;
    return {
      executablePath: input.executablePath,
      args: [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
        "--no-chrome",
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
