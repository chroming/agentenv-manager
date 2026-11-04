// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorktreeDialog, WorktreeWorkspace } from "../../src/renderer/components/WorktreeDialog";
import type { AgentEnvApi } from "../../src/shared/types";
import type { WorktreeCleanupPreparation, WorktreeCleanupPreview, WorktreeCleanupRequest, WorktreeEntry, WorktreeInventory, WorktreeScanResult, WorktreeOperationProgress } from "../../src/shared/worktrees";

const clean: WorktreeEntry = {
  path: "/projects/_worktrees/clean", repositoryPath: "/projects/app",
  commonDir: "/projects/app/.git", head: "a".repeat(40), branch: "clean",
  main: false, detached: false, exists: true, state: "candidate", reasons: [],
  changes: [], ignored: [], submodules: false, cleanupReviewAvailable: true,
  manualReviewAvailable: true, headNeedsProtection: false, sizeBytes: 1024
};
const dirty: WorktreeEntry = {
  ...clean, path: "/projects/_worktrees/dirty", branch: "dirty",
  state: "review", changes: [" M README.md"], reasons: ["1 changed or untracked paths"],
  cleanupReviewAvailable: false
};
const inventory: WorktreeInventory = {
  scanRoots: ["/projects"], configuredRoots: ["/projects"], builtinRoots: [], entries: [clean, dirty],
  issues: [], incomplete: false, scannedAt: "2026-09-24T00:00:00.000Z"
};

const installApi = () => {
  const api = {
    cachedWorktreeInventory: vi.fn().mockResolvedValue({ inventory: undefined as WorktreeInventory | undefined, fresh: false, scanning: false }),
    inventoryWorktrees: vi.fn().mockResolvedValue(inventory),
    cancelWorktreeScan: vi.fn().mockResolvedValue(undefined),
    setWorktreeIntegrationRef: vi.fn().mockResolvedValue(undefined),
    setWorktreeRepositoryKeep: vi.fn().mockResolvedValue(undefined),
    setWorktreeKeep: vi.fn().mockResolvedValue(undefined),
    selectWorktreeScanRoot: vi.fn().mockResolvedValue(undefined),
    previewWorktreeCleanup: vi.fn().mockResolvedValue({
      mode: "trash" as const, previewId: "review-1", entry: clean, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: false, forceRequired: false,
      savedWorkspace: false
    }),
    previewWorktreeCleanupBatch: vi.fn(),
    previewWorktreeTrashDeletion: vi.fn(),
    listWorktreeRecovery: vi.fn().mockResolvedValue({ records: [], issues: [] }),
    removeWorktree: vi.fn().mockResolvedValue({ status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024 }),
    readDiagnosticIssue: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined)
  };
  api.previewWorktreeCleanupBatch.mockImplementation(async (items: WorktreeCleanupRequest[]) => Promise.all(items.map(async (item) => {
    try { return { path: item.path, preview: await api.previewWorktreeCleanup(item.commonDir, item.path, item.allowDirty, item.mode) }; }
    catch (cause) { return { path: item.path, error: String(cause) }; }
  })));
  Object.defineProperty(window, "agentEnv", { configurable: true, value: api as unknown as AgentEnvApi });
  return api;
};

const selectWorktrees = (item = "Select integrated, unchanged Worktrees", scope: "view" | "repository" = "view", container = document.body) => {
  fireEvent.click(within(container).getByRole("button", { name: `Select Worktrees in this ${scope}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
};

const readyRemoval = async (count: number, container = document.body) => {
  const button = await within(container).findByRole("button", { name: count === 1 ? "Move 1 to Trash" : `Move ${count} to Trash` });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

const preparedPreview = (entry: WorktreeEntry): WorktreeCleanupPreview => ({
  mode: "trash" as const, previewId: entry.path, entry, fingerprint: "b".repeat(64), checkedAt: inventory.scannedAt,
  backupRequired: Boolean(entry.changes.length || entry.ignored.length),
  forceRequired: Boolean(entry.changes.length || entry.ignored.length), savedWorkspace: false
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreeDialog", () => {
  it("offers permanent deletion explicitly and does not mutate until the destructive confirmation", async () => {
    const api = installApi();
    api.previewWorktreeCleanup.mockImplementation(async (_common, _path, _allowDirty, mode) => ({ ...preparedPreview(dirty), mode }));
    api.removeWorktree.mockResolvedValue({ id: "deleted", mode: "permanent", path: dirty.path, status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024 });
    render(<WorktreeWorkspace />);
    const row = (await screen.findByText(dirty.path)).closest(".ui-resource-row")! as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently..." }));
    const dialog = await screen.findByRole("dialog", { name: "Permanently delete Worktrees?" });
    expect(within(dialog).getByText("The entire folder, including uncommitted, untracked and ignored files and nested repositories, will be permanently deleted without a backup. This cannot be undone.")).toBeInTheDocument();
    const confirm = await within(dialog).findByRole("button", { name: "Permanently delete 1" });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(api.previewWorktreeCleanup).toHaveBeenCalledWith(dirty.commonDir, dirty.path, true, "permanent");
    expect(api.removeWorktree).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await screen.findByText("Deleted", { exact: true });
  });

  it("shares the same two commands in the right-click menu and returns focus on Escape", async () => {
    installApi(); render(<WorktreeWorkspace />);
    const row = (await screen.findByText(dirty.path)).closest(".ui-resource-row")! as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 200, clientY: 200 });
    const menu = screen.getByRole("menu", { name: "Worktree actions" });
    expect(within(menu).getByRole("menuitem", { name: "Move to Trash..." })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete permanently..." })).toHaveClass("ui-action-menu__item--danger");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(row).toContainElement(document.activeElement as HTMLElement);
  });

  it("empties only new Trash records, retaining legacy recovery and active directories reusing the same original path", async () => {
    const api = installApi();
    api.listWorktreeRecovery.mockResolvedValue({ records: [
      { id: "trash", mode: "trash", path: clean.path, status: "removed", createdAt: inventory.scannedAt, sourceSizeBytes: 1024 },
      { id: "legacy", path: dirty.path, status: "removed", createdAt: inventory.scannedAt, sourceSizeBytes: 1024, backupHash: "a".repeat(64) }
    ], issues: [] });
    api.previewWorktreeTrashDeletion.mockResolvedValue({ ...preparedPreview(clean), mode: "permanent", entry: { ...clean, path: "/data/worktree-trash/id/files" } });
    api.removeWorktree.mockResolvedValue({ id: "trash", mode: "permanent", path: clean.path, status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024 });
    render(<WorktreeWorkspace />); await screen.findByText(clean.path);
    fireEvent.click(screen.getByRole("button", { name: "Worktree Trash" }));
    const recovery = await screen.findByRole("dialog", { name: "Trash and recovery" });
    fireEvent.click(within(recovery).getByRole("button", { name: "Empty Trash..." }));
    const confirm = await screen.findByRole("dialog", { name: "Permanently delete Worktrees?" });
    const button = within(confirm).getByRole("button", { name: "Permanently delete 1" });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    const result = await screen.findByRole("dialog", { name: "Cleanup results" });
    await within(result).findByText("Deleted");
    expect(api.previewWorktreeTrashDeletion).toHaveBeenCalledExactlyOnceWith("trash");
    fireEvent.click(within(result).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.getByText(clean.path)).toBeInTheDocument();
  });

  it("retains ready Trash siblings when one preview fails and retries only that record", async () => {
    const api = installApi();
    api.listWorktreeRecovery.mockResolvedValue({ records: [clean, dirty].map((entry, index) => ({ id: `trash-${index}`, mode: "trash", path: entry.path, status: "removed", createdAt: inventory.scannedAt })), issues: [] });
    api.previewWorktreeTrashDeletion.mockRejectedValueOnce(new Error("One record is temporarily unavailable"))
      .mockResolvedValue({ ...preparedPreview(dirty), mode: "permanent" });
    render(<WorktreeWorkspace />); await screen.findByText(clean.path);
    fireEvent.click(screen.getByRole("button", { name: "Worktree Trash" }));
    fireEvent.click(await screen.findByRole("button", { name: "Empty Trash..." }));
    const confirm = await screen.findByRole("dialog", { name: "Permanently delete Worktrees?" });
    await within(confirm).findByText("One record is temporarily unavailable");
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Permanently delete 1" })).toBeEnabled());
    api.previewWorktreeTrashDeletion.mockResolvedValue({ ...preparedPreview(clean), mode: "permanent" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Retry review of clean" }));
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Permanently delete 2" })).toBeEnabled());
    expect(api.previewWorktreeTrashDeletion.mock.calls.map(([id]) => id)).toEqual(["trash-0", "trash-1", "trash-0"]);
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });
  it.each(["Git operation in progress", "Git operation in progress: active writer lock"])("lets cached %s be manually selected without treating the cached classification as permission", async (reason) => {
    const api = installApi();
    const unfinished = { ...dirty, manualReviewAvailable: false, reasons: [reason] };
    api.cachedWorktreeInventory.mockResolvedValue({ inventory: { ...inventory, entries: [unfinished] }, fresh: true, scanning: false });
    render(<WorktreeWorkspace />);
    const row = within((await screen.findByText(dirty.path)).closest(".ui-resource-row")! as HTMLElement);
    expect(row.getByRole("checkbox")).toBeEnabled();
    fireEvent.click(row.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Move to Trash... (1)" })).toBeEnabled();
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });

  it("keeps final removal enabled with unknown size while background measurement never completes", async () => {
    const api = installApi();
    const pending = { ...dirty, sizeBytes: undefined, modifiedAt: undefined, measurementPending: true };
    api.cachedWorktreeInventory.mockResolvedValue({ inventory: { ...inventory, measuring: true, entries: [pending] }, fresh: true, scanning: false });
    api.previewWorktreeCleanup.mockResolvedValue(preparedPreview(pending));
    render(<WorktreeWorkspace />);
    const row = within((await screen.findByText(dirty.path)).closest(".ui-resource-row")! as HTMLElement);
    fireEvent.click(row.getByRole("button", { name: "Move to Trash..." }));
    const confirm = screen.getByRole("dialog");
    const remove = await readyRemoval(1, confirm);
    expect(confirm.querySelector(".ui-detail-list")).toHaveTextContent("Space retained in Trash");
    fireEvent.click(remove);
    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledTimes(1));
    expect(api.inventoryWorktrees).not.toHaveBeenCalled();
  });

  it("streams per-item results into immediate confirmation, retaining failures and disabling removal until all checks finish", async () => {
    const api = installApi();
    let report!: (value: WorktreeOperationProgress) => void;
    Object.assign(api, { onWorktreeProgress: vi.fn((listener) => { report = listener; return () => undefined; }) });
    let finish!: (value: WorktreeCleanupPreparation[]) => void;
    let requestId = "";
    api.previewWorktreeCleanupBatch.mockImplementation((_items, id) => {
      requestId = id;
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees("Select all removable Worktrees");
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (2)" }));
    const confirm = screen.getByRole("dialog", { name: "Move Worktrees to Trash?" });
    expect(within(confirm).getAllByText("Checking...")).toHaveLength(2);
    expect(within(confirm).getByRole("button", { name: "Move 2 to Trash" })).toBeDisabled();
    expect(confirm.querySelectorAll(".ui-detail-list dd")).toHaveLength(2);
    expect(confirm.querySelectorAll(".ui-detail-list dd")[0]).toHaveTextContent("2");
    expect(confirm.querySelectorAll(".ui-detail-list dd")[1]).toHaveTextContent("\u2026");
    const ready: WorktreeCleanupPreparation = { path: clean.path, preview: preparedPreview(clean) };
    act(() => report({ requestId: "another-window", phase: "preparing", path: clean.path, completed: 1, total: 2, preparation: ready }));
    expect(within(confirm).getAllByText("Checking...")).toHaveLength(2);
    act(() => report({ requestId, phase: "preparing", path: clean.path, completed: 1, total: 2, preparation: ready }));
    expect(within(confirm).getAllByText("Checking...")).toHaveLength(1);
    expect(within(confirm).getByText("Ready")).toBeInTheDocument();
    const remove = within(confirm).getByRole("button", { name: "Move 1 to Trash" });
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(api.removeWorktree).not.toHaveBeenCalled();
    const failed: WorktreeCleanupPreparation = { path: dirty.path, error: "Git operation in progress" };
    act(() => report({ requestId, phase: "preparing", path: dirty.path, completed: 2, total: 2, preparation: failed }));
    expect(within(confirm).getByRole("alert")).toHaveTextContent(failed.error!);
    expect(within(confirm).getByText(dirty.path)).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Retry review of dirty" })).toBeDisabled();
    expect(remove).toBeDisabled();
    await act(async () => finish([ready, failed]));
    expect(await readyRemoval(1, confirm)).toBeEnabled();
    expect(within(confirm).getByRole("button", { name: "Retry review of dirty" })).toBeEnabled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledExactlyOnceWith(ready.preview, expect.any(String)));
  });

  it("retries only a failed manual item, retains ready siblings and local changes, and requires final confirmation", async () => {
    const api = installApi();
    api.previewWorktreeCleanupBatch.mockResolvedValue([
      { path: clean.path, preview: preparedPreview(clean) }, { path: dirty.path, error: "Temporary inspection failure" }
    ]);
    let finish!: (value: WorktreeCleanupPreview) => void;
    api.previewWorktreeCleanup.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees("Select all removable Worktrees", "repository");
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (2)" }));
    const confirm = await screen.findByRole("dialog", { name: "Move Worktrees to Trash?" });
    await readyRemoval(1, confirm);
    fireEvent.click(within(confirm).getByRole("button", { name: "Retry review of dirty" }));
    expect(api.previewWorktreeCleanup).toHaveBeenCalledExactlyOnceWith(dirty.commonDir, dirty.path, true, "trash");
    expect(within(confirm).getByText(clean.path)).toBeInTheDocument();
    expect(within(confirm).getByText(dirty.path)).toBeInTheDocument();
    expect(within(confirm).getByText("Ready")).toBeInTheDocument();
    expect(within(confirm).getByText("Checking...")).toBeInTheDocument();
    expect(within(confirm).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Move 1 to Trash" })).toBeDisabled();
    const reviewedDirty = { ...dirty, changes: [" M README.md", "?? notes.txt"], sizeBytes: 2048 };
    await act(async () => finish(preparedPreview(reviewedDirty)));
    expect(await readyRemoval(2, confirm)).toBeEnabled();
    expect(confirm.querySelector(".ui-detail-list")).toHaveTextContent("Selected Worktrees2Space retained in Trash3.0 KB");
    expect(within(confirm).getAllByText("Ready")).toHaveLength(2);
    expect(api.removeWorktree).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(within(screen.getByText(dirty.path).closest(".ui-resource-row")! as HTMLElement).getByRole("checkbox")).toBeChecked();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });

  it("preserves automatic selection intent through retry without blocking the chosen Trash action on Git classification", async () => {
    const api = installApi();
    api.previewWorktreeCleanup.mockRejectedValueOnce(new Error("Temporary inspection failure"))
      .mockResolvedValue(preparedPreview({ ...dirty, path: clean.path }));
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (1)" }));
    const confirm = screen.getByRole("dialog", { name: "Move Worktrees to Trash?" });
    await within(confirm).findByText("Temporary inspection failure");
    fireEvent.click(within(confirm).getByRole("button", { name: "Retry review of clean" }));
    await readyRemoval(1, confirm);
    expect(within(confirm).queryByRole("alert")).not.toBeInTheDocument();
    expect(api.previewWorktreeCleanup.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [clean.commonDir, clean.path, false], [clean.commonDir, clean.path, false]
    ]);
    expect(within(confirm).getByRole("button", { name: "Move 1 to Trash" })).toBeEnabled();
    expect(within(confirm).getByText(clean.path)).toBeInTheDocument();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });

  it.each(["missing result", "rejected batch"])("retains requested items and inline diagnostics after %s", async (failure) => {
    const api = installApi();
    if (failure === "missing result") api.previewWorktreeCleanupBatch.mockResolvedValue([{ path: clean.path, preview: preparedPreview(clean) }]);
    else api.previewWorktreeCleanupBatch.mockRejectedValue(new Error("Batch inspection unavailable"));
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees("Select all removable Worktrees");
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (2)" }));
    const confirm = screen.getByRole("dialog", { name: "Move Worktrees to Trash?" });
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Retry review of dirty" })).toBeEnabled());
    expect(within(confirm).getByText(clean.path)).toBeInTheDocument();
    expect(within(confirm).getByText(dirty.path)).toBeInTheDocument();
    expect(within(confirm).getAllByRole("alert")).toHaveLength(failure === "missing result" ? 1 : 2);
    if (failure === "missing result") expect(within(confirm).getByRole("button", { name: "Move 1 to Trash" })).toBeEnabled();
    else expect(within(confirm).getByRole("button", { name: "Move 2 to Trash" })).toBeDisabled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });

  it.each([false, true])("uses reversible Worktree ignore actions (already ignored: %s)", async (ignored) => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [{ ...clean, keptReason: ignored ? "Keep" : undefined }] });
    render(<WorktreeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "clean" }));
    const detail = screen.getByRole("dialog", { name: "clean" });
    expect(within(detail).queryByRole("button", { name: "Keep Worktree" })).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: ignored ? "Stop ignoring Worktree" : "Ignore Worktree" }));
    await waitFor(() => expect(api.setWorktreeKeep).toHaveBeenCalledExactlyOnceWith(clean.commonDir, clean.path, ignored ? undefined : "Kept by user"));
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });

  it("enriches size without resetting selection or letting a late scan reply overwrite newer metrics", async () => {
    const api = installApi();
    let publish!: (value: WorktreeInventory) => void;
    Object.assign(api, { onWorktreeInventoryChanged: vi.fn((listener) => { publish = listener; return () => undefined; }) });
    const pending = { ...inventory, measuring: true, measurementRevision: 0,
      entries: inventory.entries.map((entry) => ({ ...entry, sizeBytes: undefined, measurementPending: true })) };
    api.cachedWorktreeInventory.mockResolvedValue({ inventory: pending, fresh: false, scanning: true });
    let complete!: (value: WorktreeInventory) => void;
    api.inventoryWorktrees.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    render(<WorktreeWorkspace />);
    const row = within((await screen.findByText(clean.path)).closest(".ui-resource-row")! as HTMLElement);
    expect(row.getByText("Measuring size...")).toBeInTheDocument();
    fireEvent.click(row.getByRole("checkbox"));
    const measured = { ...pending, measuring: false, measurementRevision: 1,
      entries: pending.entries.map((entry) => ({ ...entry, measurementPending: false, sizeBytes: 2048 })) };
    act(() => publish(measured));
    await act(async () => complete(pending));
    expect(row.getByRole("checkbox")).toBeChecked();
    expect(row.getByLabelText("Size: 2.0 KB")).toBeInTheDocument();
    expect(row.queryByText("Measuring size...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to Trash... (1)" })).toBeEnabled();
  });
  it("shows actual cleanup phases only for the initiating request", async () => {
    const api = installApi();
    let report!: (value: WorktreeOperationProgress) => void;
    Object.assign(api, { onWorktreeProgress: vi.fn((listener) => { report = listener; return () => undefined; }) });
    let finish!: (value: { status: string; sourceSizeBytes: number; reclaimedSizeBytes: number }) => void;
    api.removeWorktree.mockImplementation((_preview, requestId) => {
      report({ requestId, phase: "backing-up", path: clean.path, completed: 0, total: 1 });
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<WorktreeWorkspace />);
    const row = within((await screen.findByText(clean.path)).closest(".ui-resource-row")! as HTMLElement);
    fireEvent.click(row.getByRole("button", { name: "Move to Trash..." }));
    fireEvent.click(await readyRemoval(1));
    expect(await screen.findByText("Backing up local files...")).toBeInTheDocument();
    const requestId = api.removeWorktree.mock.calls[0][1];
    act(() => report({ requestId, phase: "backing-up", path: clean.path, completed: 0, total: 1,
      fileProgress: { step: "copying", filesCounted: 17, bytesCounted: 2048 } }));
    expect(screen.getByText(/17 files found.*2.0 KB to copy/)).toBeInTheDocument();
    act(() => report({ requestId, phase: "backing-up", path: clean.path, completed: 0, total: 1,
      fileProgress: { step: "verifying-backup", filesCounted: 17, bytesCounted: 2048 } }));
    expect(screen.getByText(/Recovery copy: 17 files checked.*2.0 KB read/)).toBeInTheDocument();
    act(() => report({ requestId: "another-window", phase: "verifying", path: "/other", completed: 0, total: 1 }));
    expect(screen.queryByText("Verifying removal...")).not.toBeInTheDocument();
    await act(async () => finish({ status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024 }));
    expect(screen.queryByText("Backing up local files...")).not.toBeInTheDocument();
  });
  it("uses the main checkout only as repository context, not as a selectable or counted row", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [
      { ...clean, path: clean.repositoryPath, main: true, sizeBytes: 999999 }, clean, dirty
    ] });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    expect(screen.queryByText("Main", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(clean.repositoryPath, { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "app" })).toBeInTheDocument();
    expect(screen.getByTitle(clean.repositoryPath)).toHaveTextContent("2");
  });

  it("explicitly selects a repository's reviewable trees without running analysis or preview", async () => {
    const api = installApi();
    const locked = { ...dirty, path: "/locked", locked: "Keep", state: "kept" as const };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, dirty, locked] });
    render(<WorktreeWorkspace />);
    await screen.findByText(dirty.path);
    fireEvent.click(screen.getByRole("button", { name: "Repository actions" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Ignore repository"]);
    fireEvent.keyDown(document, { key: "Escape" });
    selectWorktrees("Select all removable Worktrees", "repository");
    expect(screen.getByRole("button", { name: "Move to Trash... (3)" })).toBeEnabled();
    expect(within(screen.getByText(dirty.path).closest(".ui-resource-row")! as HTMLElement).getByRole("checkbox")).toBeChecked();
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });
  it("combines manually selected dirty trees into one confirmation while automatic selection only adds clean trees", async () => {
    const api = installApi();
    const otherDirty = { ...dirty, path: "/projects/_worktrees/dirty-two", ignored: ["cache/"] };
    const entries = [clean, dirty, otherDirty];
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries });
    api.previewWorktreeCleanup.mockImplementation(async (_commonDir, path) => ({
      mode: "trash" as const, previewId: path, entry: entries.find((entry) => entry.path === path)!, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: path !== clean.path, forceRequired: path !== clean.path, savedWorkspace: false
    }));
    render(<WorktreeWorkspace />);
    const row = (path: string) => within(screen.getByText(path).closest(".ui-resource-row")! as HTMLElement);
    await screen.findByText(dirty.path);
    fireEvent.click(row(dirty.path).getByRole("checkbox", { name: "Select Worktree for review" }));
    selectWorktrees();
    expect(row(clean.path).getByRole("checkbox")).toBeChecked();
    expect(row(otherDirty.path).getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(row(otherDirty.path).getByRole("checkbox"));
    selectWorktrees();
    expect(row(clean.path).getByRole("checkbox")).toBeChecked();
    expect(row(dirty.path).getByRole("checkbox")).toBeChecked();
    expect(row(otherDirty.path).getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "Move to Trash... (3)" })).toBeEnabled();
    selectWorktrees();
    expect(screen.getByRole("button", { name: "Move to Trash... (3)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (3)" }));
    const confirm = await screen.findByRole("dialog", { name: "Move Worktrees to Trash?" });
    const remove = await readyRemoval(3, confirm);
    expect(api.previewWorktreeCleanup).toHaveBeenCalledWith(clean.commonDir, clean.path, false, "trash");
    expect(api.previewWorktreeCleanup).toHaveBeenCalledWith(dirty.commonDir, dirty.path, true, "trash");
    expect(api.previewWorktreeCleanup).toHaveBeenCalledWith(otherDirty.commonDir, otherDirty.path, true, "trash");
    expect(within(confirm).getAllByText("Ready")).toHaveLength(3);
    expect(within(confirm).getByText("The owning repository's branches and remote refs are not deleted.")).toBeInTheDocument();
    expect(api.removeWorktree).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledTimes(3));
  });

  it("keeps the selected directory actionable when cached Git classification changes before moving", async () => {
    const api = installApi();
    const changed = { ...dirty, path: clean.path };
    api.previewWorktreeCleanup.mockImplementation(async () => ({ mode: "trash" as const, previewId: "changed", entry: changed,
      fingerprint: "b".repeat(64), checkedAt: inventory.scannedAt, backupRequired: true, forceRequired: true, savedWorkspace: false }));
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (1)" }));
    await readyRemoval(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.previewWorktreeCleanup).toHaveBeenLastCalledWith(clean.commonDir, clean.path, false, "trash");
    const confirm = screen.getByRole("dialog", { name: "Move Worktrees to Trash?" });
    expect(within(confirm).getByRole("button", { name: "Move 1 to Trash" })).toBeEnabled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    const row = within(screen.getByText(clean.path).closest(".ui-resource-row")! as HTMLElement);
    fireEvent.click(row.getByRole("checkbox"));
    fireEvent.click(row.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (1)" }));
    await screen.findByRole("dialog", { name: "Move Worktrees to Trash?" });
    expect(api.previewWorktreeCleanup).toHaveBeenLastCalledWith(clean.commonDir, clean.path, true, "trash");
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });
  it("previews dirty removal directly from its row and changes nothing until final confirmation", async () => {
    const api = installApi();
    const preview = { mode: "trash" as const, previewId: "dirty-direct", entry: dirty, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: true, forceRequired: true, savedWorkspace: false };
    api.previewWorktreeCleanup.mockResolvedValue(preview);
    render(<WorktreeWorkspace />);
    const row = (await screen.findByText(dirty.path)).closest(".ui-resource-row")! as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Move to Trash..." }));
    const confirm = await screen.findByRole("dialog", { name: "Move Worktrees to Trash?" });
    expect(api.previewWorktreeCleanup).toHaveBeenCalledWith(dirty.commonDir, dirty.path, true, "trash");
    await readyRemoval(1, confirm);
    expect(within(confirm).getByText("The folder is moved, not copied. It still uses disk space until Trash is emptied. You can restore it from Worktree recovery.")).toBeInTheDocument();
    expect(within(confirm).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(api.removeWorktree).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.removeWorktree).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "Move to Trash..." }));
    fireEvent.click(await readyRemoval(1));
    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledWith(preview, expect.any(String)));
  });

  it("opens direct confirmation immediately and disables removal while its check is pending", async () => {
    const api = installApi();
    let finish!: (value: Awaited<ReturnType<AgentEnvApi["previewWorktreeCleanup"]>>) => void;
    api.previewWorktreeCleanup.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<WorktreeWorkspace />);
    const row = (await screen.findByText(dirty.path)).closest(".ui-resource-row")! as HTMLElement;
    const action = within(row).getByRole("button", { name: "Move to Trash..." });
    fireEvent.click(action);
    expect(action).toHaveAttribute("aria-busy", "true");
    const confirm = screen.getByRole("dialog", { name: "Move Worktrees to Trash?" });
    expect(within(confirm).getByText("Checking...")).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Move 1 to Trash" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Move to Trash... (0)" })).not.toBeInTheDocument();
    expect(api.removeWorktree).not.toHaveBeenCalled();
    await act(async () => finish({ mode: "trash" as const, previewId: "ready", entry: dirty, fingerprint: "b".repeat(64), checkedAt: inventory.scannedAt,
      backupRequired: true, forceRequired: true, savedWorkspace: false }));
    expect(await readyRemoval(1, confirm)).toBeEnabled();
    expect(within(confirm).queryByText("Checking...")).not.toBeInTheDocument();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });

  it.each<{ flags: Partial<WorktreeEntry>; offered: boolean }>([
    { flags: { main: true }, offered: false }, { flags: { locked: "Keep" }, offered: true },
    { flags: { exists: false }, offered: false }, { flags: { submodules: true }, offered: true },
    { flags: { keptReason: "Keep", state: "kept" }, offered: false }, { flags: { repositoryKeptReason: "Keep" }, offered: false },
    { flags: { manualReviewAvailable: false }, offered: true }, { flags: { prunable: "Missing metadata" }, offered: true },
    { flags: { head: undefined }, offered: true }, { flags: { state: "unavailable" }, offered: true }
  ])("keeps action availability separate from cached classification: %j", async ({ flags, offered }) => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [{ ...dirty, ...flags }] });
    render(<WorktreeWorkspace />);
    if ("main" in flags) await screen.findByText("No Worktrees found");
    else {
      if ("repositoryKeptReason" in flags) fireEvent.click(await screen.findByRole("button", { name: "Ignored repositories" }));
      await screen.findByText(dirty.path);
    }
    expect(Boolean(screen.queryByRole("button", { name: "Move to Trash..." }))).toBe(offered);
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });
  it("keeps the original row when a direct preview fails its fresh safety check", async () => {
    const api = installApi();
    api.previewWorktreeCleanup.mockRejectedValueOnce(new Error("Git operation in progress. Finish it before reviewing cleanup."));
    render(<WorktreeWorkspace />);
    const row = (await screen.findByText(dirty.path)).closest(".ui-resource-row")! as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Move to Trash..." }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Git operation in progress");
    const confirm = screen.getByRole("dialog", { name: "Move Worktrees to Trash?" });
    expect(within(confirm).getByText(dirty.path)).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Retry review of dirty" })).toBeEnabled();
    expect(within(confirm).getByRole("button", { name: "Move 1 to Trash" })).toBeDisabled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(dirty.path)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Move to Trash..." })).toBeEnabled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });
  it("shows file modification times in the default list without mistaking scan time for file age", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [
      { ...clean, modifiedAt: "2025-04-12T10:30:00Z" }, dirty
    ] });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    expect(screen.getByRole("button", { name: "Select Worktrees in this view" })).toBeInTheDocument();
    expect(screen.queryByText("0 selected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove selected/ })).not.toBeInTheDocument();
    const cleanRow = screen.getByText(clean.path).closest(".ui-resource-row")! as HTMLElement;
    const dirtyRow = screen.getByText(dirty.path).closest(".ui-resource-row")! as HTMLElement;
    expect(within(cleanRow).getByLabelText(/^Last modified:/)).toBeInTheDocument();
    expect(within(cleanRow).getByLabelText(/^Last modified:/).getAttribute("aria-label")).toContain("2025");
    expect(within(cleanRow).getByLabelText("Size: 1.0 KB")).toBeInTheDocument();
    expect(within(dirtyRow).getByLabelText("Last modified: Unavailable")).toBeInTheDocument();
    expect(within(dirtyRow).getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Sort Worktrees: Name" })).toBeInTheDocument();
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
  });
  it("filters batch-eligible trees separately from individual review without loosening selection safety", async () => {
    const api = installApi();
    const ignored = { ...clean, path: "/ignored/tree", repositoryPath: "/ignored/repo", commonDir: "/ignored/repo/.git", repositoryKeptReason: "Keep" };
    const locked = { ...clean, path: "/locked/tree", locked: "Keep" };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, dirty, ignored, locked] });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    const selectFilter = (value: string) => {
      fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
      fireEvent.change(screen.getByRole("combobox", { name: "Worktree filter" }), { target: { value } });
      fireEvent.keyDown(document, { key: "Escape" });
    };
    selectFilter("candidate");
    expect(screen.getByText(clean.path)).toBeInTheDocument();
    for (const path of [dirty.path, ignored.path, locked.path]) expect(screen.queryByText(path)).not.toBeInTheDocument();
    selectWorktrees();
    expect(screen.getByRole("button", { name: "Move to Trash... (1)" })).toBeEnabled();
    selectFilter("review");
    expect(screen.getByText(dirty.path)).toBeInTheDocument();
    expect(screen.queryByText(clean.path)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Worktrees in this view" }));
    expect(screen.getByRole("menuitem", { name: "Select integrated, unchanged Worktrees" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Select all removable Worktrees" })).toBeEnabled();
    expect(api.inventoryWorktrees).toHaveBeenCalledTimes(1);
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });
  it("selects candidates across collapsed repositories without duplicating the selected count", async () => {
    const api = installApi();
    const second = { ...clean, path: "/projects/_worktrees/second", sizeBytes: 2048 };
    const other = { ...clean, commonDir: "/other/.git", repositoryPath: "/other", path: "/other/tree" };
    const ignored = { ...other, path: "/ignored/tree", commonDir: "/ignored/.git", repositoryPath: "/ignored", repositoryKeptReason: "Keep" };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, second, dirty, other, ignored] });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Select Worktree for review" })[0]);
    const group = screen.getByRole("button", { name: "app" }).closest("section")!;
    expect(within(group).getByRole("button", { name: "Select Worktrees in this repository" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "app" }));
    selectWorktrees();
    const selectionRow = screen.getByText("3 selected").closest(".ui-resource-row")! as HTMLElement;
    expect(within(selectionRow).getByText("4.0 KB")).toBeInTheDocument();
    expect(selectionRow.querySelector(".ui-resource-row__metadata")).not.toHaveTextContent("selected");
    expect(within(selectionRow).getByRole("button", { name: "Move to Trash... (3)" })).toBeEnabled();
    selectWorktrees("Clear Worktree selection");
    expect(screen.queryByRole("button", { name: /^Remove selected/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "/other/tree" } });
    selectWorktrees();
    expect(screen.getByText("1 selected").closest(".ui-resource-row")).toHaveTextContent("1.0 KB");
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
  });

  it("keeps both selection menus available for explicit review when no tree is automatically eligible", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [dirty] });
    render(<WorktreeWorkspace />);
    await screen.findByText(dirty.path);
    for (const scope of ["view", "repository"]) {
      fireEvent.click(screen.getByRole("button", { name: `Select Worktrees in this ${scope}` }));
      expect(screen.getByRole("menuitem", { name: "Select integrated, unchanged Worktrees" })).toBeDisabled();
      expect(screen.getByRole("menuitem", { name: "Select all removable Worktrees" })).toBeEnabled();
      expect(screen.getByRole("menuitem", { name: "Clear Worktree selection" })).toBeDisabled();
      fireEvent.keyDown(document, { key: "Escape" });
    }
    expect(screen.queryByRole("button", { name: /^Remove selected/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "dirty" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Worktree filter" }), { target: { value: "candidate" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("No automatically selectable Worktrees")).toBeInTheDocument();
    expect(screen.queryByText("No Worktrees found")).not.toBeInTheDocument();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });

  it("finishes the active removal before stopping and leaves subsequent trees untouched", async () => {
    const api = installApi();
    const second = { ...clean, path: "/projects/_worktrees/second" };
    const entries = [clean, second];
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries });
    api.previewWorktreeCleanup.mockImplementation(async (_commonDir, path) => ({
      mode: "trash" as const, previewId: path, entry: entries.find((entry) => entry.path === path)!, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: false, forceRequired: false, savedWorkspace: false
    }));
    let finish!: (result: { status: string; sourceSizeBytes: number; reclaimedSizeBytes: number }) => void;
    api.removeWorktree.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (2)" }));
    fireEvent.click(await readyRemoval(2));
    const dialog = screen.getByRole("dialog", { name: "Cleanup results" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop after current" }));
    expect(within(dialog).getByText("Finishing the current Worktree before stopping...")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "Close" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => finish({ status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024 }));
    expect(api.removeWorktree).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText("Not run")).toBeInTheDocument();
    expect(within(dialog).getByText("Cleanup stopped. Remaining Worktrees were not changed.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/affected repository/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByText(clean.path)).not.toBeInTheDocument();
    expect(screen.getByText(second.path)).toBeInTheDocument();
  });

  it("finishes the in-flight transaction after unmount but never starts the next queued removal", async () => {
    const api = installApi();
    const second = { ...clean, path: "/projects/_worktrees/second" };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, second] });
    api.previewWorktreeCleanupBatch.mockResolvedValue([clean, second].map((entry) => ({ path: entry.path, preview: preparedPreview(entry) })));
    let finish!: (result: { status: string; sourceSizeBytes: number; reclaimedSizeBytes: number }) => void;
    let transactionFinished = false;
    api.removeWorktree.mockImplementationOnce(async () => {
      const result = await new Promise<{ status: string; sourceSizeBytes: number; reclaimedSizeBytes: number }>((resolve) => { finish = resolve; });
      transactionFinished = true;
      return result;
    });
    const workspace = render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (2)" }));
    fireEvent.click(await readyRemoval(2));
    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledTimes(1));
    expect(api.removeWorktree.mock.calls[0][0].entry.path).toBe(clean.path);
    workspace.unmount();
    expect(transactionFinished).toBe(false);
    expect(api.removeWorktree).toHaveBeenCalledTimes(1);
    await act(async () => finish({ status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024 }));
    expect(transactionFinished).toBe(true);
    expect(api.removeWorktree).toHaveBeenCalledTimes(1);
    expect(api.cancelWorktreeScan).not.toHaveBeenCalled();
  });

  it("moves ignored repositories below active ones and offers selection only for active repositories", async () => {
    const api = installApi();
    const ignored: WorktreeEntry = { ...clean, commonDir: "/a/.git", repositoryPath: "/a", path: "/a/tree", state: "kept", keptReason: "Kept by user", repositoryKeptReason: "Kept by user" };
    const kept: WorktreeEntry = { ...clean, path: "/projects/_worktrees/aaa-kept", state: "kept", keptReason: "Kept by user" };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [ignored, kept, clean, dirty] });
    const { container } = render(<WorktreeWorkspace />);
    await screen.findByText("Ignored repositories");
    expect(screen.queryByRole("button", { name: "Stop ignoring repository" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Worktrees" }), { target: { value: "/a/tree" } });
    fireEvent.click(screen.getByRole("button", { name: "Repository actions" }));
    expect(screen.getByRole("menuitem", { name: "Stop ignoring repository" })).toBeEnabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Worktrees" }), { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "Stop ignoring repository" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ignored repositories" }));
    const groups = [...container.querySelectorAll('[data-resource-disclosure-id]:not([data-resource-disclosure-id="ignored-repositories"])')];
    expect(groups.map((group) => group.getAttribute("data-resource-disclosure-id"))).toEqual([clean.commonDir, ignored.commonDir]);
    expect(within(groups[0] as HTMLElement).getByRole("button", { name: "Select Worktrees in this repository" })).toHaveTextContent("Select");
    expect(within(groups[1] as HTMLElement).queryByRole("button", { name: "Select Worktrees in this repository" })).toBeNull();
    expect(within(groups[1] as HTMLElement).getByRole("button", { name: "Repository actions" })).toBeEnabled();
    const rows = groups[0].querySelectorAll(".ui-resource-row");
    expect(rows[rows.length - 1]).toHaveTextContent("aaa-kept");
    fireEvent.click(within(groups[1] as HTMLElement).getByRole("button", { name: "Repository actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop ignoring repository" }));
    await waitFor(() => expect(api.setWorktreeRepositoryKeep).toHaveBeenCalledWith(ignored.commonDir, undefined));
  });
  it("collapses repositories and keeps the whole repository rather than visible rows", async () => {
    const api = installApi();
    const update = vi.fn();
    render(<WorktreeWorkspace onUpdateUiState={update} />);
    const trigger = await screen.findByRole("button", { name: "app" });
    fireEvent.click(trigger);
    expect(screen.queryByText(clean.path)).not.toBeInTheDocument();
    expect(update).toHaveBeenCalledWith({ worktreeCollapsedRepositories: [clean.commonDir] });
    fireEvent.click(screen.getByRole("button", { name: "Repository actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore repository" }));
    await waitFor(() => expect(api.setWorktreeRepositoryKeep).toHaveBeenCalledWith(clean.commonDir, "Kept by user"));
    fireEvent.click(trigger);
    expect(await screen.findByText(clean.path)).toBeInTheDocument();
  });

  it("reuses fresh results on reopen and still permits an explicit refresh", async () => {
    const api = installApi();
    api.cachedWorktreeInventory.mockResolvedValue({ inventory, fresh: true, scanning: false });
    const first = render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    first.unmount();
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    expect(api.inventoryWorktrees).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Worktrees" }));
    await waitFor(() => expect(api.inventoryWorktrees).toHaveBeenCalledTimes(1));
  });

  it("keeps a stale snapshot visible while its background refresh runs", async () => {
    const api = installApi();
    api.cachedWorktreeInventory.mockResolvedValue({ inventory, fresh: false, scanning: true });
    api.inventoryWorktrees.mockImplementation(() => new Promise(() => {}));
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    expect(screen.queryByText("Scanning Worktrees...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Worktrees" })).toHaveAttribute("aria-busy", "true");
    const row = within(screen.getByText(clean.path).closest(".ui-resource-row")! as HTMLElement);
    expect(row.getByRole("checkbox")).toBeEnabled();
    fireEvent.click(row.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Move to Trash... (1)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (1)" }));
    await screen.findByRole("dialog", { name: "Move Worktrees to Trash?" });
  });

  it("retains a freshly changed selected directory without treating its Git classification as a blocker", async () => {
    const api = installApi();
    api.previewWorktreeCleanup.mockResolvedValue({ mode: "trash" as const, previewId: "changed", entry: { ...clean, state: "review", reasons: ["New work"] }, fingerprint: "b".repeat(64), checkedAt: inventory.scannedAt, backupRequired: false, forceRequired: false, savedWorkspace: false });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (1)" }));
    await readyRemoval(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const confirm = screen.getByRole("dialog", { name: "Move Worktrees to Trash?" });
    expect(within(confirm).getByText(clean.path)).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Move 1 to Trash" })).toBeEnabled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });
  it("never batch-selects a review-needed tree even when Git allows a cleanup preview", async () => {
    const api = installApi();
    const reviewed = { ...clean, state: "review", reasons: ["Branch tip is not reachable from another ref; confirm the task is finished"] };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [
      { ...clean, path: "/projects/_worktrees/safe", state: "candidate" }, reviewed
    ] });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    const checked = screen.getAllByRole("checkbox", { name: "Select Worktree for review" }).filter((input) => (input as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].closest(".ui-resource-row")).not.toHaveTextContent(clean.path);
  });
  it("selects only eligible visible trees in one repository and can clear that selection", async () => {
    const api = installApi();
    const other = { ...clean, path: "/elsewhere/other", repositoryPath: "/elsewhere/repo", commonDir: "/elsewhere/repo/.git" };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, dirty, other,
      { ...clean, path: "/projects/kept", keptReason: "Kept", state: "kept" }] });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    const group = screen.getByText("app", { exact: true }).closest("section")!;
    selectWorktrees("Select integrated, unchanged Worktrees", "repository", group);
    const cleanSelection = within(screen.getByText(clean.path).closest(".ui-resource-row")! as HTMLElement).getByRole("checkbox");
    expect(cleanSelection).toBeChecked();
    expect(screen.getAllByRole("checkbox", { name: "Select Worktree for review" }).filter((input) => (input as HTMLInputElement).checked)).toHaveLength(1);
    selectWorktrees("Clear Worktree selection", "repository", group);
    expect(cleanSelection).not.toBeChecked();
  });

  it("shows reviewed sizes and finishes cleanup without waiting for an unrelated full scan", async () => {
    const api = installApi();
    render(<WorktreeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /^clean$/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to Trash..." }));
    const confirm = await screen.findByRole("dialog", { name: "Move Worktrees to Trash?" });
    const remove = await readyRemoval(1, confirm);
    expect(within(confirm).queryByText("Selected size")).not.toBeInTheDocument();
    expect(within(confirm).getByText("Space retained in Trash")).toBeInTheDocument();
    expect(within(confirm).getByLabelText("Size: 1.0 KB")).toBeInTheDocument();
    api.inventoryWorktrees.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(remove);
    const result = await screen.findByRole("dialog", { name: "Cleanup results" });
    await waitFor(() => expect(within(result).getAllByRole("button", { name: "Close" }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true));
    expect(within(result).getByText("Estimated space freed")).toBeInTheDocument();
    expect(api.inventoryWorktrees).toHaveBeenCalledTimes(1);
    fireEvent.click(within(result).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByText(clean.path)).not.toBeInTheDocument();
    expect(screen.getByText(dirty.path)).toBeInTheDocument();
  });

  it("counts only verified removals in batch totals and preserves failed rows for review", async () => {
    const api = installApi();
    const second = { ...clean, path: "/projects/_worktrees/second", sizeBytes: 2048 };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, second] });
    api.previewWorktreeCleanup.mockImplementation(async (_commonDir, path) => ({
      mode: "trash" as const, previewId: path, entry: path === clean.path ? clean : second, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: false, forceRequired: false, savedWorkspace: false
    }));
    api.removeWorktree.mockResolvedValueOnce({ status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024 })
      .mockRejectedValueOnce(new Error("Changed after review"));
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (2)" }));
    const confirm = await screen.findByRole("dialog", { name: "Move Worktrees to Trash?" });
    const remove = await readyRemoval(2, confirm);
    expect(confirm.querySelector(".ui-detail-list")).toHaveTextContent("Selected Worktrees2Space retained in Trash3.0 KB");
    expect(within(confirm).queryByText("Selected size")).not.toBeInTheDocument();
    fireEvent.click(remove);
    const result = await screen.findByRole("dialog", { name: "Cleanup results" });
    await within(result).findByText("Removed");
    expect(result.querySelector(".ui-detail-list")).toHaveTextContent("Removed size1.0 KBEstimated space freed1.0 KB");
    fireEvent.click(within(result).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.getByText(second.path)).toBeInTheDocument();
    expect(screen.queryByText(clean.path)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Worktrees in this repository" }));
    expect(screen.getByRole("menuitem", { name: "Select integrated, unchanged Worktrees" })).toBeEnabled();
  });

  it("continues other selected directories after an item-local failure, including in the same repository", async () => {
    const api = installApi();
    const second = { ...clean, path: "/projects/_worktrees/second" };
    const other = { ...clean, path: "/other/tree", repositoryPath: "/other/repo", commonDir: "/other/repo/.git" };
    const entries = [clean, second, other];
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries });
    api.previewWorktreeCleanup.mockImplementation(async (_commonDir, path) => ({
      mode: "trash" as const, previewId: path, entry: entries.find((entry) => entry.path === path)!, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: false, forceRequired: false, savedWorkspace: false
    }));
    api.removeWorktree.mockRejectedValueOnce(new Error("Repository needs review"));
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (3)" }));
    fireEvent.click(await readyRemoval(3));
    const results = await screen.findByRole("dialog", { name: "Cleanup results" });
    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledTimes(3));
    expect(within(results).queryByText("Not run")).not.toBeInTheDocument();
    expect(api.removeWorktree.mock.calls.map(([preview]) => preview.entry.path)).toEqual([clean.path, second.path, other.path]);
    expect(within(results).getByText("Failed")).toBeInTheDocument();
    expect(within(results).getAllByText("Removed")).toHaveLength(2);
  });

  it("keeps contextual verification warnings without blocking other confirmed directories", async () => {
    const api = installApi();
    const second = { ...clean, path: "/projects/_worktrees/second" };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, second] });
    api.previewWorktreeCleanup.mockImplementation(async (_commonDir, path) => ({
      mode: "trash" as const, previewId: path, entry: path === clean.path ? clean : second, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: false, forceRequired: false, savedWorkspace: false
    }));
    api.removeWorktree.mockResolvedValue({ status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024, verificationWarnings: ["Main repository changed"] });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (2)" }));
    fireEvent.click(await readyRemoval(2));
    const results = await screen.findByRole("dialog", { name: "Cleanup results" });
    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledTimes(2));
    expect(within(results).queryByText("Not run")).not.toBeInTheDocument();
    expect(within(results).getAllByText("Main repository changed")).toHaveLength(2);
    expect(results.querySelector(".ui-detail-list")).toHaveTextContent("Removed size2.0 KB");
  });

  it("discloses pre-existing missing operation history without stopping unrelated removals", async () => {
    const api = installApi();
    const second = { ...clean, path: "/projects/_worktrees/second" };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, second] });
    api.previewWorktreeCleanup.mockImplementation(async (_commonDir, path) => preparedPreview(path === clean.path ? clean : second));
    api.removeWorktree.mockResolvedValueOnce({ status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 0,
      unavailableOperationObjects: [{ field: "REBASE_HEAD", object: "f".repeat(40) }] })
      .mockResolvedValueOnce({ status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 1024 });
    render(<WorktreeWorkspace />);
    await screen.findByText(clean.path);
    selectWorktrees();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash... (2)" }));
    fireEvent.click(await readyRemoval(2));
    const results = await screen.findByRole("dialog", { name: "Cleanup results" });
    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledTimes(2));
    expect(within(results).getByText("Some Git operation history was already unavailable locally. Local files and Git metadata are backed up; restoring will not repair that history.")).toBeInTheDocument();
    expect(within(results).queryByText("Not run")).not.toBeInTheDocument();
    expect(within(results).queryByText("Removed; needs review")).not.toBeInTheDocument();
    expect(within(results).getAllByText("Removed", { exact: true })).toHaveLength(2);
  });

  it("preserves kept, locked and unavailable sibling states after cleanup fails", async () => {
    const api = installApi();
    const kept = { ...clean, path: "/projects/kept", state: "kept", keptReason: "Keep this work" };
    const locked = { ...clean, path: "/projects/locked", state: "kept", locked: "Release testing" };
    const missing = { ...clean, path: "/projects/missing", state: "unavailable", exists: false };
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [clean, kept, locked, missing] });
    api.removeWorktree.mockRejectedValue(new Error("Repository needs review"));
    render(<WorktreeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /^clean$/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to Trash..." }));
    fireEvent.click(await readyRemoval(1));
    const results = await screen.findByRole("dialog", { name: "Cleanup results" });
    await within(results).findByText("Failed");
    fireEvent.click(within(results).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.getByText(kept.path).closest(".ui-resource-row")).toHaveTextContent("Ignored");
    expect(screen.getByText(locked.path).closest(".ui-resource-row")).toHaveTextContent("Git locked");
    expect(screen.getByText(missing.path).closest(".ui-resource-row")).toHaveTextContent("Folder unavailable");
    expect(screen.getByText(clean.path).closest(".ui-resource-row")).toHaveTextContent("No local changes");
  });

  it("does not present a Worktree's own branch as proof of integration", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [{ ...clean,
      integration: { ref: "refs/heads/clean", head: clean.head, explicit: true, merged: true, choices: ["refs/heads/clean"] }
    }] });
    render(<WorktreeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /^clean$/ }));
    const detail = screen.getByRole("dialog", { name: "clean" });
    fireEvent.click(within(detail).getByRole("button", { name: "Git details" }));
    expect(within(detail).getByText("Not confirmed")).toBeInTheDocument();
    expect(within(detail).queryByText("Contained in target")).not.toBeInTheDocument();
  });

  it("chooses an integration target using the shared selector and refreshes its review state", async () => {
    const api = installApi();
    const integrated = { ...clean, integration: { ref: "refs/heads/main", head: "b".repeat(40), explicit: false, merged: true, choices: ["refs/heads/main", "refs/heads/release"] } };
    api.inventoryWorktrees.mockResolvedValueOnce({ ...inventory, entries: [integrated] })
      .mockResolvedValue({ ...inventory, entries: [{ ...integrated, integration: { ...integrated.integration, explicit: true, ref: "refs/heads/release" } }] });
    render(<WorktreeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /^clean$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Git details" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Integration target" }), { target: { value: "refs/heads/release" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Integration target" })).toHaveValue("refs/heads/release"));
    expect(api.setWorktreeIntegrationRef).toHaveBeenCalledWith(clean.commonDir, "refs/heads/release");
  });

  it("shows retained local-file recovery data separately from estimated freed space", async () => {
    const api = installApi();
    api.previewWorktreeCleanup.mockResolvedValue({
      mode: "trash" as const, previewId: "dirty-review", entry: dirty, fingerprint: "b".repeat(64),
      checkedAt: inventory.scannedAt, backupRequired: true, forceRequired: true, savedWorkspace: false
    });
    api.removeWorktree.mockResolvedValue({ mode: "trash", path: dirty.path, status: "removed", sourceSizeBytes: 1024, reclaimedSizeBytes: 0 });
    render(<WorktreeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /^dirty$/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "dirty" })).getByRole("button", { name: "Move to Trash..." }));
    const confirm = await screen.findByRole("dialog", { name: "Move Worktrees to Trash?" });
    const remove = await readyRemoval(1, confirm);
    expect(confirm.querySelector(".ui-detail-list")).toHaveTextContent("Selected Worktrees1Space retained in Trash1.0 KB");
    expect(within(confirm).queryByText("Selected size")).not.toBeInTheDocument();
    fireEvent.click(remove);
    const result = await screen.findByRole("dialog", { name: "Cleanup results" });
    await within(result).findByText("Moved to Trash");
    expect(result.querySelector(".ui-detail-list")).toHaveTextContent("Removed size1.0 KBEstimated space freed0 BSpace retained in Trash1.0 KB");
    expect(within(result).getByText("Items in Trash still use disk space until permanently deleted.")).toBeInTheDocument();
    fireEvent.click(within(result).getByRole("button", { name: "View Trash" }));
    await screen.findByRole("dialog", { name: "Trash and recovery" });
    expect(api.listWorktreeRecovery).toHaveBeenCalledOnce();
  });

  it("starts only one scan in StrictMode and does not cancel it on unmount", async () => {
    const api = installApi();
    let completeCurrent!: (value: WorktreeInventory) => void;
    api.inventoryWorktrees
      .mockImplementationOnce(() => new Promise((resolve) => { completeCurrent = resolve; }));
    const view = render(<StrictMode><WorktreeWorkspace /></StrictMode>);
    await waitFor(() => expect(api.inventoryWorktrees).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop scanning" })).toBeInTheDocument();
    await act(async () => completeCurrent(inventory));
    await screen.findByText("/projects/_worktrees/clean");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Worktrees" })).toBeInTheDocument();
    view.unmount();
    expect(api.cancelWorktreeScan).not.toHaveBeenCalled();
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
    await waitFor(() => expect(api.inventoryWorktrees).toHaveBeenCalledTimes(1));
    rerender(<WorktreeDialog open={false} onClose={onClose} />);
    rerender(<WorktreeDialog open onClose={onClose} />);
    await waitFor(() => expect(api.inventoryWorktrees).toHaveBeenCalledTimes(2));
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
    const gitDetails = within(modal).getByRole("button", { name: "Git details" });
    expect(gitDetails).toHaveAttribute("aria-expanded", "false");
    expect(within(modal).queryByText("/projects/app")).not.toBeInTheDocument();
    expect(within(modal).queryByText("Branch", { exact: true })).not.toBeInTheDocument();
    expect(within(modal).queryByText("HEAD", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(gitDetails);
    expect(within(modal).getByText("/projects/app")).toBeInTheDocument();
    expect(within(modal).getByText("Branch", { exact: true })).toBeInTheDocument();
    expect(within(modal).getByText(clean.head!)).toBeInTheDocument();
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
    expect(screen.getByLabelText("Total size: 101 B")).toHaveTextContent("101 B");
    expect(screen.getByLabelText("Size: 1 B")).toBeInTheDocument();
    const cleanSelection = within(screen.getByText(clean.path).closest(".ui-resource-row")! as HTMLElement).getByRole("checkbox");
    fireEvent.click(cleanSelection);
    fireEvent.click(screen.getByRole("button", { name: "Sort Worktrees: Name" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Largest size" }));
    expect(onUpdateUiState).toHaveBeenCalledWith({ worktreeSort: "size-desc" });
    expect(cleanSelection).toBeChecked();
    expect(api.inventoryWorktrees).toHaveBeenCalledTimes(1);
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
    const paths = () => [...document.querySelectorAll(".worktree-dialog__entries .ui-resource-row__identity > span")]
      .map((element) => element.textContent);
    expect(paths()).toEqual([dirty.path, clean.path]);
    expect([...document.querySelectorAll('.worktree-dialog__entries .ui-catalog-sort-metric[aria-label^="Size:"]')].map((element) => element.textContent))
      .toEqual(["100 B", "1 B"]);
    expect(screen.getByLabelText("Total size: 101 B")).toHaveTextContent("101 B");
    fireEvent.click(screen.getByRole("button", { name: "Refresh Worktrees" }));
    await waitFor(() => expect(api.inventoryWorktrees).toHaveBeenCalledTimes(2));
    expect(paths()).toEqual([dirty.path, clean.path]);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Worktree filter" }), { target: { value: "kept" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("No excluded Worktrees")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(paths()).toEqual([dirty.path, clean.path]);
  });

  it("shows unknown measurements as unavailable, not zero or a different field", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [
      { ...clean, sizeBytes: 0, modifiedAt: "2026-10-01T10:00:00Z" },
      { ...dirty, sizeBytes: undefined, modifiedAt: "invalid" }
    ] });
    render(<WorktreeWorkspace uiState={{ worktreeSort: "size-desc" }} />);
    await screen.findByText(clean.path);
    expect(screen.getByLabelText("Size: 0 B")).toHaveTextContent("0 B");
    expect(screen.getByLabelText("Size: Unavailable")).toHaveTextContent("Unavailable");
    expect(screen.getByLabelText("Total size: Unavailable")).toHaveTextContent("Unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Sort Worktrees: Largest size" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Newest modified" }));
    expect(screen.getAllByLabelText("Last modified: Unavailable")).toHaveLength(1);
    expect(screen.getByLabelText("Total size: Unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Size: 0 B")).toBeInTheDocument();
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
  it("keeps automatic selection clean-only but allows explicit dirty selection and direct confirmation", async () => {
    const api = installApi();
    render(<WorktreeDialog open onClose={vi.fn()} />);
    await screen.findByText("/projects/_worktrees/dirty");
    expect(screen.getAllByRole("checkbox", { name: "Select Worktree for review" })).toHaveLength(2);
    const dirtyRow = screen.getByText("/projects/_worktrees/dirty").closest(".ui-resource-row");
    expect(dirtyRow).not.toBeNull();
    fireEvent.click(dirtyRow!.querySelector("button")!);
    const detail = screen.getByRole("dialog", { name: "dirty" });
    expect(within(detail).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Move to Trash..." })).toBeEnabled();
    expect(api.previewWorktreeCleanup).not.toHaveBeenCalled();
    expect(api.removeWorktree).not.toHaveBeenCalled();
  });

  it("exposes recovery even when no worktrees are found", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [] });
    render(<WorktreeDialog open onClose={vi.fn()} />);
    await screen.findByText("No Worktrees found");
    fireEvent.click(screen.getByRole("button", { name: "Worktree Trash" }));
    await waitFor(() => expect(api.listWorktreeRecovery).toHaveBeenCalledOnce());
    expect(screen.getByText("Trash is empty")).toBeInTheDocument();
  });

  it("distinguishes an empty filter from an empty inventory", async () => {
    const api = installApi();
    api.inventoryWorktrees.mockResolvedValue({ ...inventory, entries: [{ ...clean, state: "candidate" }] });
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/clean");
    expect(screen.getByText("No local changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Worktree filter" }), { target: { value: "kept" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("No excluded Worktrees")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Worktree Trash" }));
    await screen.findByText("Cleanup interrupted");
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.getByText(/original folder and Git registration/)).toBeInTheDocument();
  });

  it.each(["Worktree changed after review. Diagnostic reference: AEM-20261004-ABC123", ""])("shows cleanup failures without a false success: %s", async (message) => {
    const api = installApi();
    api.removeWorktree.mockRejectedValueOnce(new Error(message));
    render(<WorktreeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /^clean$/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to Trash..." }));
    fireEvent.click(await readyRemoval(1));
    const modal = await screen.findByRole("dialog", { name: "Cleanup results" });
    expect(await within(modal).findByText("Failed")).toBeInTheDocument();
    expect(within(modal).queryByText("Removed")).not.toBeInTheDocument();
    if (message) {
      fireEvent.click(within(modal).getByRole("button", { name: "Copy details" }));
      await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining("AEM-20261004-ABC123")));
    }
    expect(modal.querySelector(".ui-detail-list")).toHaveTextContent("Removed size0 BEstimated space freed0 B");
    expect(screen.getByText("/projects/_worktrees/dirty")).toBeInTheDocument();
  });

  it("shows recovery loading on its own command before opening the dialog", async () => {
    const api = installApi();
    let finish!: (value: { records: []; issues: [] }) => void;
    api.listWorktreeRecovery.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<WorktreeWorkspace />);
    await screen.findByText("/projects/_worktrees/clean");
    fireEvent.click(screen.getByRole("button", { name: "Worktree Trash" }));
    expect(screen.getByRole("button", { name: "Worktree Trash" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Refresh Worktrees" })).toHaveAttribute("aria-busy", "false");
    await act(async () => finish({ records: [], issues: [] }));
    expect(screen.getByRole("dialog", { name: "Trash and recovery" })).toBeInTheDocument();
  });
});
