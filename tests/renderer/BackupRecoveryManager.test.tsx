// @vitest-environment jsdom
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BackupRecoveryManager } from "../../src/renderer/components/BackupRecoveryManager";
import { ConversationRecoveryDialog } from "../../src/renderer/components/ConversationRecoveryDialog";
import { useBackupRecoveryController } from "../../src/renderer/hooks/useBackupRecoveryController";
import { useFreshnessCoordinator } from "../../src/renderer/hooks/useFreshnessCoordinator";
import { useModalDialog } from "../../src/renderer/hooks/useModalDialog";
import { DataSettingsSection } from "../../src/renderer/components/DataSettingsSection";
import type { AgentEnvApi, ManagedBackupItem } from "../../src/shared/types";

afterEach(cleanup);
const deleted: ManagedBackupItem = { id: "one", kind: "conversation-delete", conversationTitle: "Fixture", targetId: "codex",
  createdAt: "2026-10-01", fileCount: 1, sizeBytes: 512, cleanupStatus: "eligible", deletable: true };
const translate = (text: string) => text;
const noop = () => undefined;
it("counts recovery points and saved conversation records separately in Settings", async () => {
  window.agentEnv = { readDataRoot: vi.fn().mockResolvedValue("/fixture/data") } as unknown as AgentEnvApi;
  render(<DataSettingsSection busy={false} backupRetentionDays={30} inventoryLoading={false}
    freshness={{ status: "idle", invalidated: false }} onBackupRetentionChange={noop} onExport={noop} onManageBackups={noop} onOpenFolder={noop} onRestore={noop}
    inventory={{ items: [{ ...deleted, restored: true }, { ...deleted, id: "recovery", kind: "target-recovery" }], totalBytes: 1024, eligibleBytes: 1024, eligibleCount: 2, retentionDays: 30 }} />);
  expect(screen.getByText("1 recovery point · 1 conversation record · 1.0 KB")).toBeInTheDocument();
  await screen.findByText("/fixture/data");
});
const SettingsRecovery = () => {
  const [busy, setBusy] = useState(false);
  const controller = useBackupRecoveryController({ activeWorkspace: "profiles", onBusyChange: setBusy, onError: noop,
    onRestoreApplied: async () => undefined, runFreshness: useFreshnessCoordinator().run, translate });
  const dialogRef = useRef<HTMLElement>(null), initialFocusRef = useRef<HTMLButtonElement>(null);
  useModalDialog({ open: controller.state.backupManagerOpen, dialogRef, initialFocusRef, onDismiss: controller.actions.closeManager,
    focusKey: `${controller.state.backupModalFocusKey}:${busy ? "busy" : "ready"}` });
  return <><button onClick={controller.actions.openManager}>Manage</button>{controller.state.backupManagerOpen ?
    <BackupRecoveryManager controller={controller} busy={busy} onBusyChange={setBusy} dialogRef={dialogRef} initialFocusRef={initialFocusRef} initialSection="deleted" targetNames={{ codex: "Codex" }} /> : null}</>;
};

it.each(["settings", "conversations"])("keeps recovery open and moves focus across subviews from %s", async (entry) => {
  let restored = false;
  window.agentEnv = {
    listManagedBackups: vi.fn(async () => ({ items: [{ ...deleted, restored }], totalBytes: 512, eligibleBytes: 512, eligibleCount: 1, retentionDays: 30 })),
    previewManagedBackup: vi.fn().mockResolvedValue({ id: "one", kind: "conversation-delete", files: [{ path: "/fixture/history.jsonl", state: "saved" }] }),
    restoreDeletedConversation: vi.fn(async () => { restored = true; })
  } as unknown as AgentEnvApi;
  if (entry === "settings") {
    render(<SettingsRecovery />);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
  } else render(<ConversationRecoveryDialog targets={[{ id: "codex", name: "Codex" }]} onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Backups & recovery" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Preview backup Fixture" }));
  await within(dialog).findByText("/fixture/history.jsonl");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Back" })).toHaveFocus());
  fireEvent.click(within(dialog).getByRole("button", { name: "Restore conversation" }));
  await within(dialog).findByText("Conversation restored");
  expect(dialog).toBeInTheDocument();
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus());
  fireEvent.click(within(dialog).getByRole("button", { name: /More actions for Fixture/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete permanently" }));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus());
  fireEvent.click(within(dialog).getByRole("button", { name: "Clean up now" }));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
});
