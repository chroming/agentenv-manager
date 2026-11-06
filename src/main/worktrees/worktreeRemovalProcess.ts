import { fork } from "node:child_process";
import type { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WORKTREE_REMOVAL_TIMEOUT_MS } from "../../shared/worktrees";
import type { WorktreeRemovalDiagnostics } from "../../shared/worktrees";

export class WorktreeRemovalCancelledError extends Error {
  constructor() { super("Worktree deletion stopped; remaining contents stay in Trash"); this.name = "WorktreeRemovalCancelledError"; }
}
export class WorktreeRemovalTimeoutError extends Error {
  constructor(readonly diagnostics?: WorktreeRemovalDiagnostics) {
    super("Cleanup time limit reached. Remaining contents stay in Worktree Trash; retry this item there.");
    this.name = "WorktreeRemovalTimeoutError";
  }
}

interface RemovalRequest { path: string; device: string; inode: string }
interface RemovalProcess {
  events: EventEmitter;
  stderr: NodeJS.ReadableStream | null;
  pid(): number | undefined;
  exitEvent: "exit" | "close";
  send(request: RemovalRequest): void;
  terminate(force?: boolean): void;
}

const startProcess = (): RemovalProcess => {
  const modulePath = fileURLToPath(new URL("./worktreeRemovalWorker.mjs", import.meta.url));
  if (process.versions.electron) {
    const { utilityProcess } = createRequire(import.meta.url)("electron") as typeof import("electron");
    const child = utilityProcess.fork(modulePath, [], { stdio: ["ignore", "ignore", "pipe"], serviceName: "AgentEnv Worktree cleanup" });
    return { events: child, stderr: child.stderr, pid: () => child.pid, exitEvent: "exit", send: (request) => child.postMessage(request), terminate: (force) => {
      if (force && child.pid !== undefined) process.kill(child.pid, "SIGKILL"); else child.kill();
    } };
  }
  const child = fork(modulePath, [], { silent: true, execArgv: [] });
  return { events: child, stderr: child.stderr, pid: () => child.pid, exitEvent: "close", send: (request) => { child.send(request); },
    terminate: (force) => { child.kill(force ? "SIGKILL" : "SIGTERM"); } };
};

export const removeWorktreeContents = (request: RemovalRequest, signal: AbortSignal = new AbortController().signal,
  options: { timeoutMs?: number; onDiagnostic?: (value: WorktreeRemovalDiagnostics) => void } = {}): Promise<void> => {
  if (signal.aborted) return Promise.reject(new WorktreeRemovalCancelledError());
  const timeoutMs = Math.min(options.timeoutMs ?? WORKTREE_REMOVAL_TIMEOUT_MS, WORKTREE_REMOVAL_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new WorktreeRemovalTimeoutError());
  const startedAt = performance.now(), deadlineAt = startedAt + timeoutMs;
  return new Promise((resolve, reject) => {
    const diagnostic: WorktreeRemovalDiagnostics = { stage: "starting", elapsedMs: 0, exitConfirmed: false, forceKillRequested: false };
    const snapshot = () => ({ ...diagnostic, elapsedMs: Math.round(performance.now() - startedAt) });
    const report = () => { try { options.onDiagnostic?.(snapshot()); } catch { /* Evidence must not control deletion. */ } };
    report();
    const child = startProcess();
    let result: { ok: boolean; error?: { message?: string; code?: string } } | undefined;
    let processError: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      diagnostic.stderr = `${diagnostic.stderr ?? ""}${String(chunk)}`.slice(-8192);
    });
    const terminate = () => {
      try { child.terminate(); } catch { /* Exit is authoritative, not a kill request. */ }
      killTimer ??= setTimeout(() => { diagnostic.forceKillRequested = true; try { child.terminate(true); } catch { /* Wait for the owned process to exit. */ } }, 750);
    };
    const timeout = () => { timedOut = true; terminate(); };
    const deadlineTimer = setTimeout(timeout, Math.max(0, deadlineAt - performance.now()));
    signal.addEventListener("abort", terminate, { once: true });
    child.events.once("spawn", () => {
      diagnostic.pid = child.pid(); diagnostic.stage = "spawned"; report();
      if (signal.aborted) terminate();
      else if (timedOut || performance.now() >= deadlineAt) timeout();
      else { try { child.send(request); } catch (error) { processError = error as Error; terminate(); } }
    });
    child.events.on("message", (message) => {
      if (message && ["ready", "validating", "removing"].includes(message.stage)) {
        diagnostic.stage = message.stage; report(); return;
      }
      if (!message || typeof message.ok !== "boolean") return;
      result = message;
      diagnostic.stage = message.ok ? "completed" : "failed"; report();
      terminate();
    });
    child.events.once("error", (error) => { processError = error instanceof Error ? error : new Error("Worktree cleanup process failed"); terminate(); });
    child.events.once(child.exitEvent, (code: number | null, exitSignal?: string | null) => {
      clearTimeout(killTimer); clearTimeout(deadlineTimer); signal.removeEventListener("abort", terminate);
      diagnostic.exitConfirmed = true;
      if (typeof code === "number") diagnostic.exitCode = code;
      if (exitSignal) diagnostic.exitSignal = exitSignal;
      report();
      if (result?.ok) resolve();
      else if (signal.aborted) reject(new WorktreeRemovalCancelledError());
      else if (timedOut) reject(new WorktreeRemovalTimeoutError(snapshot()));
      else reject(processError ?? Object.assign(new Error(result?.error?.message ?? "Worktree cleanup process exited before completion"), { code: result?.error?.code }));
    });
  });
};
