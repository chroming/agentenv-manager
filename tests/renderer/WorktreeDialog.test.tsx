// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorktreeDialog, WorktreeWorkspace } from "../../src/renderer/components/WorktreeDialog";
import type { AgentEnvApi } from "../../src/shared/types";
import type { WorktreeEntry, WorktreeInventory, WorktreeScanResult } from "../../src/shared/worktrees";

const clean: WorktreeEntry = {
  path: "/projects/_worktrees/clean", repositoryPath: "/projects/app",
  commonDir: "/projects/app/.git", head: "a".repeat(40), branch: "clean",
  main: false, detached: false, exists: true, state: "review", reasons: [],
  changes: [], ignored: [], submodules: false, cleanupReviewAvailable: true,
  manualReviewAvailable: true, headNeedsProtection: false
};
const dirty: WorktreeEntry = {
  ...clean, path: "/projects/_worktrees/dirty", branch: "dirty",
  changes: [" M README.md"], reasons: ["1 changed or untracked paths"],
  cleanupReviewAvailable: false
};
const inventory: WorktreeInventory = {
  scanRoots: ["/projects"], configuredRoots: ["/projects"], builtinRoots: [], entries: [clean, dirty],
  issues: [], incomplete: false, scannedAt: "2026-09-24T00:00:00.000Z"
};

const installApi = () => {
  const api = {
    inventoryWorktrees: vi.fn().mockResolvedValue(inventory),
    cancelWorktreeScan: vi.fn().mockResolvedValue(undefined),
    selectWorktreeScanRoot: vi.fn().mockResolvedValue(undefined),
    previewWorktreeCleanup: vi.fn().mockResolvedValue({
      previewId: "review-1", entry: clean, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: true, forceRequired: false,
      savedWorkspace: false
    }),
    listWorktreeRecovery: vi.fn().mockResolvedValue({ records: [], issues: [] }),
    copyText: vi.fn().mockResolvedValue(undefined)
  };
  Object.defineProperty(window, "agentEnv", { configurable: true, value: api as unknown as AgentEnvApi });
  return api;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreeDialog", () => {
  it("keeps the current scan busy when StrictMode cancels the previous mount", async () => {
    const api = installApi();
    let cancelFirst!: () => void;
    let completeCurrent!: (value: WorktreeInventory) => void;
    api.inventoryWorktrees
      .mockImplementationOnce(() => new Promise((_, reject) => {
        cancelFirst = () => reject(new Error("Worktree scan cancelled"));
      }))
      .mockImplementationOnce(() => new Promise((resolve) => { completeCurrent = resolve; }));
    api.cancelWorktreeScan.mockImplementationOnce(async () => cancelFirst());
    render(<StrictMode><WorktreeWorkspace /></StrictMode>);
    await waitFor(() => expect(api.inventoryWorktrees).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop scanning" })).toBeInTheDocument();
    await act(async () => completeCurrent(inventory));
    await screen.findByText("/projects/_worktrees/clean");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Worktrees" })).toBeInTheDocument();
  });

  it("retains the complete inventory when the user stops a refresh", async () => {
    const api = installApi();
    let finishScan!: (value: WorktreeScanResult) => void;
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/clean");
    api.inventoryWorktrees.mockImplementationOnce(() => new Promise((resolve) => { finishScan = resolve; }));
    api.cancelWorktreeScan.mockImplementationOnce(async () => finishScan({ cancelled: true }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh Worktrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop scanning" }));
    await screen.findByRole("button", { name: "Refresh Worktrees" });
    expect(screen.getByText("/projects/_worktrees/clean")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Worktrees" }));
    await screen.findByRole("button", { name: "Refresh Worktrees" });
    expect(api.inventoryWorktrees).toHaveBeenCalledTimes(3);
  });

  it("ignores a late inventory from a closed dialog after it is reopened", async () => {
    const api = installApi();
    let completeOld!: (value: WorktreeInventory) => void;
    let completeCurrent!: (value: WorktreeInventory) => void;
    api.inventoryWorktrees
      .mockImplementationOnce(() => new Promise((resolve) => { completeOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { completeCurrent = resolve; }));
    const onClose = vi.fn();
    const { rerender } = render(<WorktreeDialog open onClose={onClose} />);
    rerender(<WorktreeDialog open={false} onClose={onClose} />);
    rerender(<WorktreeDialog open onClose={onClose} />);
    await act(async () => completeOld(inventory));
    expect(screen.queryByText("/projects/_worktrees/clean")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop scanning" })).toBeInTheDocument();
    await act(async () => completeCurrent({ ...inventory, entries: [dirty] }));
    await screen.findByText("/projects/_worktrees/dirty");
    expect(screen.queryByText("/projects/_worktrees/clean")).not.toBeInTheDocument();
  });

  it("shows actual scan errors and allows retry", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockRejectedValueOnce(new Error("System Git is unavailable"));
    render(<WorktreeWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent("System Git is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Refresh Worktrees" }));
    await screen.findByText("/projects/_worktrees/clean");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps common scan locations read-only on the standalone page", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({
      ...inventory, scanRoots: ["/projects", "/home/user/.config/superpowers/worktrees"],
      builtinRoots: ["/home/user/.config/superpowers/worktrees"]
    });
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/clean");
    fireEvent.click(screen.getByText("Scan locations · 2"));
    expect(screen.getByText("/home/user/.config/superpowers/worktrees")).toBeInTheDocument();
    expect(screen.getByText("Common location")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove scan location" })).toHaveLength(1);
  });
  it("keeps batch cleanup limited to clean trees and requires explicit review for dirty trees", async () => {
    const api = installApi();
    render(<WorktreeDialog open onClose={vi.fn()} />);
    await screen.findByText("/projects/_worktrees/dirty");
    expect(screen.getAllByRole("checkbox", { name: "Select Worktree for review" })).toHaveLength(1);
    const dirtyRow = screen.getByText("/projects/_worktrees/dirty").closest(".ui-resource-row");
    expect(dirtyRow).not.toBeNull();
    fireEvent.click(dirtyRow!.querySelector("button")!);
    expect(screen.getByRole("button", { name: "Review cleanup" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", {
      name: "I reviewed this worktree and want to remove its local contents after a verified recovery copy is saved."
    }));
    expect(screen.getByRole("button", { name: "Review cleanup" })).toBeEnabled();
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
  });

  it("exposes recovery even when no worktrees are found", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [] });
    render(<WorktreeDialog open onClose={vi.fn()} />);
    await screen.findByText("No Worktrees found");
    fireEvent.click(screen.getByRole("button", { name: "Worktree recovery" }));
    await waitFor(() => expect(api.listWorktreeRecovery).toHaveBeenCalledOnce());
    expect(screen.getByText("No Worktree recovery points")).toBeInTheDocument();
  });

  it("distinguishes an empty filter from an empty inventory", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [{ ...clean, state: "candidate" }] });
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/clean");
    expect(screen.getByText("Clean")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Kept" }));
    expect(screen.getByText("No kept Worktrees")).toBeInTheDocument();
    expect(screen.queryByText("No Worktrees found")).not.toBeInTheDocument();
  });

  it("does not offer Restore for an interrupted cleanup", async () => {
    const api = installApi();
    api.listWorktreeRecovery.mockResolvedValue({ records: [{
      id: "recovery-1", path: "/projects/_worktrees/clean", repositoryPath: "/projects/app",
      head: "a".repeat(40), createdAt: inventory.scannedAt, status: "prepared"
    }], issues: [] });
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/clean");
    fireEvent.click(screen.getByRole("button", { name: "Worktree recovery" }));
    await screen.findByText("Cleanup interrupted");
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.getByText(/original folder and Git registration/)).toBeInTheDocument();
  });
});
