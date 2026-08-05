import { AlertTriangle, BookOpen, FileText, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectRecoverySummary } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button, ModalFrame, Notice, ResourceRow } from "./ui";

export const ProjectRecoveryDialog = ({
  open,
  projectId,
  onClose,
  onRestored
}: {
  open: boolean;
  projectId: string;
  onClose(): void;
  onRestored(): Promise<void> | void;
}) => {
  const { t, formatDate } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<ProjectRecoverySummary[]>([]);
  const [busyId, setBusyId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await window.agentEnv.listProjectRecovery(projectId));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open, projectId]);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: closeRef,
    onDismiss: onClose,
    dismissDisabled: Boolean(busyId)
  });

  const restore = async (item: ProjectRecoverySummary) => {
    setBusyId(item.id);
    setError("");
    try {
      await window.agentEnv.restoreProjectRecovery(item.id);
      await onRestored();
      await load();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusyId(undefined);
    }
  };

  if (!open) return null;
  return (
    <ModalFrame
      ariaLabel={t("Project Recovery")}
      className="project-recovery-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={Boolean(busyId)}
      onDismiss={onClose}
    >
      <header className="ui-dialog-header">
        <div className="ui-dialog-header__copy">
          <div className="ui-dialog-title">{t("Project Recovery")}</div>
          <p className="ui-dialog-description">{t("Restore a Project file to a verified earlier version.")}</p>
        </div>
      </header>
      <div className="ui-dialog-body project-recovery-dialog__body">
        {error ? (
          <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{error}</Notice>
        ) : null}
        {loading ? <div className="project-editor-loading">{t("Loading recovery points…")}</div> : null}
        {!loading && items.length === 0 ? (
          <div className="project-recovery-empty">{t("No recovery points for this Project.")}</div>
        ) : null}
        {items.map((item) => (
          <ResourceRow
            className="project-recovery-entry"
            density="default"
            description={<span className="selectable" title={item.path}>{item.path}</span>}
            icon={item.kind === "skill" ? <BookOpen size={15} /> : <FileText size={15} />}
            key={item.id}
            metadata={formatDate(item.createdAt)}
            title={item.status === "recovery-required"
              ? t("Recovery required")
              : item.kind === "skill" ? t("Project Skill change") : t("Saved Project file")}
            tone={item.status === "recovery-required" ? "attention" : "default"}
            actions={(
              <Button
                size="compact"
                icon={<RotateCcw size={14} />}
                busy={busyId === item.id}
                disabled={Boolean(busyId) || item.status === "restored" || item.status === "failed-restored"}
                onClick={() => void restore(item)}
              >
                {item.status === "restored" ? t("Restored") : t("Restore")}
              </Button>
            )}
          />
        ))}
      </div>
      <footer className="ui-dialog-footer">
        <Button ref={closeRef} disabled={Boolean(busyId)} onClick={onClose}>{t("Close")}</Button>
      </footer>
    </ModalFrame>
  );
};
