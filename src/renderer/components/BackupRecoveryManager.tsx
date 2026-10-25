import { useState, type RefObject } from "react";
import type { useBackupRecoveryController } from "../hooks/useBackupRecoveryController";
import { useI18n } from "../i18n";
import { formatBytes } from "../formatBytes";
import { BackupManagerDialog, type BackupManagerNotice } from "./BackupManagerDialog";
import type { TargetNameIndex } from "../targetPresentation";
import { notifyConversationRecoveryChange } from "../conversationRecoveryEvents";

export const BackupRecoveryManager = ({ controller, busy, onBusyChange, dialogRef, initialFocusRef, initialSection, onClose, error, targetNames }: {
  controller: ReturnType<typeof useBackupRecoveryController>;
  busy: boolean; dialogRef: RefObject<HTMLElement | null>; initialFocusRef: RefObject<HTMLButtonElement | null>;
  onBusyChange(busy: boolean): void;
  initialSection?: "recovery" | "deleted"; onClose?(): void; error?: string;
  targetNames?: TargetNameIndex;
}) => {
  const { t, formatDate } = useI18n();
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<BackupManagerNotice>();
  const s = controller.state, a = controller.actions;
  return <BackupManagerDialog targetNames={targetNames} initialSection={initialSection} busy={busy || restoring} dialogRef={dialogRef} initialFocusRef={initialFocusRef}
    cleanupConfirm={s.backupCleanupConfirm} deleteCandidate={s.backupDeleteCandidate} inventory={s.managedBackups}
    inventoryLoading={s.managedBackupsLoading} notice={error ? { kind: "error", message: error } : notice ?? s.backupManagerNotice}
    preview={s.managedBackupPreview} previewCandidate={s.backupPreviewCandidate} previewLoading={s.managedBackupPreviewLoading}
    onBackOrClose={() => { if (!restoring) { setNotice(undefined); (onClose ?? a.closeManager)(); } }}
    onCleanup={(scope) => { setNotice(undefined); void a.cleanupBackups(scope); }} onDelete={() => { setNotice(undefined); void a.deleteSelectedBackup(); }}
    onOpenCleanupConfirm={a.openCleanupConfirm} onOpenDelete={a.openDelete} onPreview={(item) => { setNotice(undefined); void a.previewBackup(item); }}
    onCancelCleanup={a.cancelCleanup} onCancelDelete={a.cancelDelete}
    onRestoreConversation={(item) => {
      setRestoring(true); onBusyChange(true); setNotice(undefined);
      void window.agentEnv.restoreDeletedConversation(item.id).then(async () => {
        if (s.backupPreviewCandidate) a.closeManager();
        setNotice({ kind: "success", message: t("Conversation restored") });
        notifyConversationRecoveryChange({ kind: "restored", backupIds: [item.id] });
        await a.refreshManagedBackups("mutation");
      }).catch((error) => setNotice({ kind: "error", message: String(error) })).finally(() => { setRestoring(false); onBusyChange(false); });
    }} formatBytes={formatBytes} formatDate={formatDate} />;
};
