import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitCommandRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface GitCommandRunnerOptions {
  executablePath: string;
  env?: NodeJS.ProcessEnv;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  terminateGraceMs?: number;
}

export interface GitCommandRunner {
  run(args: string[], options?: GitCommandRunOptions): Promise<GitCommandResult>;
  cancelActive(): void;
  dispose(): void;
}

export class GitCommandError extends Error {
  readonly exitCode?: number;
  readonly stderr: string;

  constructor(message: string, options: { exitCode?: number; stderr?: string } = {}) {
    super(message);
    this.name = "GitCommandError";
    this.exitCode = options.exitCode;
    this.stderr = options.stderr ?? "";
  }
}

export const redactGitError = (value: string): string =>
  value
    .replace(/(https?:\/\/)([^/\s@]+)@/gi, "$1***@")
    .replace(/(ssh:\/\/[^:/\s@]+):[^@\s/]+@/gi, "$1:***@")
    .replace(
      /([?&](?:access_token|private_token|token|password|passwd|secret)=)[^&#\s]+/gi,
      "$1***"
    );

const terminateProcess = (
  child: ChildProcess,
  signal: NodeJS.Signals
): void => {
  if (!child.pid || child.killed) {
    return;
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through when the child did not establish a process group.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The process may have exited between the state check and the signal.
  }
};

export const createGitCommandRunner = (
  runnerOptions: GitCommandRunnerOptions
): GitCommandRunner => {
  if (!isAbsolute(runnerOptions.executablePath)) {
    throw new Error("Git executable path must be absolute");
  }
  const active = new Set<(reason: "cancelled") => void>();
  let disposed = false;

  const run = (
    args: string[],
    options: GitCommandRunOptions = {}
  ): Promise<GitCommandResult> => {
    if (disposed) {
      return Promise.reject(new GitCommandError("Git command runner is disposed"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new GitCommandError("Git command was cancelled"));
    }

    return new Promise<GitCommandResult>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? runnerOptions.defaultTimeoutMs ?? 60_000;
      const maxOutputBytes = options.maxOutputBytes ?? runnerOptions.maxOutputBytes ?? 4 * 1024 * 1024;
      const terminateGraceMs = runnerOptions.terminateGraceMs ?? 250;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let outputBytes = 0;
      let stopReason: "cancelled" | "timed-out" | "output-limit" | undefined;
      let spawnError: Error | undefined;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      let child: ChildProcess;

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", abort);
        active.delete(cancel);
      };

      const stop = (reason: typeof stopReason) => {
        if (stopReason || settled) return;
        stopReason = reason;
        terminateProcess(child, "SIGTERM");
        killTimer = setTimeout(() => terminateProcess(child, "SIGKILL"), terminateGraceMs);
        killTimer.unref();
      };

      const cancel = () => stop("cancelled");
      const abort = () => stop("cancelled");

      try {
        child = spawn(runnerOptions.executablePath, args, {
          cwd: options.cwd,
          env: {
            ...process.env,
            ...runnerOptions.env,
            ...options.env,
            GIT_TERMINAL_PROMPT: "0"
          },
          shell: false,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        reject(
          new GitCommandError(
            `Unable to start Git: ${redactGitError(error instanceof Error ? error.message : String(error))}`
          )
        );
        return;
      }

      const collect = (chunks: Buffer[], chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes <= maxOutputBytes) {
          chunks.push(chunk);
        } else {
          stop("output-limit");
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => collect(stdoutChunks, chunk));
      child.stderr?.on("data", (chunk: Buffer) => collect(stderrChunks, chunk));
      child.on("error", (error) => {
        spawnError = error;
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const safeStderr = redactGitError(stderr.trim());
        if (stopReason === "cancelled") {
          reject(new GitCommandError("Git command was cancelled", { stderr: safeStderr }));
          return;
        }
        if (stopReason === "timed-out") {
          reject(new GitCommandError(`Git command timed out after ${timeoutMs} ms`, { stderr: safeStderr }));
          return;
        }
        if (stopReason === "output-limit") {
          reject(new GitCommandError("Git command produced too much output", { stderr: safeStderr }));
          return;
        }
        if (spawnError) {
          reject(
            new GitCommandError(`Unable to run Git: ${redactGitError(spawnError.message)}`, {
              stderr: safeStderr
            })
          );
          return;
        }
        if (code !== 0) {
          const detail = safeStderr ? `: ${safeStderr}` : "";
          reject(new GitCommandError(`Git command failed${detail}`, { exitCode: code ?? undefined, stderr: safeStderr }));
          return;
        }
        resolve({ stdout, stderr, exitCode: 0 });
      });

      const timeoutTimer = setTimeout(() => stop("timed-out"), timeoutMs);
      active.add(cancel);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) {
        abort();
      }
    });
  };

  return {
    run,
    cancelActive: () => {
      for (const cancel of [...active]) {
        cancel("cancelled");
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const cancel of [...active]) cancel("cancelled");
    }
  };
};
