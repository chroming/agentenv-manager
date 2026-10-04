import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  }, service);
  const invoke = (channel: string) => handlers.get(channel)!({} as Electron.IpcMainInvokeEvent);
  return { diagnostics, invoke };
};

describe("Worktree scan IPC lifecycle", () => {
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
