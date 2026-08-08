import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DataRestorePreview,
  ManagedBackupInventory,
  ManagedBackupItem,
  ManagedBackupPreview
} from "../../shared/types";
import type { TranslationValues } from "../i18n";
import { formatBytes } from "../formatBytes";
import type { BackupManagerNotice } from "../components/BackupManagerDialog";
import type { useFreshnessCoordinator } from "./useFreshnessCoordinator";

type FreshnessRunner = ReturnType<typeof useFreshnessCoordinator>["run"];
type BackupRefreshReason = "page-entry" | "mutation" | "manual";
type Translate = (message: string, values?: TranslationValues) => string;

interface BackupRecoveryControllerOptions {
  activeWorkspace: string;
  onBusyChange(busy: boolean): void;
  onError(error: string | undefined): void;
  onRestoreApplied(): Promise<void>;
  runFreshness: FreshnessRunner;
  translate: Translate;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useBackupRecoveryController = ({
  activeWorkspace,
  onBusyChange,
  onError,
  onRestoreApplied,
  runFreshness,
  translate: t
}: BackupRecoveryControllerOptions) => {
  const [dataBackupStatus, setDataBackupStatus] = useState("");
  const [dataRestorePreview, setDataRestorePreview] = useState<DataRestorePreview>();
  const [managedBackups, setManagedBackups] = useState<ManagedBackupInventory>();
  const [managedBackupsLoading, setManagedBackupsLoading] = useState(false);
  const [backupManagerOpen, setBackupManagerOpen] = useState(false);
  const [backupPreviewCandidate, setBackupPreviewCandidate] = useState<ManagedBackupItem>();
  const [managedBackupPreview, setManagedBackupPreview] = useState<ManagedBackupPreview>();
  const [managedBackupPreviewLoading, setManagedBackupPreviewLoading] = useState(false);
  const [backupDeleteCandidate, setBackupDeleteCandidate] = useState<ManagedBackupItem>();
  const [backupCleanupConfirm, setBackupCleanupConfirm] = useState(false);
  const [backupManagerNotice, setBackupManagerNotice] = useState<BackupManagerNotice>();
  const restoreReturnFocusRef = useRef<HTMLElement | null>(null);
  const managerReturnFocusRef = useRef<HTMLElement | null>(null);

  const refreshManagedBackups = useCallback(async (
    reason: BackupRefreshReason = "manual"
  ) => {
    try {
      await runFreshness("backups", reason, async () => {
        setManagedBackupsLoading(true);
        try {
          const inventory = await window.agentEnv.listManagedBackups();
          setManagedBackups(inventory);
          return inventory;
        } finally {
          setManagedBackupsLoading(false);
        }
      });
    } catch (error) {
      const message = errorMessage(error);
      if (reason === "manual") onError(message);
      else console.warn(`[AgentEnv] Recovery storage refresh failed: ${message}`);
    }
  }, [onError, runFreshness]);

  useEffect(() => {
    if (activeWorkspace !== "settings") return;
    void refreshManagedBackups("page-entry");
  }, [activeWorkspace, refreshManagedBackups]);

  const revealManager = useCallback(() => {
    setBackupManagerOpen(true);
  }, []);

  const openManager = useCallback(() => {
    managerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBackupDeleteCandidate(undefined);
    setBackupPreviewCandidate(undefined);
    setManagedBackupPreview(undefined);
    setManagedBackupPreviewLoading(false);
    setBackupCleanupConfirm(false);
    setBackupManagerNotice(undefined);
    setBackupManagerOpen(true);
    void refreshManagedBackups("manual");
  }, [refreshManagedBackups]);

  const closeManager = useCallback(() => {
    if (backupPreviewCandidate) {
      setBackupPreviewCandidate(undefined);
      setManagedBackupPreview(undefined);
      setManagedBackupPreviewLoading(false);
      return;
    }
    if (backupDeleteCandidate) {
      setBackupDeleteCandidate(undefined);
      return;
    }
    if (backupCleanupConfirm) {
      setBackupCleanupConfirm(false);
      return;
    }
    setBackupManagerOpen(false);
    setBackupManagerNotice(undefined);
  }, [backupCleanupConfirm, backupDeleteCandidate, backupPreviewCandidate]);

  const previewBackup = useCallback(async (item: ManagedBackupItem) => {
    setBackupPreviewCandidate(item);
    setManagedBackupPreview(undefined);
    setManagedBackupPreviewLoading(true);
    setBackupManagerNotice(undefined);
    try {
      setManagedBackupPreview(await window.agentEnv.previewManagedBackup({
        id: item.id,
        kind: item.kind
      }));
    } catch (error) {
      setBackupPreviewCandidate(undefined);
      setBackupManagerNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setManagedBackupPreviewLoading(false);
    }
  }, []);

  const deleteSelectedBackup = useCallback(async () => {
    if (!backupDeleteCandidate) return;
    onBusyChange(true);
    setBackupManagerNotice(undefined);
    try {
      const result = await window.agentEnv.deleteManagedBackup({
        id: backupDeleteCandidate.id,
        kind: backupDeleteCandidate.kind
      });
      setBackupDeleteCandidate(undefined);
      setBackupManagerNotice({
        kind: "success",
        message: t("Deleted {{count}} backup · Freed {{size}}", {
          count: result.deletedCount,
          size: formatBytes(result.freedBytes)
        })
      });
      await refreshManagedBackups("mutation");
    } catch (error) {
      setBackupManagerNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      onBusyChange(false);
    }
  }, [backupDeleteCandidate, onBusyChange, refreshManagedBackups, t]);

  const cleanupBackups = useCallback(async () => {
    onBusyChange(true);
    setBackupManagerNotice(undefined);
    try {
      const result = await window.agentEnv.cleanupManagedBackups();
      setBackupCleanupConfirm(false);
      setBackupManagerNotice({
        kind: result.failures.length > 0 ? "error" : "success",
        message: result.failures.length > 0
          ? t(
              result.deletedCount === 1
                ? "Deleted 1 backup; {{failed}} failed"
                : "Deleted {{count}} backups; {{failed}} failed",
              { count: result.deletedCount, failed: result.failures.length }
            )
          : t(
              result.deletedCount === 1
                ? "Deleted 1 backup · Freed {{size}}"
                : "Deleted {{count}} backups · Freed {{size}}",
              { count: result.deletedCount, size: formatBytes(result.freedBytes) }
            )
      });
      await refreshManagedBackups("mutation");
    } catch (error) {
      setBackupManagerNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      onBusyChange(false);
    }
  }, [onBusyChange, refreshManagedBackups, t]);

  const createDataBackup = useCallback(async () => {
    onBusyChange(true);
    onError(undefined);
    setDataBackupStatus("Creating data export");
    try {
      const result = await window.agentEnv.createDataBackup();
      setDataBackupStatus(
        result ? t("Data export created at {{path}}", { path: result.path }) : ""
      );
    } catch (error) {
      setDataBackupStatus("");
      onError(errorMessage(error));
    } finally {
      onBusyChange(false);
    }
  }, [onBusyChange, onError, t]);

  const selectDataRestore = useCallback(async () => {
    restoreReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onBusyChange(true);
    onError(undefined);
    try {
      setDataRestorePreview(await window.agentEnv.selectDataRestore());
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      onBusyChange(false);
    }
  }, [onBusyChange, onError]);

  const applyDataRestore = useCallback(async () => {
    if (!dataRestorePreview) return;
    onBusyChange(true);
    onError(undefined);
    try {
      const result = await window.agentEnv.restoreDataBackup(dataRestorePreview.path);
      setDataRestorePreview(undefined);
      await onRestoreApplied();
      setDataBackupStatus(
        `AgentEnv data restored; safety backup created at ${result.safetyBackupPath}`
      );
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      onBusyChange(false);
    }
  }, [dataRestorePreview, onBusyChange, onError, onRestoreApplied]);

  return {
    state: {
      backupCleanupConfirm,
      backupDeleteCandidate,
      backupManagerNotice,
      backupManagerOpen,
      backupPreviewCandidate,
      dataBackupStatus,
      dataRestorePreview,
      managedBackupPreview,
      managedBackupPreviewLoading,
      managedBackups,
      managedBackupsLoading,
      managerReturnFocusRef,
      restoreReturnFocusRef
    },
    actions: {
      applyDataRestore,
      cancelCleanup: () => setBackupCleanupConfirm(false),
      cancelDelete: () => setBackupDeleteCandidate(undefined),
      cleanupBackups,
      clearDataBackupStatus: () => setDataBackupStatus(""),
      closeManager,
      createDataBackup,
      deleteSelectedBackup,
      dismissDataRestore: () => setDataRestorePreview(undefined),
      openCleanupConfirm: () => setBackupCleanupConfirm(true),
      openDelete: setBackupDeleteCandidate,
      openManager,
      previewBackup,
      refreshManagedBackups,
      revealManager,
      selectDataRestore
    }
  };
};
