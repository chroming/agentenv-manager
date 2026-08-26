import type { RefObject } from "react";
import type { ResourceIconKey, TargetInfo } from "../../shared/types";
import { useI18n } from "../i18n";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ModalFrame,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField
} from "./ui";
import { ResourceIconPicker } from "./ResourceIconPicker";

interface ProfileFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  source: "blank" | "target";
  sourceChoiceComplete: boolean;
  busy: boolean;
  targets: TargetInfo[];
  form: {
    targetId: string;
    name: string;
    description: string;
  };
  error: string;
  iconKey?: ResourceIconKey;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onSourceChange(source: "blank" | "target"): void;
  onTargetChange(targetId: string): void;
  onNameChange(name: string): void;
  onDescriptionChange(description: string): void;
  onIconChange?(iconKey: ResourceIconKey): void;
  onClose(): void;
  onSubmit(): void;
}

export const ProfileFormDialog = ({
  open,
  mode,
  source,
  sourceChoiceComplete,
  busy,
  targets,
  form,
  error,
  iconKey,
  dialogRef,
  initialFocusRef,
  onSourceChange,
  onTargetChange,
  onNameChange,
  onDescriptionChange,
  onIconChange,
  onClose,
  onSubmit
}: ProfileFormDialogProps) => {
  const { t } = useI18n();
  if (!open) return null;

  const creating = mode === "create";
  return (
    <ModalFrame
      ariaLabel={t(creating ? "New Profile" : "Edit Profile")}
      className="profile-editor-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissPolicy="intentional"
      dismissDisabled={busy}
      onDismiss={onClose}
    >
        <DialogHeader
          className="profile-dialog-header"
          title={t(creating ? "New Profile" : "Edit Profile")}
          description={creating
            ? t("Start blank or capture an existing local Agent setup.")
            : undefined}
        />
        <DialogBody className="profile-form-grid">
          {creating ? (
            <>
              {!sourceChoiceComplete ? (
                <SegmentedControl
                  className="profile-source-choice"
                  label={t("Profile source")}
                  value={source}
                  options={[
                    { value: "blank", label: t("Blank") },
                    { value: "target", label: t("From Agent") }
                  ]}
                  onChange={onSourceChange}
                />
              ) : null}
              {source === "target" ? (
                <SelectField
                  label={t("Source Agent")}
                  value={form.targetId}
                  onChange={(event) => onTargetChange(event.currentTarget.value)}
                >
                  {targets.map((target) => (
                    <option value={target.id} key={target.id}>{target.name}</option>
                  ))}
                </SelectField>
              ) : null}
            </>
          ) : null}
          <TextField
            label={t("Profile name")}
            error={error || undefined}
            value={form.name}
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
          {mode === "edit" && onIconChange ? (
            <div className="profile-icon-field">
              <span>{t("Profile icon")}</span>
              <ResourceIconPicker
                iconKey={iconKey}
                label={form.name || t("Profile")}
                showAgentIcons
                onChange={(nextIconKey) => {
                  if (nextIconKey) onIconChange(nextIconKey);
                }}
              />
            </div>
          ) : null}
          {mode === "edit" || source === "blank" ? (
            <TextAreaField
              label={t("Description")}
              rows={3}
              value={form.description}
              onChange={(event) => onDescriptionChange(event.currentTarget.value)}
            />
          ) : null}
        </DialogBody>
        <DialogFooter className="preview-actions">
          <Button
            ref={initialFocusRef}
            disabled={busy}
            onClick={onClose}
          >
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || form.name.trim().length === 0}
            onClick={onSubmit}
          >
            {t(mode === "edit" ? "Done" : "Create")}
          </Button>
        </DialogFooter>
    </ModalFrame>
  );
};
