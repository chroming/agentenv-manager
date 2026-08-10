import { AlertTriangle, BookOpen, FileText, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectRecoverySummary } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ModalFrame,
  Notice,
  ResourceRow
} from "./ui";

export const ProjectRecoveryDialog = ({
  mode,
  open,
  projectId,
  onClose,
  onRestored
}: {
  mode: "latest" | "history";
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
    setItems([]);
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
      if (mode === "latest") onClose();
      else await load();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusyId(undefined);
    }
  };

  if (!open) return null;
  const restorableItems = items.filter(
    (item) => item.status !== "restored" && item.status !== "failed-restored"
  );
  const visibleItems = mode === "latest" ? restorableItems.slice(0, 1) : items;
  const title = mode === "latest" ? t("Undo last Workspace change") : t("Workspace Recovery");
  return (
    <ModalFrame
      ariaLabel={title}
      className="project-recovery-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={Boolean(busyId)}
      onDismiss={onClose}
    >
      <DialogHeader
        title={title}
        description={mode === "latest"
          ? t("Restore the file changed by AgentEnv's latest completed Workspace action.")
          : t("Restore a Workspace file to a verified earlier version.")}
      />
      <DialogBody className="project-recovery-dialog__body">
        {error ? (
          <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{error}</Notice>
        ) : null}
        {loading ? <div className="project-editor-loading">{t("Loading recovery points…")}</div> : null}
        {!loading && visibleItems.length === 0 ? (
          <div className="project-recovery-empty">{t("No recovery points for this Workspace.")}</div>
        ) : null}
        {visibleItems.map((item) => (
          <ResourceRow
            className="project-recovery-entry"
            data-recovery-id={item.id}
            density="default"
            description={<span className="selectable" title={item.path}>{item.path}</span>}
            icon={item.kind === "skill" ? <BookOpen size={15} /> : <FileText size={15} />}
            key={item.id}
            metadata={formatDate(item.createdAt)}
            title={item.status === "recovery-required"
              ? t("Recovery required")
              : item.kind === "skill" ? t("Workspace Skill change") : t("Saved Workspace file")}
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
      </DialogBody>
      <DialogFooter>
        <Button ref={closeRef} disabled={Boolean(busyId)} onClick={onClose}>{t("Close")}</Button>
      </DialogFooter>
    </ModalFrame>
  );
};
