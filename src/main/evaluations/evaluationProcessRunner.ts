import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { EvaluationEvent, EvaluationLaunchSpec } from "../targets/types";

export type EvaluationProcessStopReason =
  | "cancelled"
  | "timed-out"
  | "output-limit"
  | "launch-failed";

export class EvaluationProcessError extends Error {
  readonly reason: EvaluationProcessStopReason;

  constructor(reason: EvaluationProcessStopReason, message: string) {
    super(message);
    this.name = "EvaluationProcessError";
    this.reason = reason;
  }
}

export interface EvaluationProcessResult {
  exitCode: number;
  stderr: string;
}

export interface EvaluationProcessRunner {
  isolationAvailability(): { available: boolean; reason?: string };
  run(
    spec: EvaluationLaunchSpec,
    parseEvent: (line: string) => EvaluationEvent | undefined,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onEvent?: (event: EvaluationEvent) => void;
    }
  ): Promise<EvaluationProcessResult>;
  cancelActive(): void;
  dispose(): void;
}

export interface EvaluationProcessRunnerOptions {
  platform?: NodeJS.Platform;
  sandboxExecutablePath?: string;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  maxStderrBytes?: number;
  terminateGraceMs?: number;
}

const terminateProcess = (
  child: ChildProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform
) => {
  if (!child.pid || child.killed) return;
  if (platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct process if no group was established.
    }
  }
  if (platform === "win32") {
    try {
      spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
        { shell: false, stdio: "ignore", windowsHide: true }
      ).unref();
      return;
    } catch {
      // Fall back to the direct process.
    }
  }
  child.kill(signal);
};

const seatbeltProfile = (
  writableRoot: string,
  readDeniedRoots: readonly string[],
  runtimeReadRoots: readonly string[]
) => {
  const readExceptions = [writableRoot, ...runtimeReadRoots]
    .map((path) => `(require-not (subpath ${JSON.stringify(path)}))`)
    .join(" ");
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-write* (require-not (subpath ${JSON.stringify(writableRoot)})))`,
    ...readDeniedRoots.map((path) =>
      `(deny file-read* (require-all (subpath ${JSON.stringify(path)}) ${readExceptions}))`)
  ].join(" ");
};

const isWithin = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

const isolatedEnvironmentPaths = [
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CODEX_HOME",
  "OPENCODE_CONFIG_DIR",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_TMPDIR",
  "CLAUDE_TMPDIR",
  "BUN_TMPDIR",
  "PI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_SESSION_DIR",
  "TRAE_HOME",
  "TRAECLI_HOME"
] as const;

const inheritedWorkingDirectoryKeys = [
  "OLDPWD",
  "INIT_CWD",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "npm_config_local_prefix",
  "NPM_CONFIG_LOCAL_PREFIX"
] as const;

export const createEvaluationProcessRunner = (
  options: EvaluationProcessRunnerOptions = {}
): EvaluationProcessRunner => {
  const platform = options.platform ?? process.platform;
  const sandboxExecutablePath = options.sandboxExecutablePath ?? "/usr/bin/sandbox-exec";
  const active = new Set<() => void>();
  let disposed = false;

  const isolationAvailability = () => {
    if (platform !== "darwin") {
      return {
        available: false,
        reason: "Isolated Profile comparison currently requires the macOS process sandbox"
      };
    }
    if (!sandboxExecutablePath.startsWith("/") || !existsSync(sandboxExecutablePath)) {
      return {
        available: false,
        reason: "The macOS process sandbox is unavailable"
      };
    }
    return { available: true };
  };

  const run: EvaluationProcessRunner["run"] = async (
    spec,
    parseEvent,
    runOptions = {}
  ) => {
    if (disposed) {
      throw new EvaluationProcessError("launch-failed", "Comparison runner is shutting down");
    }
    const isolation = isolationAvailability();
    if (!isolation.available) {
      throw new EvaluationProcessError("launch-failed", isolation.reason ?? "Comparison isolation is unavailable");
    }
    if (runOptions.signal?.aborted) {
      throw new EvaluationProcessError("cancelled", "Comparison was cancelled");
    }

    if (!isAbsolute(spec.executablePath)) {
      throw new EvaluationProcessError("launch-failed", "Comparison command must use an absolute path");
    }
    const [writableRoot, cwd, executablePath] = await Promise.all([
      realpath(spec.writableRoot),
      realpath(spec.cwd),
      realpath(spec.executablePath)
    ]);
    if (!isWithin(writableRoot, cwd)) {
      throw new EvaluationProcessError("launch-failed", "Comparison working directory is outside its isolated workspace");
    }
    const childEnvironment = { ...spec.env };
    for (const key of spec.envToDelete ?? []) delete childEnvironment[key];
    for (const key of inheritedWorkingDirectoryKeys) delete childEnvironment[key];
    childEnvironment.PWD = cwd;
    for (const key of isolatedEnvironmentPaths) {
      const value = childEnvironment[key]?.trim();
      if (!value) continue;
      const canonicalValue = isAbsolute(value) ? await realpath(value).catch(() => undefined) : undefined;
      if (!canonicalValue || !isWithin(writableRoot, canonicalValue)) {
        throw new EvaluationProcessError(
          "launch-failed",
          `Comparison ${key} is outside its isolated workspace`
        );
      }
      childEnvironment[key] = canonicalValue;
    }
    const canonicalizeRoots = async (paths: readonly string[]) => [...new Set(await Promise.all(
      paths.map(async (path) => {
        if (!isAbsolute(path)) {
          throw new EvaluationProcessError("launch-failed", "Comparison isolation paths must be absolute");
        }
        return realpath(path).catch(() => resolve(path));
      })
    ))];
    const readDeniedRoots = await canonicalizeRoots(spec.readDeniedRoots ?? []);
    const runtimeReadRoots = await canonicalizeRoots([
      executablePath,
      ...(spec.runtimeReadRoots ?? [])
    ]);
    return new Promise<EvaluationProcessResult>((resolve, reject) => {
      const timeoutMs = runOptions.timeoutMs ?? options.defaultTimeoutMs ?? 30 * 60 * 1_000;
      const maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
      const maxStderrBytes = options.maxStderrBytes ?? 1024 * 1024;
      const terminateGraceMs = options.terminateGraceMs ?? 1_000;
      let child: ChildProcess;
      let stdoutBuffer = "";
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let spawnError: Error | undefined;
      let stopReason: EvaluationProcessStopReason | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        runOptions.signal?.removeEventListener("abort", abort);
        active.delete(cancel);
      };
      const stop = (reason: EvaluationProcessStopReason) => {
        if (settled || stopReason) return;
        stopReason = reason;
        terminateProcess(child, "SIGTERM", platform);
        killTimer = setTimeout(
          () => terminateProcess(child, "SIGKILL", platform),
          terminateGraceMs
        );
        killTimer.unref();
      };
      const cancel = () => stop("cancelled");
      const abort = () => stop("cancelled");

      try {
        child = spawn(
          sandboxExecutablePath,
          [
            "-p",
            seatbeltProfile(writableRoot, readDeniedRoots, runtimeReadRoots),
            spec.executablePath,
            ...spec.args
          ],
          {
            cwd,
            env: childEnvironment,
            shell: false,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
          }
        );
      } catch (error) {
        reject(new EvaluationProcessError(
          "launch-failed",
          `Unable to start evaluation: ${error instanceof Error ? error.message : String(error)}`
        ));
        return;
      }

      const emitLines = (final = false) => {
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = final ? "" : lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parseEvent(line);
          if (event) runOptions.onEvent?.(event);
        }
        if (final && stdoutBuffer.trim()) {
          const event = parseEvent(stdoutBuffer);
          if (event) runOptions.onEvent?.(event);
          stdoutBuffer = "";
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maxOutputBytes) {
          stop("output-limit");
          return;
        }
        stdoutBuffer += chunk.toString("utf8");
        if (Buffer.byteLength(stdoutBuffer, "utf8") > maxOutputBytes) {
          stop("output-limit");
          return;
        }
        emitLines();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > maxStderrBytes) {
          stop("output-limit");
          return;
        }
        stderrChunks.push(chunk);
      });
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        emitLines(true);
        cleanup();
        if (stopReason === "cancelled") {
          reject(new EvaluationProcessError("cancelled", "Comparison was cancelled"));
          return;
        }
        if (stopReason === "timed-out") {
          reject(new EvaluationProcessError("timed-out", `Comparison timed out after ${timeoutMs} ms`));
          return;
        }
        if (stopReason === "output-limit") {
          reject(new EvaluationProcessError("output-limit", "Comparison produced too much output"));
          return;
        }
        if (spawnError) {
          reject(new EvaluationProcessError("launch-failed", `Unable to run evaluation: ${spawnError.message}`));
          return;
        }
        resolve({
          exitCode: code ?? 1,
          stderr: Buffer.concat(stderrChunks).toString("utf8").trim()
        });
      });

      const timeoutTimer = setTimeout(() => stop("timed-out"), timeoutMs);
      timeoutTimer.unref();
      active.add(cancel);
      runOptions.signal?.addEventListener("abort", abort, { once: true });
      if (runOptions.signal?.aborted) abort();
    });
  };

  return {
    isolationAvailability,
    run,
    cancelActive: () => {
      for (const cancel of [...active]) cancel();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const cancel of [...active]) cancel();
    }
  };
};
