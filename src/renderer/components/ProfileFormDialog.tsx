import type { RefObject } from "react";
import type { TargetInfo } from "../../shared/types";
import { useI18n } from "../i18n";

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
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onSourceChange(source: "blank" | "target"): void;
  onTargetChange(targetId: string): void;
  onNameChange(name: string): void;
  onDescriptionChange(description: string): void;
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
  dialogRef,
  initialFocusRef,
  onSourceChange,
  onTargetChange,
  onNameChange,
  onDescriptionChange,
  onClose,
  onSubmit
}: ProfileFormDialogProps) => {
  const { t } = useI18n();
  if (!open) return null;

  const creating = mode === "create";
  return (
    <div
      className="preview-modal-backdrop"
      onClick={busy ? undefined : onClose}
    >
      <section
        ref={dialogRef}
        className="profile-form-dialog profile-editor-dialog ui-dialog-shell"
        role="dialog"
        aria-label={t(creating ? "New profile" : "Edit profile")}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="profile-dialog-header ui-dialog-header">
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title">
              {t(creating ? "New profile" : "Edit profile")}
            </div>
            <p className="muted ui-dialog-description">
              {creating
                ? t("Start blank or capture an existing local agent environment.")
                : t("Update the profile name and description.")}
            </p>
          </div>
        </header>
        <div className="profile-form-grid ui-dialog-body">
          {creating ? (
            <>
              {!sourceChoiceComplete ? (
                <div
                  className="profile-source-choice"
                  role="group"
                  aria-label={t("Profile source")}
                >
                  <button
                    className={source === "blank" ? "is-selected" : ""}
                    type="button"
                    onClick={() => onSourceChange("blank")}
                  >
                    {t("Blank")}
                  </button>
                  <button
                    className={source === "target" ? "is-selected" : ""}
                    type="button"
                    onClick={() => onSourceChange("target")}
                  >
                    {t("From Agent")}
                  </button>
                </div>
              ) : null}
              <label>
                <span>
                  {source === "target"
                    ? t("Source Agent")
                    : t("Preferred Agent")}
                </span>
                <select
                  aria-label={
                    source === "target"
                      ? t("Source Agent")
                      : t("Preferred Agent")
                  }
                  value={form.targetId}
                  onChange={(event) =>
                    onTargetChange(event.currentTarget.value)}
                >
                  {targets.map((target) => (
                    <option value={target.id} key={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <label>
            <span>{t("Profile name")}</span>
            <input
              aria-label={t("Profile name")}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "profile-name-error" : undefined}
              value={form.name}
              onChange={(event) => onNameChange(event.currentTarget.value)}
            />
            {error ? (
              <small className="field-error" id="profile-name-error">
                {error}
              </small>
            ) : null}
          </label>
          {mode === "edit" || source === "blank" ? (
            <label>
              <span>{t("Description")}</span>
              <textarea
                aria-label={t("Description")}
                rows={3}
                value={form.description}
                onChange={(event) =>
                  onDescriptionChange(event.currentTarget.value)}
              />
            </label>
          ) : null}
        </div>
        <footer className="preview-actions ui-dialog-footer">
          <button
            ref={initialFocusRef}
            className="secondary-action"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {t("Cancel")}
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={busy || form.name.trim().length === 0}
            onClick={onSubmit}
          >
            {t(mode === "edit" ? "Done" : "Create")}
          </button>
        </footer>
      </section>
    </div>
  );
};
