import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcHandler } from "../../src/main/ipc/registration";
import type { ProjectStore } from "../../src/main/projects/projectStore";
import { createRuntimeDiagnostics } from "../../src/main/runtimeDiagnostics";
import type { GitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { registerWorktreeIpc } from "../../src/main/worktrees/worktreeIpc";
import { createWorktreeService } from "../../src/main/worktrees/worktreeService";

let root = "";
afterEach(async () => {
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
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: { isDestroyed: () => false, send: vi.fn() } } as unknown as Electron.IpcMainInvokeEvent, ...args);
  return { diagnostics, invoke, service };
};

describe("Worktree scan IPC lifecycle", () => {
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
