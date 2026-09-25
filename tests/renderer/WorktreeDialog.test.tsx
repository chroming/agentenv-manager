// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorktreeDialog } from "../../src/renderer/components/WorktreeDialog";
import type { AgentEnvApi } from "../../src/shared/types";
import type { WorktreeEntry, WorktreeInventory } from "../../src/shared/worktrees";

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
  scanRoots: ["/projects"], configuredRoots: ["/projects"], entries: [clean, dirty],
  issues: [], incomplete: false, scannedAt: "2026-09-24T00:00:00.000Z"
};

const installApi = () => {
  const api = {
    inventoryWorktrees: vi.fn().mockResolvedValue(inventory),
    cancelWorktreeScan: vi.fn().mockResolvedValue(undefined),
    selectWorktreeScanRoot: vi.fn().mockResolvedValue(undefined),
    previewWorktreeCleanup: vi.fn().mockResolvedValue({
      previewId: "review-1", entry: clean, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: true, forceRequired: false
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
});
