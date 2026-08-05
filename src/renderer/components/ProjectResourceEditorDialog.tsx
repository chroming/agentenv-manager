import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectInstructionDraft,
  ProjectMutationResult,
  ProjectResourceFile
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button, ModalFrame, Notice } from "./ui";

export interface ProjectEditorGuard {
  dirty: boolean;
  save(): Promise<void>;
  discard(): Promise<void>;
}

interface ProjectResourceEditorDialogProps {
  open: boolean;
  projectId: string;
  resourceId?: string;
  agentId?: string;
  onClose(): void;
  onSaved(result: ProjectMutationResult): Promise<void> | void;
  onGuardChange?(guard?: ProjectEditorGuard): void;
  suspended?: boolean;
}

export const ProjectResourceEditorDialog = ({
  open,
  projectId,
  resourceId,
  agentId,
  onClose,
  onSaved,
  onGuardChange,
  suspended = false
}: ProjectResourceEditorDialogProps) => {
  const { t, formatDate } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<ProjectResourceFile | ProjectInstructionDraft | undefined>(undefined);
  const contentRef = useRef("");
  const [file, setFile] = useState<ProjectResourceFile | ProjectInstructionDraft>();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | undefined>(open ? "load" : undefined);
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  fileRef.current = file;
  contentRef.current = content;
  const dirty = Boolean(file && content !== file.content);
  const stale = error.includes("changed outside AgentEnv");

  const load = async () => {
    if (!resourceId && !agentId) return;
    setBusy("load");
    setError("");
    try {
      const next = resourceId
        ? await window.agentEnv.readProjectResource(projectId, resourceId)
        : await window.agentEnv.prepareProjectInstruction(projectId, agentId!);
      setFile(next);
      setContent(next.content);
      setConfirmDiscard(false);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(undefined);
    }
  };

  useEffect(() => {
    if (!open || (!resourceId && !agentId)) return;
    void load();
  }, [open, projectId, resourceId, agentId]);

  const save = async () => {
    const current = fileRef.current;
    if (!current || contentRef.current === current.content) return;
    setBusy("save");
    setError("");
    try {
      const result = "resourceId" in current
        ? await window.agentEnv.saveProjectResource({
            projectId,
            resourceId: current.resourceId,
            expectedHash: current.contentHash,
            content: contentRef.current
          })
        : await window.agentEnv.createProjectInstruction({
            projectId,
            agentId: current.agentId,
            content: contentRef.current
          });
      if ("resourceId" in current) {
        setFile({ ...current, content: contentRef.current, contentHash: result.contentHash });
      }
      await onSaved(result);
      if (!("resourceId" in current)) onClose();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      throw unknownError;
    } finally {
      setBusy(undefined);
    }
  };

  const discard = async () => {
    setContent(fileRef.current?.content ?? "");
    setConfirmDiscard(false);
    onClose();
  };

  useEffect(() => {
    if (!open || !dirty) {
      onGuardChange?.(undefined);
      return;
    }
    onGuardChange?.({ dirty: true, save, discard });
    return () => onGuardChange?.(undefined);
  }, [dirty, open, onGuardChange]);

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  useModalDialog({
    open: open && !suspended,
    dialogRef,
    initialFocusRef: closeRef,
    onDismiss: requestClose,
    dismissDisabled: Boolean(busy)
  });

  const metadata = useMemo(() => file
    ? file.modifiedAt
      ? `${file.path} · ${formatDate(file.modifiedAt)}`
      : file.path
    : t("Reading Project file…"), [file, formatDate, t]);

  if (!open) return null;
  return (
    <ModalFrame
      ariaLabel={t("Edit Project instruction")}
      className="project-editor-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissPolicy="intentional"
      dismissDisabled={Boolean(busy)}
      onDismiss={requestClose}
      suspended={suspended}
    >
      <header className="ui-dialog-header">
        <div className="ui-dialog-header__copy">
          <div className="ui-dialog-title">{file?.name ?? t("Edit Project instruction")}</div>
          <p className="ui-dialog-description selectable" title={file?.path}>{metadata}</p>
        </div>
      </header>
      <div className="ui-dialog-body project-editor-dialog__body">
        {error ? (
          <Notice
            tone="danger"
            role="alert"
            icon={<AlertTriangle size={16} />}
            actions={stale ? (
              <Button size="compact" icon={<RotateCcw size={14} />} onClick={() => void load()}>
                {t("Reload")}
              </Button>
            ) : undefined}
          >
            {error}
          </Notice>
        ) : null}
        {busy === "load" || !file ? (
          <div className="project-editor-loading">{t("Reading Project file…")}</div>
        ) : (
          <textarea
            aria-label={t("Project instruction content")}
            className="project-editor-textarea"
            spellCheck={false}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        )}
        {confirmDiscard ? (
          <Notice
            tone="warning"
            role="alert"
            title={t("Discard unsaved changes?")}
            actions={(
              <>
                <Button size="compact" onClick={() => setConfirmDiscard(false)}>{t("Keep editing")}</Button>
                <Button size="compact" variant="danger" onClick={() => void discard()}>{t("Discard changes")}</Button>
              </>
            )}
          >
            {t("The Project file has not been changed yet.")}
          </Notice>
        ) : null}
      </div>
      <footer className="ui-dialog-footer">
        <Button ref={closeRef} disabled={Boolean(busy)} onClick={requestClose}>{t("Close")}</Button>
        <Button
          variant="primary"
          busy={busy === "save"}
          disabled={!dirty || Boolean(busy) || stale}
          onClick={() => void save().catch(() => undefined)}
        >
          {t("Save")}
        </Button>
      </footer>
    </ModalFrame>
  );
};
