import { AlertTriangle, Pencil, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { DocumentDialogFrame } from "./DocumentDialogFrame";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { SyntaxTextAreaField } from "./SyntaxTextAreaField";
import {
  Button,
  DialogBody,
  DialogFooter,
  Notice,
} from "./ui";

export interface InstructionDocumentGuard {
  dirty: boolean;
  save(): Promise<void>;
  discard(): Promise<void>;
}

type InstructionDocumentMode = "preview" | "edit";
type DiscardDestination = "preview" | "close";

interface InstructionDocumentDialogProps {
  open: boolean;
  fileName: string;
  path?: string;
  value: string;
  resetKey: string;
  editable?: boolean;
  initialMode?: InstructionDocumentMode;
  loading?: boolean;
  saving?: boolean;
  error?: string;
  stale?: boolean;
  ariaLabel: string;
  editorLabel: string;
  suspended?: boolean;
  onReload?(): Promise<void> | void;
  onSave(value: string): Promise<void> | void;
  onClose(): void;
  onGuardChange?(guard?: InstructionDocumentGuard): void;
}

export const InstructionDocumentDialog = ({
  open,
  fileName,
  path,
  value,
  resetKey,
  editable = true,
  initialMode = "preview",
  loading = false,
  saving = false,
  error = "",
  stale = false,
  ariaLabel,
  editorLabel,
  suspended = false,
  onReload,
  onSave,
  onClose,
  onGuardChange
}: InstructionDocumentDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef(value);
  const baselineRef = useRef(value);
  const [content, setContent] = useState(value);
  const [mode, setMode] = useState<InstructionDocumentMode>(initialMode);
  const [discardDestination, setDiscardDestination] = useState<DiscardDestination>();
  const [saveError, setSaveError] = useState("");
  const busy = loading || saving;
  const dirty = mode === "edit" && content !== baselineRef.current;
  const visibleError = error || saveError;

  contentRef.current = content;

  useEffect(() => {
    if (!open) return;
    baselineRef.current = value;
    contentRef.current = value;
    setContent(value);
    setMode(initialMode);
    setDiscardDestination(undefined);
    setSaveError("");
  }, [initialMode, open, resetKey, value]);

  const save = async () => {
    if (!dirty || busy || stale) return;
    setSaveError("");
    try {
      await onSave(contentRef.current);
      baselineRef.current = contentRef.current;
      setMode("preview");
      setDiscardDestination(undefined);
    } catch (unknownError) {
      setSaveError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      throw unknownError;
    }
  };

  const discard = async (destination: DiscardDestination) => {
    setContent(baselineRef.current);
    setDiscardDestination(undefined);
    setSaveError("");
    if (destination === "close") onClose();
    else setMode("preview");
  };

  useEffect(() => {
    if (!open || !dirty) {
      onGuardChange?.(undefined);
      return;
    }
    onGuardChange?.({
      dirty: true,
      save: async () => {
        await save();
        onClose();
      },
      discard: async () => discard("close")
    });
    return () => onGuardChange?.(undefined);
  }, [busy, dirty, onGuardChange, open, stale]);

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setDiscardDestination("close");
      return;
    }
    onClose();
  };

  const cancelEditing = () => {
    if (busy) return;
    if (dirty) {
      setDiscardDestination("preview");
      return;
    }
    setMode("preview");
  };

  useModalDialog({
    open: open && !suspended,
    dialogRef,
    initialFocusRef: closeRef,
    onDismiss: requestClose,
    dismissDisabled: busy
  });

  if (!open) return null;
  return (
    <DocumentDialogFrame
      ariaLabel={ariaLabel}
      className="instruction-document-dialog ui-dialog-shell"
      closeButtonRef={closeRef}
      description={path ? <span className="selectable" title={path}>{path}</span> : undefined}
      dialogRef={dialogRef}
      dismissDisabled={busy}
      resetKey={resetKey}
      suspended={suspended}
      title={fileName}
      onClose={requestClose}
    >
      <DialogBody className={`instruction-document-dialog__body is-${mode}`}>
        {visibleError ? (
          <Notice
            tone="danger"
            role="alert"
            icon={<AlertTriangle size={16} />}
            actions={stale && onReload ? (
              <Button size="compact" icon={<RotateCcw size={14} />} onClick={() => void onReload()}>
                {t("Reload")}
              </Button>
            ) : undefined}
          >
            {visibleError}
          </Notice>
        ) : null}
        {loading ? (
          <div className="instruction-document-dialog__loading" role="status">
            {t("Reading Workspace file…")}
          </div>
        ) : mode === "edit" ? (
          <SyntaxTextAreaField
            className="instruction-document-dialog__textarea"
            fieldClassName="instruction-document-dialog__field"
            label={editorLabel}
            labelHidden
            path={fileName}
            spellCheck={false}
            value={content}
            wrap="soft"
            onChange={(event) => setContent(event.target.value)}
          />
        ) : content ? (
          <div className="instruction-document-dialog__preview" aria-label={t("Preview of {{name}}", {
            name: fileName
          })}>
            <SyntaxCodePreview code={content} path={fileName} />
          </div>
        ) : (
          <div className="instruction-document-dialog__empty">{t("Empty file")}</div>
        )}
        {discardDestination ? (
          <Notice
            tone="warning"
            role="alert"
            title={t("Discard unsaved changes?")}
            actions={(
              <>
                <Button size="compact" onClick={() => setDiscardDestination(undefined)}>{t("Keep editing")}</Button>
                <Button
                  size="compact"
                  variant="danger"
                  onClick={() => void discard(discardDestination)}
                >
                  {t("Discard changes")}
                </Button>
              </>
            )}
          >
            {t("Your edits have not been saved.")}
          </Notice>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {mode === "preview" ? (
          <>
            <Button onClick={requestClose}>{t("Close")}</Button>
            {editable && !loading ? (
              <Button
                variant="primary"
                icon={<Pencil size={14} />}
                disabled={stale}
                onClick={() => {
                  setSaveError("");
                  setMode("edit");
                }}
              >
                {t("Edit")}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button disabled={busy} onClick={cancelEditing}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              busy={saving}
              disabled={!dirty || busy || stale}
              onClick={() => void save().catch(() => undefined)}
            >
              {t("Save")}
            </Button>
          </>
        )}
      </DialogFooter>
    </DocumentDialogFrame>
  );
};
