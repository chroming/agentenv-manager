import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { hashPathEntry } from "../../filesystemIntegrity";
import { isMissingFileError, writeAtomic } from "../../fileUtils";
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
const EVALUATION_PERMISSION = {
  "*": "deny",
  read: "allow",
  edit: "allow",
  glob: "allow",
  grep: "allow",
  skill: "allow",
  todowrite: "allow"
} as const;

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

const mcpServers = (config: Record<string, unknown>) => {
  const mcp = isRecord(config.mcp) ? config.mcp : {};
  if (isRecord(mcp.servers)) {
    return mcp.servers;
  }
  return mcp;
};

const omittedMcpCount = (
  config: Record<string, unknown>,
  policy: EvaluationProbeInput["profile"]["resources"]["mcpByTarget"][string]
) => {
  if (policy.mode === "disable") return { count: 0 };
  if (policy.mode === "manage") {
    return { count: policy.selections.filter((selection) => selection.enabled).length };
  }
  return { count: Object.keys(mcpServers(config)).length };
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
        mcpOmittedCount: 0,
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
    policy.mode === "ignore";
  const content = needsNativeConfig ? await readTextIfPresent(input.targetPaths.configPath) : "";
  const parsed = parseConfig(content);
  const warnings: string[] = [];
  let mcpOmittedCount = policy.mode === "manage"
    ? policy.selections.filter((selection) => selection.enabled).length
    : 0;

  if (!parsed.ok) {
    // MCPs are always excluded in P0. An unreadable native config only makes
    // the omitted count unavailable and must not block a local evaluation.
  } else {
    mcpOmittedCount = omittedMcpCount(parsed.value, policy).count;
  }

  const cliVersion = input.knownCliVersion ?? await probeVersion(input.executablePath, input.platform);
  if (!cliVersion) warnings.push("OpenCode version could not be read");
  return {
    availability: {
      available: true,
      cliVersion,
      fidelity: "partial",
      mcpIncludedCount: 0,
      mcpOmittedCount,
      requiresMcpExclusion: false,
      warnings
    },
    evalConfig: { permission: EVALUATION_PERMISSION }
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
    await Promise.all([
      mkdir(input.evaluationTargetPaths.configDir, { recursive: true, mode: 0o700 }),
      mkdir(input.evaluationTempDir, { recursive: true, mode: 0o700 }),
      mkdir(join(input.evaluationHome, ".local", "share"), { recursive: true, mode: 0o700 }),
      mkdir(join(input.evaluationHome, ".cache"), { recursive: true, mode: 0o700 }),
      mkdir(join(input.evaluationHome, ".local", "state"), { recursive: true, mode: 0o700 })
    ]);
    await writeAtomic(
      input.evaluationTargetPaths.configPath,
      `${JSON.stringify(inspected.evalConfig, null, 2)}\n`,
      { mode: 0o600, platform: input.platform }
    );
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
