import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorktreeCleanupPreview, WorktreeRecoveryRecord } from "../../src/shared/worktrees";
import type { IpcHandler } from "../../src/main/ipc/registration";
import type { ProjectStore } from "../../src/main/projects/projectStore";
import { createRuntimeDiagnostics } from "../../src/main/runtimeDiagnostics";
import type { GitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { registerWorktreeIpc } from "../../src/main/worktrees/worktreeIpc";
import { createWorktreeService } from "../../src/main/worktrees/worktreeService";

let root = "";
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const fixture = async (gitAvailable = true) => {
  root = await mkdtemp(join(tmpdir(), "agentenv-worktree-ipc-"));
  const scanRoot = join(root, "scan");
  await mkdir(scanRoot);
  const diagnostics = createRuntimeDiagnostics({
    directory: join(root, "logs"), homeDir: root, appVersion: "test", packaged: false,
    platform: process.platform, arch: process.arch, osVersion: "test", locale: "en"
  });
  const service = createWorktreeService({
    appDataRoot: join(root, "data"), homeDir: join(root, "home"),
    projectStore: { listLocalRootPaths: async () => [scanRoot] } as unknown as ProjectStore,
    resolveRunner: async () => gitAvailable ? {
      run: async () => { throw new Error("Not a Git repository"); }
    } as unknown as GitCommandRunner : undefined
  });
  const handlers = new Map<string, IpcHandler>();
  registerWorktreeIpc({
    diagnosticHandle: (channel, handler) => handlers.set(channel, (event, ...args) =>
      diagnostics.runIpcOperation(channel, args, () => handler(event, ...args))),
    handleMutation: (channel, handler) => handlers.set(channel, handler)
  }, service, diagnostics);
  const sender = { isDestroyed: vi.fn(() => false), send: vi.fn() };
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender } as unknown as Electron.IpcMainInvokeEvent, ...args);
  return { diagnostics, invoke, service, sender, handlers };
};

describe("Worktree scan IPC lifecycle", () => {
  it("cancels the current removal without entering the mutation queue again", async () => {
    const { invoke, service, handlers } = await fixture();
    const result = { id: "retained", mode: "permanent", cancelled: true } as WorktreeRecoveryRecord;
    let finish!: () => void;
    let signal: AbortSignal | undefined;
    vi.spyOn(service, "remove").mockImplementation(async (_preview, progress, cancellation) => {
      signal = cancellation;
      progress?.("removing");
      await new Promise<void>((done) => { finish = done; signal?.addEventListener("abort", () => done(), { once: true }); });
      return result;
    });
    const requestId = "00000000-0000-4000-8000-000000000001";
    const pending = invoke("worktrees:remove", { entry: { path: "/trash/fixture/files" } } as WorktreeCleanupPreview, requestId);
    try {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(await handlers.get("worktrees:cancel-remove")!({ sender: {} } as Electron.IpcMainInvokeEvent, requestId)).toBe(false);
      expect(signal?.aborted).toBe(false);
      expect(await invoke("worktrees:cancel-remove", requestId)).toBe(true);
      expect(signal?.aborted).toBe(true);
      expect(await pending).toBe(result);
      expect(await invoke("worktrees:cancel-remove", requestId)).toBe(false);
    } finally { finish(); await pending; }
  });
  it("keeps a pending removal observable without restarting work or claiming completed items", async () => {
    const { invoke, service, sender, diagnostics } = await fixture();
    const record = vi.spyOn(diagnostics, "record");
    let finish!: () => void;
    vi.spyOn(service, "remove").mockImplementation(async (_preview, progress) => {
      progress?.("removing");
      await new Promise<void>((done) => { finish = done; });
      return { id: "done" } as WorktreeRecoveryRecord;
    });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const requestId = "00000000-0000-4000-8000-000000000001";
    const pending = invoke("worktrees:remove", { entry: { path: "/trash/fixture/files" } } as WorktreeCleanupPreview, requestId);
    try {
      await vi.advanceTimersByTimeAsync(16_000);
      expect(sender.send.mock.calls.length).toBeGreaterThan(1);
      expect(sender.send).toHaveBeenLastCalledWith("worktrees:progress", expect.objectContaining({
        requestId, phase: "removing", completed: 0, elapsedMs: 16_000
      }));
      expect(service.remove).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith("worktrees:remove", "stage-started", expect.objectContaining({ context: expect.objectContaining({ stage: "removing" }) }));
      expect(record).toHaveBeenCalledWith("worktrees:remove", "stage-running", expect.objectContaining({ durationMs: 15_000 }));
      finish(); await pending;
      const sent = sender.send.mock.calls.length;
      await vi.advanceTimersByTimeAsync(16_000);
      expect(sender.send).toHaveBeenCalledTimes(sent);
    } finally { finish(); await pending; vi.useRealTimers(); }
  });
  it("does not hold a completed removal hostage to stalled stage logging", async () => {
    const { invoke, service, diagnostics } = await fixture();
    vi.spyOn(diagnostics, "record").mockImplementation(() => new Promise(() => {}));
    const result = { id: "removed" } as WorktreeRecoveryRecord;
    vi.spyOn(service, "remove").mockImplementation(async (_preview, progress) => { progress?.("removing"); return result; });
    const started = performance.now();
    expect(await invoke("worktrees:remove", { entry: { path: "/trash/fixture/files" } })).toBe(result);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it("supports callbacks that only provide legacy item counts or phase strings", async () => {
    const { invoke, service, sender } = await fixture();
    const preview = { entry: { path: "/tree" } } as WorktreeCleanupPreview;
    const ready = { path: "/tree", preview };
    const record = { id: "removed" } as WorktreeRecoveryRecord;
    vi.spyOn(service, "previewBatch").mockImplementation(async (_items, progress) => {
      progress?.(1, ready.path);
      return [ready];
    });
    vi.spyOn(service, "remove").mockImplementation(async (_preview, progress) => {
      progress?.("preparing");
      return record;
    });
    const requestId = "00000000-0000-4000-8000-000000000001";
    expect(await invoke("worktrees:preview-batch", [{ commonDir: "/repo/.git", path: ready.path, allowDirty: false }], requestId)).toEqual([ready]);
    expect(sender.send).toHaveBeenLastCalledWith("worktrees:progress", {
      requestId, phase: "preparing", path: ready.path, completed: 1, total: 1
    });
    expect(await invoke("worktrees:remove", preview, requestId)).toBe(record);
    expect(sender.send).toHaveBeenLastCalledWith("worktrees:progress", {
      requestId, phase: "preparing", path: ready.path, completed: 0, total: 1
    });
  });

  it("forwards each finished preparation on the existing channel before the authoritative batch response", async () => {
    const { invoke, service, sender } = await fixture();
    const preview = { previewId: "ready", entry: { path: "/tree" } } as WorktreeCleanupPreview;
    const ready = { path: "/tree", preview };
    const failed = { path: "/protected", error: "Protected Worktree" };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(service, "previewBatch").mockImplementation(async (_items, progress) => {
      progress?.(1, ready.path, ready);
      await gate;
      progress?.(2, failed.path, failed);
      return [ready, failed];
    });
    const requestId = "00000000-0000-4000-8000-000000000001";
    let finished = false;
    const pending = invoke("worktrees:preview-batch", [
      { commonDir: "/repo/.git", path: ready.path, allowDirty: false },
      { commonDir: "/repo/.git", path: failed.path, allowDirty: true }
    ], requestId).then((value: unknown) => { finished = true; return value; });
    try {
      expect(sender.send).toHaveBeenCalledExactlyOnceWith("worktrees:progress", {
        requestId, phase: "preparing", path: ready.path, completed: 1, total: 2, preparation: ready
      });
      expect(finished).toBe(false);
    } finally { release(); }
    expect(await pending).toMatchObject([ready, { path: failed.path, error: expect.stringContaining(failed.error) }]);
    expect(sender.send).toHaveBeenLastCalledWith("worktrees:progress", {
      requestId, phase: "preparing", path: failed.path, completed: 2, total: 2, preparation: failed
    });
  });

  it("forwards file counters without treating every update as a new diagnostic stage", async () => {
    const { invoke, service, sender, diagnostics } = await fixture();
    const preview = { entry: { path: "/tree" } } as WorktreeCleanupPreview;
    const record = { id: "removed" } as WorktreeRecoveryRecord;
    const fileProgress = { step: "copying" as const, filesCounted: 2, bytesCounted: 1234 };
    vi.spyOn(service, "remove").mockImplementation(async (_preview, progress) => {
      progress?.("preparing");
      progress?.("backing-up");
      progress?.("backing-up", fileProgress);
      progress?.("backing-up", { ...fileProgress, filesCounted: 3, bytesCounted: 2345 });
      progress?.("removing");
      progress?.("verifying");
      return record;
    });
    const requestId = "00000000-0000-4000-8000-000000000001";
    expect(await invoke("worktrees:remove", preview, requestId)).toBe(record);
    expect(sender.send).toHaveBeenCalledWith("worktrees:progress", {
      requestId, phase: "backing-up", path: "/tree", completed: 0, total: 1, fileProgress
    });
    const stages = (await diagnostics.readRecentEvents()).filter((event) => event.phase === "stage-finished");
    expect(stages.map((event) => event.context?.stage)).toEqual(["preparing", "backing-up", "removing", "verifying"]);
  });

  it.each(["destroyed", "throwing"])("keeps preview and removal results authoritative with a %s renderer", async (mode) => {
    const { invoke, service, sender } = await fixture();
    if (mode === "destroyed") sender.isDestroyed.mockReturnValue(true);
    else sender.send.mockImplementation(() => { throw new Error("renderer closed"); });
    const preview = { entry: { path: "/tree" } } as WorktreeCleanupPreview;
    const ready = { path: "/tree", preview };
    const record = { id: "removed" } as WorktreeRecoveryRecord;
    vi.spyOn(service, "previewBatch").mockImplementation(async (_items, progress) => {
      progress?.(1, ready.path, ready);
      return [ready];
    });
    vi.spyOn(service, "remove").mockImplementation(async (_preview, progress) => {
      progress?.("preparing");
      progress?.("backing-up", { step: "copying", filesCounted: 1, bytesCounted: 20 });
      return record;
    });
    const requestId = "00000000-0000-4000-8000-000000000001";
    await expect(invoke("worktrees:preview-batch", [{ commonDir: "/repo/.git", path: ready.path, allowDirty: false }], requestId)).resolves.toEqual([ready]);
    await expect(invoke("worktrees:remove", preview, requestId)).resolves.toBe(record);
    if (mode === "destroyed") expect(sender.send).not.toHaveBeenCalled();
  });

  it("keeps batch-preview failures copyable without losing independently prepared trees", async () => {
    const { diagnostics, invoke, service } = await fixture();
    vi.spyOn(service, "previewBatch").mockResolvedValue([
      { path: "/tree", preview: { previewId: "ready" } as import("../../src/shared/worktrees").WorktreeCleanupPreview },
      { path: "/protected", error: "Git operation in progress" }
    ]);
    const results = await invoke("worktrees:preview-batch", [
      { commonDir: "/repo/.git", path: "/tree", allowDirty: false },
      { commonDir: "/repo/.git", path: "/protected", allowDirty: true }
    ], "00000000-0000-4000-8000-000000000001");
    expect(results[0].preview.previewId).toBe("ready");
    expect(results[1].error).toMatch(/Diagnostic reference: AEM-/);
    expect(await diagnostics.readLatestIssue()).toMatchObject({ action: "worktrees:preview-batch", error: { message: expect.stringContaining("Git operation in progress") } });
    expect((await diagnostics.readRecentEvents()).find((event) => event.phase === "prepared-worktrees")?.outcome).toBe("partial");
  });
  it("returns a cancellation outcome without creating a diagnostic issue", async () => {
    const { diagnostics, invoke } = await fixture();
    const pending = invoke("worktrees:inventory");
    await invoke("worktrees:cancel-scan");
    await expect(pending).resolves.toEqual({ cancelled: true });
    const events = (await diagnostics.readRecentEvents()).filter((event) => event.action === "worktrees:inventory");
    expect(events.map((event) => event.phase)).toEqual(["started", "completed"]);
    expect(events[1].outcome).toBe("cancelled");
    expect(events[1].error).toBeUndefined();
    expect(await diagnostics.readLatestIssue()).toBeUndefined();
  });

  it("keeps a real scan failure visible and diagnosable", async () => {
    const { diagnostics, invoke } = await fixture(false);
    await expect(invoke("worktrees:inventory")).rejects.toThrow("System Git is unavailable");
    expect(await diagnostics.readLatestIssue()).toMatchObject({
      action: "worktrees:inventory", error: { message: "System Git is unavailable" }
    });
    expect((await diagnostics.readRecentEvents()).find((event) => event.phase === "failed")?.outcome).toBe("failed");
  });
});
