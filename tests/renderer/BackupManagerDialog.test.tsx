// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupManagerDialog } from "../../src/renderer/components/BackupManagerDialog";
import type { ManagedBackupInventory } from "../../src/shared/types";
import { I18nProvider, translate } from "../../src/renderer/i18n";

afterEach(cleanup);
const inventory: ManagedBackupInventory = {
  items: [
    { id: "older", kind: "target-recovery", targetId: "codex", profileName: "Older", createdAt: "2025-01-01",
      sizeBytes: 100, fileCount: 1, cleanupStatus: "eligible", deletable: true },
    { id: "newer", kind: "skill-cleanup", libraryId: "Newer", createdAt: "2026-01-01",
      sizeBytes: 200, fileCount: 1, cleanupStatus: "required", requiredReason: "recovery-required", deletable: false }
  ], eligibleBytes: 100, eligibleCount: 1, totalBytes: 300, retentionDays: 30
};
const props = () => ({ busy: false, cleanupConfirm: false, dialogRef: createRef<HTMLElement>(),
  initialFocusRef: createRef<HTMLButtonElement>(), inventory, inventoryLoading: false, previewLoading: false,
  onBackOrClose: vi.fn(), onCleanup: vi.fn(), onDelete: vi.fn(), onOpenCleanupConfirm: vi.fn(),
  onOpenDelete: vi.fn(), onPreview: vi.fn(), onCancelCleanup: vi.fn(), onCancelDelete: vi.fn(),
  formatBytes: (bytes: number) => `${bytes} B`, formatDate: (value: string) => value
});

describe("Backup catalog controls", () => {
  it.each([
    ["en", "Device Sync"],
    ["zh_CN", "设备同步"],
    ["zh_TW", "裝置同步"]
  ] as const)("names the sync backup filter consistently in %s without changing its stored kind", (preference, name) => {
    render(<I18nProvider preference={preference}><BackupManagerDialog {...props()} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: translate(preference, "Filters") }));
    const filter = screen.getByRole("combobox", { name: translate(preference, "Backup type filter") });
    expect(within(filter).getByRole("option", { name })).toHaveValue("workspace-sync");
    expect(within(filter).queryByRole("option", { name: "Workspace Sync" })).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "workspace-sync" } });
    expect(filter).toHaveValue("workspace-sync");
  });
  it("keeps preview and dismissal usable while a background inventory scan disables only deletion", () => {
    const handlers = props();
    const view = render(<BackupManagerDialog {...handlers} inventoryLoading />);
    expect(screen.getByRole("button", { name: "Clean up now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /More actions for Older/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview backup Older · codex" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
    view.rerender(<BackupManagerDialog {...handlers} inventoryLoading deleteCandidate={inventory.items[0]} />);
    expect(screen.getByRole("button", { name: "Delete backup" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    view.rerender(<BackupManagerDialog {...handlers} inventoryLoading cleanupConfirm />);
    expect(screen.getByRole("button", { name: "Clean up 1 backup" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
  it("sorts and filters previews without changing cleanup scope or protected actions", () => {
    const handlers = props();
    render(<BackupManagerDialog {...handlers} />);
    const dialog = screen.getByRole("dialog", { name: "Manage Backups" });
    expect(within(dialog).getAllByRole("button", { name: /Preview backup/ })[0]).toHaveAccessibleName("Preview backup Skill cleanup · Newer");
    fireEvent.click(screen.getByRole("button", { name: "Sort backups: Newest first" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest first" }));
    expect(within(dialog).getAllByRole("button", { name: /Preview backup/ })[0]).toHaveAccessibleName("Preview backup Older · codex");
    fireEvent.click(within(dialog).getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toHaveClass("ui-filter-popover__panel--modal");
    fireEvent.change(screen.getByRole("combobox", { name: "Backup status filter" }), { target: { value: "protected" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(handlers.onBackOrClose).not.toHaveBeenCalled();
    expect(within(dialog).getAllByRole("button", { name: /Preview backup/ })).toHaveLength(1);
    expect(within(dialog).queryByRole("button", { name: /More actions/ })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("1 eligible · 100 B");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clean up now" }));
    expect(handlers.onOpenCleanupConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onCleanup).not.toHaveBeenCalled();
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });
  it("keeps list-only controls out of backup content and cleanup confirmation", () => {
    const view = render(<BackupManagerDialog {...props()} previewCandidate={inventory.items[0]} />);
    expect(screen.queryByRole("button", { name: /^Sort backups/ })).not.toBeInTheDocument();
    view.rerender(<BackupManagerDialog {...props()} cleanupConfirm />);
    expect(screen.getByText("Delete 1 backup and free approximately 100 B.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
  });
});
