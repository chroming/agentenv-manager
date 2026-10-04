// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    readDiagnosticIssue: vi.fn().mockResolvedValue(undefined),
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
    expect(screen.getByRole("button", { name: "Refresh Worktrees" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Scanning Worktrees...")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Scan locations" }));
    expect(screen.getByText("/home/user/.config/superpowers/worktrees")).toBeInTheDocument();
    expect(screen.getByText("Common location")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove scan location" })).toHaveLength(1);
  });

  it("keeps the list in place while details use the shared modal, including Escape and maximize", async () => {
    installApi();
    render(<WorktreeWorkspace />);
    const name = await screen.findByRole("button", { name: /^clean$/ });
    name.focus();
    fireEvent.click(name);
    const modal = screen.getByRole("dialog", { name: "clean" });
    expect(within(modal).getByText("/projects/app")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Worktrees" })).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "Maximize window" }));
    expect(modal).toHaveClass("ui-modal--maximized");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(name).toHaveFocus();
  });

  it("filters by branch, repository and path without losing the full inventory", async () => {
    installApi();
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/dirty");
    const search = screen.getByRole("searchbox", { name: "Search Worktrees" });
    fireEvent.change(search, { target: { value: "dirty" } });
    expect(screen.queryByText("/projects/_worktrees/clean")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "/projects/app" } });
    expect(screen.getByText("/projects/_worktrees/clean")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "no-match" } });
    expect(screen.getByText("No Worktrees found")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("/projects/_worktrees/dirty")).toBeInTheDocument();
  });

  it("sorts locally, persists the preference and preserves selected paths across refresh", async () => {
    const api = installApi();
    const onUpdateUiState = vi.fn();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [
      { ...clean, sizeBytes: 1 }, { ...dirty, sizeBytes: 100 }
    ] });
    render(<WorktreeWorkspace onUpdateUiState={onUpdateUiState} />);
    await screen.findByText(clean.path);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Worktree for review" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort Worktrees: Name" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Largest size" }));
    expect(onUpdateUiState).toHaveBeenCalledWith({ worktreeSort: "size-desc" });
    expect(screen.getByRole("checkbox", { name: "Select Worktree for review" })).toBeChecked();
    expect(api.inventoryWorktrees).toHaveBeenCalledTimes(1);
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
    const paths = () => [...document.querySelectorAll(".worktree-dialog__entries .ui-resource-row__identity > span")]
      .map((element) => element.textContent);
    expect(paths()).toEqual([dirty.path, clean.path]);
    expect([...document.querySelectorAll(".worktree-dialog__entries .ui-catalog-sort-metric")].map((element) => element.textContent))
      .toEqual(["100 B", "1 B"]);
    expect(screen.getByLabelText("Total size: 101 B")).toHaveTextContent("101 B");
    fireEvent.click(screen.getByRole("button", { name: "Refresh Worktrees" }));
    await waitFor(() => expect(api.inventoryWorktrees).toHaveBeenCalledTimes(2));
    expect(paths()).toEqual([dirty.path, clean.path]);
    fireEvent.click(screen.getByRole("tab", { name: "Kept" }));
    expect(screen.getByText("No kept Worktrees")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(paths()).toEqual([dirty.path, clean.path]);
  });

  it("shows unknown measurements as unavailable, not zero or a different field", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [
      { ...clean, sizeBytes: 0, modifiedAt: "2026-10-01T10:00:00Z" },
      { ...dirty, modifiedAt: "invalid" }
    ] });
    render(<WorktreeWorkspace uiState={{ worktreeSort: "size-desc" }} />);
    await screen.findByText(clean.path);
    expect(screen.getByLabelText("Size: 0 B")).toHaveTextContent("0 B");
    expect(screen.getByLabelText("Size: Unavailable")).toHaveTextContent("Unavailable");
    expect(screen.getByLabelText("Total size: Unavailable")).toHaveTextContent("Unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Sort Worktrees: Largest size" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Newest modified" }));
    expect(screen.getAllByLabelText("Last modified: Unavailable")).toHaveLength(2);
    expect(api.inventoryWorktrees).toHaveBeenCalledTimes(1);
  });

  it("restores the supplied preference and closes only the sorting menu on Escape inside a dialog", async () => {
    installApi();
    const onClose = vi.fn();
    const { rerender } = render(<WorktreeDialog open onClose={onClose} uiState={{ worktreeSort: "status" }} />);
    await screen.findByText(clean.path);
    const trigger = screen.getByRole("button", { name: "Sort Worktrees: Cleanup status" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "Cleanup status" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    rerender(<WorktreeDialog open onClose={onClose} uiState={{ worktreeSort: "modified-desc" }} />);
    expect(screen.getByRole("button", { name: "Sort Worktrees: Newest modified" })).toBeInTheDocument();
  });

  it("does not turn repositories with only a main tree into worktree cleanup rows", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [{ ...clean, main: true, cleanupReviewAvailable: false }] });
    render(<WorktreeWorkspace />);
    await screen.findByText("No Worktrees found");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps scan issues inspectable inside the scope dialog rather than in a moving banner", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, incomplete: true, issues: ["/projects/restricted: Permission denied"] });
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/clean");
    expect(screen.queryByText("/projects/restricted: Permission denied")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scan locations" }));
    expect(within(screen.getByRole("dialog")).getByText("/projects/restricted: Permission denied")).toBeInTheDocument();
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

  it("shows cleanup failures in the active result dialog with a copyable diagnostic instead of a success", async () => {
    const api = installApi();
    api.removeWorktree.mockRejectedValueOnce(new Error("Worktree changed after review. Diagnostic reference: AEM-20261004-ABC123"));
    render(<WorktreeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /^clean$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review cleanup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove Worktree" }));
    const modal = await screen.findByRole("dialog", { name: "Cleanup results" });
    expect(await within(modal).findByText("Skipped")).toBeInTheDocument();
    expect(within(modal).queryByText("Removed")).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining("AEM-20261004-ABC123")));
    expect(screen.getByText("/projects/_worktrees/dirty")).toBeInTheDocument();
  });

  it("shows recovery loading on its own command before opening the dialog", async () => {
    const api = installApi();
    let finish!: (value: { records: []; issues: [] }) => void;
    api.listWorktreeRecovery.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/clean");
    fireEvent.click(screen.getByRole("button", { name: "Worktree recovery" }));
    expect(screen.getByRole("button", { name: "Worktree recovery" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Refresh Worktrees" })).toHaveAttribute("aria-busy", "false");
    await act(async () => finish({ records: [], issues: [] }));
    expect(screen.getByRole("dialog", { name: "Worktree recovery" })).toBeInTheDocument();
  });
});
