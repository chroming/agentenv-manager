// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEnvApi,
  ManagedBackupInventory,
  ManagedBackupItem
} from "../../src/shared/types";
import { useBackupRecoveryController } from "../../src/renderer/hooks/useBackupRecoveryController";

const requiredBackup: ManagedBackupItem = {
  id: "required-backup",
  kind: "target-recovery",
  createdAt: "2026-01-01T00:00:00.000Z",
  sizeBytes: 4096,
  fileCount: 2,
  operation: "apply",
  targetId: "opencode",
  profileName: "Daily Coding",
  cleanupStatus: "required",
  requiredReason: "takeover-baseline",
  deletable: false
};

const eligibleBackup: ManagedBackupItem = {
  id: "cleanup-old",
  kind: "skill-cleanup",
  createdAt: "2026-01-02T00:00:00.000Z",
  sizeBytes: 2048,
  fileCount: 1,
  operation: "cleanup",
  libraryId: "reviewer",
  cleanupStatus: "eligible",
  deletable: true
};

const inventory: ManagedBackupInventory = {
  items: [requiredBackup, eligibleBackup],
  totalBytes: 6144,
  eligibleBytes: 2048,
  eligibleCount: 1,
  retentionDays: 30
};

const createApi = () => ({
  cleanupManagedBackups: vi.fn().mockResolvedValue({
    deletedCount: 1,
    failures: [],
    freedBytes: 2048
  }),
  createDataBackup: vi.fn().mockResolvedValue({
    path: "/tmp/AgentEnv-Backup",
    createdAt: "2026-08-08T00:00:00.000Z"
  }),
  deleteManagedBackup: vi.fn().mockResolvedValue({
    deletedCount: 1,
    freedBytes: 2048
  }),
  listManagedBackups: vi.fn().mockResolvedValue(inventory),
  previewManagedBackup: vi.fn().mockResolvedValue({
    id: requiredBackup.id,
    kind: requiredBackup.kind,
    files: [{ path: "/tmp/AGENTS.md", state: "saved" }]
  }),
  restoreDataBackup: vi.fn().mockResolvedValue({
    safetyBackupPath: "/tmp/AgentEnv-Safety"
  }),
  selectDataRestore: vi.fn().mockResolvedValue({
    path: "/tmp/AgentEnv-Backup",
    createdAt: "2026-08-08T00:00:00.000Z",
    formatVersion: 1,
    topLevelItemCount: 6
  })
}) as unknown as AgentEnvApi;

const translate = (message: string, values?: Record<string, unknown>) =>
  Object.entries(values ?? {}).reduce(
    (result, [key, value]) => result.replace(`{{${key}}}`, String(value)),
    message
  );

const renderController = (
  api = createApi(),
  activeWorkspace: "profiles" | "settings" = "profiles"
) => {
  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: api
  });
  const callbacks = {
    onBusyChange: vi.fn(),
    onError: vi.fn(),
    onRestoreApplied: vi.fn().mockResolvedValue(undefined),
    runFreshness: vi.fn(async (_resource, _reason, task) => ({
      performed: true,
      value: await task()
    })),
    translate
  };
  const hook = renderHook(
    ({ workspace }) => useBackupRecoveryController({
      activeWorkspace: workspace,
      ...callbacks
    }),
    { initialProps: { workspace: activeWorkspace } }
  );
  return { ...hook, api, callbacks };
};

describe("useBackupRecoveryController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads managed backups on Settings entry and reports manual refresh errors", async () => {
    const api = createApi();
    const { result, rerender, callbacks } = renderController(api);

    rerender({ workspace: "settings" });
    await waitFor(() => expect(api.listManagedBackups).toHaveBeenCalledOnce());

    expect(callbacks.runFreshness).toHaveBeenCalledWith(
      "backups",
      "page-entry",
      expect.any(Function)
    );
    await waitFor(() => expect(result.current.state.managedBackups).toEqual(inventory));
    expect(result.current.state.managedBackupsLoading).toBe(false);

    vi.mocked(api.listManagedBackups).mockRejectedValueOnce(new Error("storage unavailable"));
    await act(() => result.current.actions.refreshManagedBackups("manual"));
    expect(callbacks.onError).toHaveBeenCalledWith("storage unavailable");
  });

  it("opens the manager and closes nested preview, delete, and cleanup states first", async () => {
    const { result, api } = renderController();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    act(() => result.current.actions.openManager());
    expect(result.current.state.backupManagerOpen).toBe(true);
    expect(result.current.state.managerReturnFocusRef.current).toBe(trigger);
    await waitFor(() => expect(api.listManagedBackups).toHaveBeenCalledOnce());

    await act(() => result.current.actions.previewBackup(requiredBackup));
    expect(result.current.state.managedBackupPreview?.files).toHaveLength(1);
    act(() => result.current.actions.closeManager());
    expect(result.current.state.backupManagerOpen).toBe(true);
    expect(result.current.state.backupPreviewCandidate).toBeUndefined();

    act(() => result.current.actions.openDelete(eligibleBackup));
    act(() => result.current.actions.closeManager());
    expect(result.current.state.backupManagerOpen).toBe(true);
    expect(result.current.state.backupDeleteCandidate).toBeUndefined();

    act(() => result.current.actions.openCleanupConfirm());
    act(() => result.current.actions.closeManager());
    expect(result.current.state.backupManagerOpen).toBe(true);
    expect(result.current.state.backupCleanupConfirm).toBe(false);

    act(() => result.current.actions.closeManager());
    expect(result.current.state.backupManagerOpen).toBe(false);
  });

  it("previews, deletes, and cleans managed backups with scoped notices", async () => {
    const { result, api, callbacks } = renderController();

    await act(() => result.current.actions.previewBackup(requiredBackup));
    expect(api.previewManagedBackup).toHaveBeenCalledWith({
      id: requiredBackup.id,
      kind: requiredBackup.kind
    });

    act(() => result.current.actions.openDelete(eligibleBackup));
    await act(() => result.current.actions.deleteSelectedBackup());
    expect(api.deleteManagedBackup).toHaveBeenCalledWith({
      id: eligibleBackup.id,
      kind: eligibleBackup.kind
    });
    expect(result.current.state.backupManagerNotice).toEqual({
      kind: "success",
      message: "Deleted 1 backup · Freed 2.0 KB"
    });

    act(() => result.current.actions.openCleanupConfirm());
    await act(() => result.current.actions.cleanupBackups());
    expect(api.cleanupManagedBackups).toHaveBeenCalledOnce();
    expect(result.current.state.backupCleanupConfirm).toBe(false);
    expect(result.current.state.backupManagerNotice).toEqual({
      kind: "success",
      message: "Deleted 1 backup · Freed 2.0 KB"
    });
    expect(callbacks.onBusyChange.mock.calls).toEqual([
      [true], [false],
      [true], [false]
    ]);
  });

  it("keeps preview failures inside the backup manager", async () => {
    const api = createApi();
    vi.mocked(api.previewManagedBackup).mockRejectedValue(new Error("preview failed"));
    const { result } = renderController(api);

    await act(() => result.current.actions.previewBackup(requiredBackup));

    expect(result.current.state.backupPreviewCandidate).toBeUndefined();
    expect(result.current.state.managedBackupPreviewLoading).toBe(false);
    expect(result.current.state.backupManagerNotice).toEqual({
      kind: "error",
      message: "preview failed"
    });
  });

  it("creates a data export and clears its status on failure", async () => {
    const api = createApi();
    const { result, callbacks } = renderController(api);

    await act(() => result.current.actions.createDataBackup());
    expect(result.current.state.dataBackupStatus).toBe(
      "Data export created at /tmp/AgentEnv-Backup"
    );

    vi.mocked(api.createDataBackup).mockRejectedValueOnce(new Error("export failed"));
    await act(() => result.current.actions.createDataBackup());
    expect(result.current.state.dataBackupStatus).toBe("");
    expect(callbacks.onError).toHaveBeenCalledWith("export failed");
  });

  it("selects, dismisses, and applies a data restore before reloading Profiles", async () => {
    const { result, api, callbacks } = renderController();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    await act(() => result.current.actions.selectDataRestore());
    expect(result.current.state.restoreReturnFocusRef.current).toBe(trigger);
    expect(result.current.state.dataRestorePreview?.topLevelItemCount).toBe(6);

    await act(() => result.current.actions.applyDataRestore());
    expect(api.restoreDataBackup).toHaveBeenCalledWith("/tmp/AgentEnv-Backup");
    expect(callbacks.onRestoreApplied).toHaveBeenCalledOnce();
    expect(result.current.state.dataRestorePreview).toBeUndefined();
    expect(result.current.state.dataBackupStatus).toBe(
      "AgentEnv data restored; safety backup created at /tmp/AgentEnv-Safety"
    );

    act(() => result.current.actions.dismissDataRestore());
    expect(result.current.state.dataRestorePreview).toBeUndefined();
  });
});
