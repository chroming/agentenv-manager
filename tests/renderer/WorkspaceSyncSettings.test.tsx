// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it.each([
    ["local-changes", "Publish"],
    ["remote-changes", "Update this device"],
    ["review-required", "Resolve changes"]
  ] as const)("names the %s action by its outcome", async (kind, action) => {
    const status: WorkspaceSyncStatus = {
      kind,
      connection: { repository: "git@github.com:me/workspace.git", branch: "main" },
      localChangeCount: kind === "remote-changes" ? 0 : 1,
      remoteChangeCount: kind === "local-changes" ? 0 : 1,
      conflictCount: kind === "review-required" ? 1 : 0,
      immediateAgentCount: 0
    };
    const api = {
      readWorkspaceSyncStatus: vi.fn().mockResolvedValue(status),
      checkWorkspaceSync: vi.fn().mockResolvedValue(status)
    } as unknown as AgentEnvApi;
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });

    render(<WorkspaceSyncSettings />);

    await waitFor(() => expect(screen.getByRole("button", { name: action })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
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

  it("ends the startup checking state when a connected repository check fails", async () => {
    const status: WorkspaceSyncStatus = {
      kind: "up-to-date",
      connection: { repository: "git@github.com:me/workspace.git", branch: "main" },
      localChangeCount: 0,
      remoteChangeCount: 0,
      conflictCount: 0,
      immediateAgentCount: 0
    };
    const api = {
      readWorkspaceSyncStatus: vi.fn().mockResolvedValue(status),
      checkWorkspaceSync: vi.fn().mockRejectedValue(new Error("Network unavailable"))
    } as unknown as AgentEnvApi;
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });

    render(<WorkspaceSyncSettings />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not check"));
    expect(screen.getByRole("alert")).toHaveTextContent("Network unavailable");
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeEnabled();
  });

  it("turns an invalid remote snapshot into a safe and actionable state", async () => {
    const status: WorkspaceSyncStatus = {
      kind: "error",
      issue: "remote-snapshot-invalid",
      connection: { repository: "git@github.com:me/workspace.git", branch: "main" },
      message: "The remote Workspace snapshot could not be verified. This device was not changed.",
      localChangeCount: 0,
      remoteChangeCount: 0,
      conflictCount: 0,
      immediateAgentCount: 0
    };
    const api = {
      readWorkspaceSyncStatus: vi.fn().mockResolvedValue(status),
      checkWorkspaceSync: vi.fn().mockResolvedValue(status)
    } as unknown as AgentEnvApi;
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });

    render(<WorkspaceSyncSettings />);

    await waitFor(() => expect(screen.getByRole("status"))
      .toHaveTextContent("Remote data needs attention"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "AgentEnv did not change this device. Update AgentEnv on your other devices, then check again."
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("hash mismatch");
    expect(screen.getByRole("button", { name: "Check" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
  });

  it("replaces a stale success status when a manual check fails", async () => {
    const status: WorkspaceSyncStatus = {
      kind: "up-to-date",
      connection: { repository: "git@github.com:me/workspace.git", branch: "main" },
      localChangeCount: 0,
      remoteChangeCount: 0,
      conflictCount: 0,
      immediateAgentCount: 0
    };
    const api = {
      readWorkspaceSyncStatus: vi.fn().mockResolvedValue(status),
      checkWorkspaceSync: vi
        .fn()
        .mockResolvedValueOnce(status)
        .mockRejectedValueOnce(new Error("Remote unavailable"))
    } as unknown as AgentEnvApi;
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });

    render(<WorkspaceSyncSettings />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Up to date"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not check"));
    expect(screen.getByRole("alert")).toHaveTextContent("Remote unavailable");
  });

  it("shows a retryable unavailable state when Sync status cannot be loaded", async () => {
    const api = {
      readWorkspaceSyncStatus: vi
        .fn()
        .mockRejectedValueOnce(new Error("Unreadable Sync state"))
        .mockResolvedValueOnce({
          kind: "not-connected",
          localChangeCount: 0,
          remoteChangeCount: 0,
          conflictCount: 0,
          immediateAgentCount: 0
        })
    } as unknown as AgentEnvApi;
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });

    render(<WorkspaceSyncSettings />);

    await waitFor(() => expect(screen.getByText("Could not check")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Unreadable Sync state");
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Not configured")).toBeInTheDocument());
    expect(api.readWorkspaceSyncStatus).toHaveBeenCalledTimes(2);
  });
});
