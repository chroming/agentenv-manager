import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectMutationResult, ProjectResourceFile } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button, ModalFrame } from "./ui";

export interface ProjectEditorGuard {
  dirty: boolean;
  save(): Promise<void>;
  discard(): Promise<void>;
}

interface ProjectResourceEditorDialogProps {
  open: boolean;
  projectId: string;
  resourceId?: string;
  onClose(): void;
  onSaved(result: ProjectMutationResult): Promise<void> | void;
  onGuardChange?(guard?: ProjectEditorGuard): void;
  suspended?: boolean;
}

export const ProjectResourceEditorDialog = ({
  open,
  projectId,
  resourceId,
  onClose,
  onSaved,
  onGuardChange,
  suspended = false
}: ProjectResourceEditorDialogProps) => {
  const { t, formatDate } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<ProjectResourceFile | undefined>(undefined);
  const contentRef = useRef("");
  const [file, setFile] = useState<ProjectResourceFile>();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState<"load" | "save">();
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  fileRef.current = file;
  contentRef.current = content;
  const dirty = Boolean(file && content !== file.content);
  const stale = error.includes("changed outside AgentEnv");

  const load = async () => {
    if (!resourceId) return;
    setBusy("load");
    setError("");
    try {
      const next = await window.agentEnv.readProjectResource(projectId, resourceId);
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
    if (!open || !resourceId) return;
    void load();
  }, [open, projectId, resourceId]);

  const save = async () => {
    const current = fileRef.current;
    if (!current || contentRef.current === current.content) return;
    setBusy("save");
    setError("");
    try {
      const result = await window.agentEnv.saveProjectResource({
        projectId,
        resourceId: current.resourceId,
        expectedHash: current.contentHash,
        content: contentRef.current
      });
      const next = { ...current, content: contentRef.current, contentHash: result.contentHash };
      setFile(next);
      await onSaved(result);
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
    ? `${file.path} · ${formatDate(file.modifiedAt)}`
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
          <div className="project-editor-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
            {stale ? (
              <Button icon={<RotateCcw size={14} />} onClick={() => void load()}>{t("Reload")}</Button>
            ) : null}
          </div>
        ) : null}
        {busy === "load" ? (
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
          <div className="project-editor-discard" role="alert">
            <div>
              <strong>{t("Discard unsaved changes?")}</strong>
              <span>{t("The Project file has not been changed yet.")}</span>
            </div>
            <Button onClick={() => setConfirmDiscard(false)}>{t("Keep editing")}</Button>
            <Button variant="danger" onClick={() => void discard()}>{t("Discard changes")}</Button>
          </div>
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
