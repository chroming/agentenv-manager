import { AlertTriangle, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { InstructionBlock } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { DocumentDialogFrame } from "./DocumentDialogFrame";
import {
  Button,
  DialogBody,
  DialogFooter,
  Notice,
  TextAreaField,
  TextField
} from "./ui";

interface InstructionBlockEditorDialogProps {
  block?: InstructionBlock;
  initial?: { name: string; content: string };
  open: boolean;
  saving: boolean;
  error?: string;
  onClose(): void;
  onSave(input: { name: string; description: string; content: string }): Promise<void> | void;
}

export const InstructionBlockEditorDialog = ({
  block,
  initial,
  open,
  saving,
  error,
  onClose,
  onSave
}: InstructionBlockEditorDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(block?.name ?? initial?.name ?? "");
    setDescription(block?.description ?? "");
    setContent(block?.content ?? initial?.content ?? "");
  }, [block, initial, open]);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: nameRef,
    onDismiss: onClose,
    dismissDisabled: saving
  });

  if (!open) return null;
  const dirty = name.trim() !== (block?.name ?? initial?.name ?? "") ||
    description.trim() !== (block?.description ?? "") ||
    content !== (block?.content ?? initial?.content ?? "");
  return (
    <DocumentDialogFrame
      ariaLabel={t(block ? "Edit Instruction Block" : "New Instruction Block")}
      className="instruction-block-editor ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={saving}
      dismissPolicy="intentional"
      resetKey={block?.id ?? initial?.name ?? "new-instruction"}
      title={t(block ? "Edit Instruction Block" : "New Instruction Block")}
      description={t("Reusable content that Profiles can combine into an Agent instruction file.")}
      onClose={onClose}
    >
      <DialogBody className="instruction-block-editor__body">
        {error ? <Notice tone="danger" role="alert" icon={<AlertTriangle size={16} />}>{error}</Notice> : null}
        {block?.usedByProfiles?.length ? (
          <Notice
            className="instruction-block-editor__impact"
            icon={<Users size={16} />}
            title={block.usedByProfiles.length === 1
              ? t("Used by 1 Profile")
              : t("Used by {{count}} Profiles", { count: block.usedByProfiles.length })}
          >
            {t("Saving updates the shared Instruction for {{profiles}}. Agent files remain unchanged until the affected Profiles are applied.", {
              profiles: block.usedByProfiles.join(", ")
            })}
          </Notice>
        ) : null}
        <TextField
          ref={nameRef}
          label={t("Name")}
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <TextField
          label={t("Description")}
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
        <TextAreaField
          className="instruction-block-editor__content"
          label={t("Instruction content")}
          spellCheck={false}
          wrap="soft"
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
        />
      </DialogBody>
      <DialogFooter>
        <Button disabled={saving} onClick={onClose}>{t("Cancel")}</Button>
        <Button
          variant="primary"
          busy={saving}
          disabled={!name.trim() || !content.trim() || !dirty}
          onClick={() => void onSave({ name: name.trim(), description: description.trim(), content })}
        >
          {t("Save")}
        </Button>
      </DialogFooter>
    </DocumentDialogFrame>
  );
};
