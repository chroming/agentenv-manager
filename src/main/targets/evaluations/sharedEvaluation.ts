import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse as parsePath, sep } from "node:path";
import { hashPathEntry } from "../../filesystemIntegrity";
import { isMissingFileError } from "../../fileUtils";
import type {
  EvaluationAvailability,
  EvaluationLaunchInput,
  EvaluationProbeInput
} from "../types";

const VERSION_TIMEOUT_MS = 5_000;
const VERSION_OUTPUT_LIMIT = 8 * 1024;
const MACOS_SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";

export const unavailableEvaluation = (
  name: string,
  input: EvaluationProbeInput
): EvaluationAvailability | undefined => {
  if (input.executablePath && isAbsolute(input.executablePath)) return undefined;
  return {
    available: false,
    reason: `${name} command was not found`,
    fidelity: "partial",
    mcpIncludedCount: 0,
    mcpOmittedCount: 0,
    requiresMcpExclusion: false,
    warnings: []
  };
};

export const probeCliVersion = async (
  executablePath: string,
  platform: NodeJS.Platform
): Promise<string | undefined> => new Promise((resolve) => {
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

export const copyVerifiedCredential = async (
  source: string,
  destination: string,
  label: string,
  platform: NodeJS.Platform
): Promise<boolean> => {
  let sourceStat;
  try {
    sourceStat = await lstat(source);
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
  if (!sourceStat.isFile()) {
    throw new Error(`${label} must be a regular file before it can be copied for comparison`);
  }
  const sourceHash = await hashPathEntry(source);
  if (!sourceHash) return false;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  if (platform !== "win32") await chmod(destination, 0o600);
  const [sourceAfter, destinationHash] = await Promise.all([
    hashPathEntry(source),
    hashPathEntry(destination)
  ]);
  if (sourceAfter !== sourceHash || destinationHash !== sourceHash) {
    throw new Error(`${label} changed while the isolated copy was prepared`);
  }
  return true;
};

export const prepareEvaluationDirectories = async (input: EvaluationLaunchInput) => {
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
  return { xdgConfigHome, xdgDataHome, xdgCacheHome, xdgStateHome };
};

export const createIsolatedEnvironment = (
  input: EvaluationLaunchInput,
  xdg: Awaited<ReturnType<typeof prepareEvaluationDirectories>>,
  additions: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv => ({
  ...input.environment,
  HOME: input.evaluationHome,
  USERPROFILE: input.evaluationHome,
  XDG_CONFIG_HOME: xdg.xdgConfigHome,
  XDG_DATA_HOME: xdg.xdgDataHome,
  XDG_CACHE_HOME: xdg.xdgCacheHome,
  XDG_STATE_HOME: xdg.xdgStateHome,
  TMPDIR: input.evaluationTempDir,
  TMP: input.evaluationTempDir,
  TEMP: input.evaluationTempDir,
  ...additions
});

const packageRuntimeRoot = (path: string) => {
  const parts = path.split(sep);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || nodeModulesIndex + 1 >= parts.length) return dirname(path);
  const packageEnd = parts[nodeModulesIndex + 1]?.startsWith("@")
    ? nodeModulesIndex + 3
    : nodeModulesIndex + 2;
  return `${parsePath(path).root}${parts.slice(1, packageEnd).join(sep)}`;
};

export const evaluationRuntimeReadRoots = async (executablePath: string) => {
  const resolvedExecutable = await realpath(executablePath);
  return [...new Set([
    dirname(executablePath),
    packageRuntimeRoot(resolvedExecutable)
  ])];
};

export const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const textContent = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter(isRecord)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
};

export const stripAnsi = (value: string) =>
  value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
