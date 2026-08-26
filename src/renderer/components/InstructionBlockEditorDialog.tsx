import { AlertTriangle, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { InstructionBlock, ResourceIconKey } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { DocumentDialogFrame } from "./DocumentDialogFrame";
import { ResourceIconPicker } from "./ResourceIconPicker";
import { SyntaxTextAreaField } from "./SyntaxTextAreaField";
import {
  Button,
  DialogBody,
  DialogFooter,
  Notice,
  TextField
} from "./ui";

interface InstructionBlockEditorDialogProps {
  block?: InstructionBlock;
  initial?: { name: string; content: string };
  open: boolean;
  saving: boolean;
  error?: string;
  onClose(): void;
  onSave(input: {
    name: string;
    description: string;
    iconKey?: ResourceIconKey;
    content: string;
  }): Promise<void> | void;
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
  const [iconKey, setIconKey] = useState<ResourceIconKey>();
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(block?.name ?? initial?.name ?? "");
    setDescription(block?.description ?? "");
    setIconKey(block?.iconKey);
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
    iconKey !== block?.iconKey ||
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
        <div className="instruction-block-editor__identity">
          <div className="instruction-block-editor__icon-field">
            <span className="ui-field__label">{t("Icon")}</span>
            <ResourceIconPicker
              className="instruction-block-editor__icon-picker"
              fallbackIconKey="file"
              iconKey={iconKey}
              label={name || t("Instruction")}
              onChange={setIconKey}
            />
          </div>
          <TextField
            ref={nameRef}
            label={t("Name")}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </div>
        <TextField
          label={t("Description")}
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
        <SyntaxTextAreaField
          className="instruction-block-editor__textarea"
          fieldClassName="instruction-block-editor__content"
          label={t("Instruction content")}
          path="CONTENT.md"
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
          onClick={() => void onSave({
            name: name.trim(),
            description: description.trim(),
            iconKey,
            content
          })}
        >
          {t("Save")}
        </Button>
      </DialogFooter>
    </DocumentDialogFrame>
  );
};
