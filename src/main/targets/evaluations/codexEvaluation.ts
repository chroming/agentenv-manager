import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse as parsePath, sep } from "node:path";
import * as TOML from "@iarna/toml";
import { hashPathEntry } from "../../filesystemIntegrity";
import { readTextIfExists } from "../../fileUtils";
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
  "AGENTS.md",
  "AGENTS.override.md",
  ".agents",
  ".codex"
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

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

const nativeMcpCount = async (input: EvaluationProbeInput) => {
  const policy = input.profile.resources.mcpByTarget.codex ?? {
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
  try {
    const parsed = TOML.parse(
      await readTextIfExists(input.targetPaths.configPath)
    ) as Record<string, unknown>;
    return {
      count: isRecord(parsed.mcp_servers) ? Object.keys(parsed.mcp_servers).length : 0,
      unreadable: false
    };
  } catch {
    return { count: 0, unreadable: true };
  }
};

const inspect = async (input: EvaluationProbeInput): Promise<EvaluationAvailability> => {
  if (!input.executablePath || !isAbsolute(input.executablePath)) {
    return {
      available: false,
      reason: "Codex runtime was not found",
      fidelity: "partial",
      mcpIncludedCount: 0,
      mcpOmittedCount: 0,
      requiresMcpExclusion: false,
      warnings: []
    };
  }

  const [{ count: mcpOmittedCount, unreadable }, cliVersion] = await Promise.all([
    nativeMcpCount(input),
    input.knownCliVersion
      ? Promise.resolve(input.knownCliVersion)
      : probeVersion(input.executablePath, input.platform)
  ]);
  const warnings: string[] = [];
  if (!cliVersion) warnings.push("Codex version could not be read");
  if (mcpOmittedCount > 0) {
    warnings.push("MCP configurations are excluded from isolated Profile comparison");
  } else if (unreadable) {
    warnings.push("Codex MCP configuration could not be read and was excluded");
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

const copyCodexAuth = async (
  input: EvaluationProbeInput,
  evaluationCodexHome: string
) => {
  const source = join(input.targetPaths.configDir, "auth.json");
  const sourceHash = await hashPathEntry(source);
  if (!sourceHash) return;
  const destination = join(evaluationCodexHome, "auth.json");
  await mkdir(evaluationCodexHome, { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  if (input.platform !== "win32") await chmod(destination, 0o600);
  const [sourceAfter, destinationHash] = await Promise.all([
    hashPathEntry(source),
    hashPathEntry(destination)
  ]);
  if (sourceAfter !== sourceHash || destinationHash !== sourceHash) {
    throw new Error("Codex credentials changed while the isolated copy was prepared");
  }
};

const packageRuntimeRoot = (path: string) => {
  const parts = path.split(sep);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || nodeModulesIndex + 1 >= parts.length) return dirname(path);
  const packageEnd = parts[nodeModulesIndex + 1]?.startsWith("@")
    ? nodeModulesIndex + 3
    : nodeModulesIndex + 2;
  return `${parsePath(path).root}${parts.slice(1, packageEnd).join(sep)}`;
};

const parseEvent = (line: string): EvaluationEvent | undefined => {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(event)) return undefined;
  const item = isRecord(event.item) ? event.item : undefined;
  if (
    event.type === "item.completed" &&
    item?.type === "agent_message" &&
    typeof item.text === "string"
  ) {
    return { type: "response", text: item.text };
  }
  if (event.type === "turn.completed" && isRecord(event.usage)) {
    return {
      type: "usage",
      usage: {
        inputTokens: numberValue(event.usage.input_tokens),
        cachedInputTokens: numberValue(event.usage.cached_input_tokens),
        outputTokens: numberValue(event.usage.output_tokens),
        reasoningTokens: numberValue(event.usage.reasoning_output_tokens)
      }
    };
  }
  if (event.type === "turn.failed" || event.type === "error") {
    const error = isRecord(event.error) ? event.error : undefined;
    const message = [error?.message, event.message]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    return message ? { type: "error", message } : undefined;
  }
  return undefined;
};

export const createCodexEvaluationCapability = (): AgentEvaluationCapability => ({
  projectResourcePaths: PROJECT_AGENT_RESOURCES,
  checkAvailability: inspect,
  createLaunchSpec: async (input) => {
    const availability = await inspect(input);
    if (!availability.available || !input.executablePath) {
      throw new Error(availability.reason ?? "Codex comparison is unavailable");
    }
    const xdgConfigHome = join(input.evaluationHome, ".config");
    const xdgDataHome = join(input.evaluationHome, ".local", "share");
    const xdgCacheHome = join(input.evaluationHome, ".cache");
    const xdgStateHome = join(input.evaluationHome, ".local", "state");
    await Promise.all([
      mkdir(input.evaluationTargetPaths.configDir, { recursive: true, mode: 0o700 }),
      mkdir(input.evaluationTempDir, { recursive: true, mode: 0o700 }),
      mkdir(xdgConfigHome, { recursive: true, mode: 0o700 }),
      mkdir(xdgDataHome, { recursive: true, mode: 0o700 }),
      mkdir(xdgCacheHome, { recursive: true, mode: 0o700 }),
      mkdir(xdgStateHome, { recursive: true, mode: 0o700 })
    ]);
    await copyCodexAuth(input, input.evaluationTargetPaths.configDir);
    const resolvedExecutable = await realpath(input.executablePath);
    const env: NodeJS.ProcessEnv = {
      ...input.environment,
      HOME: input.evaluationHome,
      USERPROFILE: input.evaluationHome,
      CODEX_HOME: input.evaluationTargetPaths.configDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_STATE_HOME: xdgStateHome,
      TMPDIR: input.evaluationTempDir,
      TMP: input.evaluationTempDir,
      TEMP: input.evaluationTempDir
    };
    return {
      executablePath: input.executablePath,
      args: [
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--sandbox",
        "workspace-write",
        "--cd",
        input.evaluationProject,
        input.prompt
      ],
      cwd: input.evaluationProject,
      env,
      writableRoot: join(input.evaluationHome, ".."),
      runtimeReadRoots: [...new Set([
        dirname(input.executablePath),
        packageRuntimeRoot(resolvedExecutable)
      ])],
      cliVersion: availability.cliVersion,
      fidelity: availability.fidelity,
      warnings: availability.warnings
    };
  },
  parseEvent
});
