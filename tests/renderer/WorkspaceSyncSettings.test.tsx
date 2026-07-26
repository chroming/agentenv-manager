// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  groupWorkspaceSyncChanges,
  WorkspaceSyncSettings
} from "../../src/renderer/components/WorkspaceSyncSettings";
import type { AgentEnvApi, WorkspaceSyncChange, WorkspaceSyncStatus } from "../../src/shared/types";

afterEach(() => cleanup());

describe("Workspace Sync settings", () => {
  it("groups ordinary sections by resource but keeps conflicts independently resolvable", () => {
    const base = {
      resourceKind: "profile",
      resourceId: "daily",
      title: "Daily",
      action: "add",
      detail: ""
    } as const;
    const changes: WorkspaceSyncChange[] = [
      { ...base, key: "profile:daily:manifest", section: "manifest", direction: "local" },
      { ...base, key: "profile:daily:instructions", section: "instructions", direction: "local" },
      { ...base, key: "profile:daily:resources", section: "resources", direction: "local" },
      { ...base, key: "profile:daily:conflict", section: "instructions", direction: "conflict", action: "update" }
    ];

    const rows = groupWorkspaceSyncChanges(changes);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.changes).toHaveLength(3);
    expect(rows[1]?.changes).toHaveLength(1);
    expect(rows[1]?.direction).toBe("conflict");
  });

  it("offers only recovery while an interrupted Workspace update is unresolved", async () => {
    const status: WorkspaceSyncStatus = {
      kind: "recovery-required",
      connection: { repository: "git@github.com:me/workspace.git", branch: "main" },
      message: "Recovery required",
      localChangeCount: 0,
      remoteChangeCount: 0,
      conflictCount: 0,
      immediateAgentCount: 0
    };
    const api = {
      readWorkspaceSyncStatus: vi.fn().mockResolvedValue(status),
      checkWorkspaceSync: vi.fn().mockResolvedValue(status),
      recoverWorkspaceSync: vi.fn().mockResolvedValue({ ...status, kind: "up-to-date", message: undefined })
    } as unknown as AgentEnvApi;
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });

    render(<WorkspaceSyncSettings />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Recovery required"));
    expect(screen.getByRole("button", { name: "Recover Workspace" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
    await waitFor(() => expect(api.checkWorkspaceSync).toHaveBeenCalledTimes(1));
  });
});
