import { useEffect, useRef, useState } from "react";
import { useBackupRecoveryController } from "../hooks/useBackupRecoveryController";
import { useFreshnessCoordinator } from "../hooks/useFreshnessCoordinator";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { BackupRecoveryManager } from "./BackupRecoveryManager";
import type { TargetInfo } from "../../shared/types";
import { createTargetNameIndex } from "../targetPresentation";

export const ConversationRecoveryDialog = ({ onClose, targets }: { onClose(): void; targets: readonly Pick<TargetInfo, "id" | "name">[] }) => {
  const { t } = useI18n();
  const freshness = useFreshnessCoordinator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const controller = useBackupRecoveryController({ activeWorkspace: "conversations", onBusyChange: setBusy, onError: setError,
    onRestoreApplied: async () => undefined, runFreshness: freshness.run, translate: t });
  const s = controller.state;
  const a = controller.actions;
  const ref = useRef<HTMLElement>(null);
  const focus = useRef<HTMLButtonElement>(null);
  const close = () => { if (s.backupPreviewCandidate || s.backupDeleteCandidate || s.backupCleanupConfirm) a.closeManager(); else onClose(); };
  useModalDialog({ open: true, dialogRef: ref, initialFocusRef: focus, onDismiss: close, dismissDisabled: busy, focusKey: `${s.backupModalFocusKey}:${busy ? "busy" : "ready"}` });
  useEffect(() => { void a.refreshManagedBackups("manual"); }, []);
  return <BackupRecoveryManager targetNames={createTargetNameIndex(targets)} controller={controller} initialSection="deleted" busy={busy} onBusyChange={setBusy} dialogRef={ref} initialFocusRef={focus} onClose={close} error={error} />;
};
