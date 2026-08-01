import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { profileResourceMode } from "../../../shared/profileResources";
import type { ProfileMcpPolicy } from "../../../shared/schemas";
import { hashPathEntry } from "../../filesystemIntegrity";
import { isMissingFileError, writeAtomic } from "../../fileUtils";
import { findSecretWarnings } from "../../secretWarnings";
import type {
  AgentEvaluationCapability,
  EvaluationAvailability,
  EvaluationEvent,
  EvaluationProbeInput
} from "../types";

const VERSION_TIMEOUT_MS = 5_000;
const VERSION_OUTPUT_LIMIT = 8 * 1024;
const MACOS_SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";
const PROJECT_AGENT_RESOURCES = [
  "opencode.json",
  "opencode.jsonc",
  ".opencode",
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/skills",
  ".agents/skills"
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readTextIfPresent = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return "";
    throw error;
  }
};

const parseConfig = (
  content: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
  if (!content.trim()) return { ok: true, value: {} };
  const errors: ParseError[] = [];
  const value = parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return {
      ok: false,
      message: `OpenCode configuration is invalid: ${errors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`
    };
  }
  return isRecord(value)
    ? { ok: true, value }
    : { ok: false, message: "OpenCode configuration must be an object" };
};

const mcpLayout = (config: Record<string, unknown>) => {
  const mcp = isRecord(config.mcp) ? config.mcp : {};
  if (isRecord(mcp.servers)) {
    return { kind: "legacy" as const, servers: mcp.servers };
  }
  return { kind: "direct" as const, servers: mcp };
};

const selectedMcp = (
  config: Record<string, unknown>,
  policy: ProfileMcpPolicy
): { config?: Record<string, unknown>; count: number } => {
  if (policy.mode === "disable") return { count: 0 };
  const layout = mcpLayout(config);
  const names = policy.mode === "ignore"
    ? Object.keys(layout.servers)
    : policy.selections.filter((selection) => selection.enabled).map((selection) => selection.name);
  const selected: Record<string, unknown> = {};
  for (const name of names) {
    const value = layout.servers[name];
    if (!isRecord(value)) continue;
    selected[name] = layout.kind === "legacy"
      ? { ...value, disabled: false }
      : { ...value, enabled: true };
  }
  if (Object.keys(selected).length === 0) return { count: 0 };
  return {
    count: Object.keys(selected).length,
    config: layout.kind === "legacy"
      ? { mcp: { servers: selected } }
      : { mcp: selected }
  };
};

const missingEnabledMcpNames = (
  config: Record<string, unknown>,
  policy: ProfileMcpPolicy
) => {
  if (policy.mode !== "manage") return [];
  const servers = mcpLayout(config).servers;
  return policy.selections
    .filter((selection) => selection.enabled && !isRecord(servers[selection.name]))
    .map((selection) => selection.name);
};

const probeVersion = async (
  executablePath: string,
  platform: NodeJS.Platform
): Promise<string | undefined> =>
  new Promise((resolve) => {
    if (platform !== "darwin" || !existsSync(MACOS_SANDBOX_EXECUTABLE)) {
      resolve(undefined);
      return;
    }
    const child = spawn(MACOS_SANDBOX_EXECUTABLE, [
      "-p",
      "(version 1) (allow default) (deny file-write*)",
      executablePath,
      "--version"
    ], {
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
      resolve(value?.trim() || undefined);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes <= VERSION_OUTPUT_LIMIT) chunks.push(chunk);
    });
    child.once("error", () => finish());
    child.once("close", (code) =>
      finish(code === 0 ? Buffer.concat(chunks).toString("utf8") : undefined));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish();
    }, VERSION_TIMEOUT_MS);
    timer.unref();
  });

const inspect = async (input: EvaluationProbeInput): Promise<{
  availability: EvaluationAvailability;
  evalConfig?: Record<string, unknown>;
}> => {
  if (!input.executablePath || !isAbsolute(input.executablePath)) {
    return {
      availability: {
        available: false,
        reason: "OpenCode command was not found",
        fidelity: "partial",
        mcpIncludedCount: 0,
        requiresMcpExclusion: false,
        warnings: []
      }
    };
  }

  const policy = input.profile.resources.mcpByTarget.opencode ?? {
    mode: "ignore",
    selections: []
  };
  const needsNativeConfig =
    policy.mode === "ignore" ||
    (policy.mode === "manage" && policy.selections.some((selection) => selection.enabled));
  const content = needsNativeConfig ? await readTextIfPresent(input.targetPaths.configPath) : "";
  const parsed = parseConfig(content);
  const warnings: string[] = [];
  let requiresMcpExclusion = false;
  let evalConfig: Record<string, unknown> | undefined;
  let mcpIncludedCount = 0;

  if (!parsed.ok) {
    if (needsNativeConfig) {
      warnings.push(parsed.message);
      requiresMcpExclusion = true;
    }
  } else {
    const missing = missingEnabledMcpNames(parsed.value, policy);
    if (missing.length > 0) {
      warnings.push(`OpenCode MCP ${missing.join(", ")} is not configured on this device`);
      requiresMcpExclusion = true;
    }
    const selected = selectedMcp(parsed.value, policy);
    evalConfig = selected.config;
    mcpIncludedCount = selected.count;
    if (evalConfig && findSecretWarnings(JSON.stringify(evalConfig)).length > 0) {
      warnings.push("OpenCode MCP settings contain literal credentials and cannot be copied into the isolated evaluation");
      requiresMcpExclusion = true;
    }
  }

  if (input.excludeMcp) {
    evalConfig = undefined;
    mcpIncludedCount = 0;
  }
  const cliVersion = input.knownCliVersion ?? await probeVersion(input.executablePath, input.platform);
  if (!cliVersion) warnings.push("OpenCode version could not be read");
  return {
    availability: {
      available: true,
      cliVersion,
      fidelity: input.excludeMcp && profileResourceMode(
        input.profile.resources,
        "opencode",
        "mcp"
      ) !== "disable" ? "partial" : "full",
      mcpIncludedCount,
      requiresMcpExclusion: requiresMcpExclusion && !input.excludeMcp,
      warnings
    },
    evalConfig
  };
};

const copyOpenCodeAuth = async (
  input: EvaluationProbeInput,
  evaluationHome: string
) => {
  const sourceDataRoot = input.environment.XDG_DATA_HOME?.trim();
  const sourcePath = sourceDataRoot && isAbsolute(sourceDataRoot)
    ? join(sourceDataRoot, "opencode", "auth.json")
    : join(input.sourceHomeDir, ".local", "share", "opencode", "auth.json");
  const sourceHash = await hashPathEntry(sourcePath);
  if (!sourceHash) return;
  const destination = join(evaluationHome, ".local", "share", "opencode", "auth.json");
  await mkdir(join(evaluationHome, ".local", "share", "opencode"), {
    recursive: true,
    mode: 0o700
  });
  await copyFile(sourcePath, destination);
  if (input.platform !== "win32") await chmod(destination, 0o600);
  const [sourceAfter, destinationHash] = await Promise.all([
    hashPathEntry(sourcePath),
    hashPathEntry(destination)
  ]);
  if (sourceAfter !== sourceHash || destinationHash !== sourceHash) {
    throw new Error("OpenCode credentials changed while the isolated copy was prepared");
  }
};

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseEvent = (line: string): EvaluationEvent | undefined => {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(event)) return undefined;
  const part = isRecord(event.part) ? event.part : undefined;
  if (event.type === "text" && typeof part?.text === "string") {
    return { type: "response", text: part.text };
  }
  if (event.type === "step_finish" && part) {
    const tokens = isRecord(part.tokens) ? part.tokens : {};
    const cache = isRecord(tokens.cache) ? tokens.cache : {};
    const usage = {
      inputTokens: numberValue(tokens.input),
      cachedInputTokens: numberValue(cache.read),
      outputTokens: numberValue(tokens.output),
      reasoningTokens: numberValue(tokens.reasoning),
      reportedCostUsd: numberValue(part.cost)
    };
    const hasUsage = Object.values(usage).some((value) => value !== undefined);
    if (!hasUsage && typeof part.modelID !== "string") return undefined;
    return {
      type: "usage",
      usage,
      model: typeof part.modelID === "string" ? part.modelID : undefined
    };
  }
  if (event.type === "error") {
    const error = isRecord(event.error) ? event.error : undefined;
    const data = isRecord(error?.data) ? error.data : undefined;
    const message = [data?.message, error?.message, event.message]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    return message ? { type: "error", message } : undefined;
  }
  return undefined;
};

export const createOpenCodeEvaluationCapability = (): AgentEvaluationCapability => ({
  projectResourcePaths: PROJECT_AGENT_RESOURCES,
  checkAvailability: async (input) => (await inspect(input)).availability,
  createLaunchSpec: async (input) => {
    const inspected = await inspect(input);
    if (!inspected.availability.available || !input.executablePath) {
      throw new Error(inspected.availability.reason ?? "OpenCode evaluation is unavailable");
    }
    if (inspected.availability.requiresMcpExclusion) {
      throw new Error("Exclude unsafe or unavailable MCP settings before running this evaluation");
    }

    await Promise.all([
      mkdir(input.evaluationTargetPaths.configDir, { recursive: true, mode: 0o700 }),
      mkdir(input.evaluationTempDir, { recursive: true, mode: 0o700 }),
      mkdir(join(input.evaluationHome, ".local", "share"), { recursive: true, mode: 0o700 }),
      mkdir(join(input.evaluationHome, ".cache"), { recursive: true, mode: 0o700 }),
      mkdir(join(input.evaluationHome, ".local", "state"), { recursive: true, mode: 0o700 })
    ]);
    if (inspected.evalConfig) {
      await writeAtomic(
        input.evaluationTargetPaths.configPath,
        `${JSON.stringify(inspected.evalConfig, null, 2)}\n`,
        { mode: 0o600, platform: input.platform }
      );
    }
    await copyOpenCodeAuth(input, input.evaluationHome);

    const env: NodeJS.ProcessEnv = {
      ...input.environment,
      HOME: input.evaluationHome,
      USERPROFILE: input.evaluationHome,
      XDG_CONFIG_HOME: join(input.evaluationHome, ".config"),
      XDG_DATA_HOME: join(input.evaluationHome, ".local", "share"),
      XDG_CACHE_HOME: join(input.evaluationHome, ".cache"),
      XDG_STATE_HOME: join(input.evaluationHome, ".local", "state"),
      OPENCODE_CONFIG_DIR: input.evaluationTargetPaths.configDir,
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      TMPDIR: input.evaluationTempDir,
      TMP: input.evaluationTempDir,
      TEMP: input.evaluationTempDir
    };
    delete env.OPENCODE_CONFIG;
    delete env.OPENCODE_CONFIG_CONTENT;

    return {
      executablePath: input.executablePath,
      args: [
        "run",
        "--format",
        "json",
        "--pure",
        "--auto",
        "--dir",
        input.evaluationProject,
        input.prompt
      ],
      cwd: input.evaluationProject,
      env,
      writableRoot: join(input.evaluationHome, ".."),
      cliVersion: inspected.availability.cliVersion,
      fidelity: inspected.availability.fidelity,
      warnings: inspected.availability.warnings
    };
  },
  parseEvent
});
