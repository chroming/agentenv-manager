import { fork } from "node:child_process";
import type { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export class WorktreeRemovalCancelledError extends Error {
  constructor() { super("Worktree deletion stopped; remaining contents stay in Trash"); this.name = "WorktreeRemovalCancelledError"; }
}

interface RemovalRequest { path: string; device: string; inode: string }
interface RemovalProcess {
  events: EventEmitter;
  exitEvent: "exit" | "close";
  send(request: RemovalRequest): void;
  terminate(force?: boolean): void;
}

const startProcess = (): RemovalProcess => {
  const modulePath = fileURLToPath(new URL("./worktreeRemovalWorker.mjs", import.meta.url));
  if (process.versions.electron) {
    const { utilityProcess } = createRequire(import.meta.url)("electron") as typeof import("electron");
    const child = utilityProcess.fork(modulePath, [], { stdio: "ignore", serviceName: "AgentEnv Worktree cleanup" });
    return { events: child, exitEvent: "exit", send: (request) => child.postMessage(request), terminate: (force) => {
      if (force && child.pid !== undefined) process.kill(child.pid, "SIGKILL"); else child.kill();
    } };
  }
  const child = fork(modulePath, [], { silent: true, execArgv: [] });
  return { events: child, exitEvent: "close", send: (request) => { child.send(request); },
    terminate: (force) => { child.kill(force ? "SIGKILL" : "SIGTERM"); } };
};

export const removeWorktreeContents = (request: RemovalRequest, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return Promise.reject(new WorktreeRemovalCancelledError());
  return new Promise((resolve, reject) => {
    const child = startProcess();
    let result: { ok: boolean; error?: { message?: string; code?: string } } | undefined;
    let processError: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      try { child.terminate(); } catch { /* Exit is authoritative, not a kill request. */ }
      killTimer ??= setTimeout(() => { try { child.terminate(true); } catch { /* Wait for the owned process to exit. */ } }, 750);
      killTimer.unref?.();
    };
    signal.addEventListener("abort", terminate, { once: true });
    child.events.once("spawn", () => {
      if (signal.aborted) terminate();
      else { try { child.send(request); } catch (error) { processError = error as Error; terminate(); } }
    });
    child.events.once("message", (message) => {
      if (message && typeof message.ok === "boolean") result = message;
      terminate();
    });
    child.events.once("error", (error) => { processError = error instanceof Error ? error : new Error("Worktree cleanup process failed"); terminate(); });
    child.events.once(child.exitEvent, () => {
      clearTimeout(killTimer); signal.removeEventListener("abort", terminate);
      if (result?.ok) resolve();
      else if (signal.aborted) reject(new WorktreeRemovalCancelledError());
      else reject(processError ?? Object.assign(new Error(result?.error?.message ?? "Worktree cleanup process exited before completion"), { code: result?.error?.code }));
    });
  });
};
