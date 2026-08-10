import { useEffect, useRef, useState } from "react";
import type {
  SkillLibraryEntry,
  SkillSourceType,
  SkillUpdateSettingsInput
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { InfoTip } from "./InfoTip";
import { Button, ModalFrame, Switch } from "./ui";

interface SkillUpdateSettingsDialogProps {
  skill?: SkillLibraryEntry;
  busy?: boolean;
  onDismiss(): void;
  onSave(change: SkillUpdateSettingsInput): Promise<boolean>;
}

interface SkillUpdateSettingsDraft {
  directory: string;
  policy: "tracked" | "untracked";
  ref: string;
  source: string;
  sourceType: SkillSourceType;
}

const createDraft = (skill: SkillLibraryEntry): SkillUpdateSettingsDraft => ({
  sourceType: skill.sourceType,
  source: skill.source ?? "",
  ref: skill.remoteRef ?? skill.upstream?.ref ?? "",
  directory: skill.upstream?.subpath ?? "",
  policy: skill.updatePolicy
});

export const SkillUpdateSettingsDialog = ({
  skill,
  busy = false,
  onDismiss,
  onSave
}: SkillUpdateSettingsDialogProps) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SkillUpdateSettingsDraft>();
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraft(skill ? createDraft(skill) : undefined);
  }, [skill]);

  useModalDialog({
    open: Boolean(skill),
    dialogRef,
    initialFocusRef: closeRef,
    onDismiss,
    dismissDisabled: busy || saving
  });

  if (!skill || !draft) return null;

  const original = createDraft(skill);
  const sourceChanged =
    draft.sourceType !== original.sourceType ||
    draft.source.trim() !== original.source.trim() ||
    draft.ref.trim() !== original.ref.trim() ||
    draft.directory.trim() !== original.directory.trim();
  const policyChanged = draft.policy !== original.policy;
  const canSave =
    draft.source.trim().length > 0 &&
    (sourceChanged || policyChanged) &&
    !busy &&
    !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const saved = await onSave({
        policy: {
          id: skill.id,
          policy: draft.policy
        },
        ...(sourceChanged
          ? {
              source: {
                id: skill.id,
                sourceType: draft.sourceType,
                source: draft.source.trim(),
                ...(draft.sourceType === "git"
                  ? {
                      ref: draft.ref.trim() || undefined,
                      directory: draft.directory.trim() || undefined
                    }
                  : {})
              }
            }
          : {})
      });
      if (saved) onDismiss();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame
      ariaLabel={t("Update settings for {{id}}", { id: skill.id })}
      className="skill-update-settings-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissPolicy="intentional"
      dismissDisabled={busy || saving}
      onDismiss={onDismiss}
    >
      <header className="profile-dialog-header ui-dialog-header">
        <div className="ui-dialog-header__copy">
          <div className="section-title ui-dialog-title">{t("Update settings")}</div>
          <p className="muted ui-dialog-description">{skill.name}</p>
        </div>
      </header>
      <div className="skill-update-settings-dialog__body ui-dialog-body">
        <div className="skill-update-settings-policy">
          <span>
            <strong>{t("Track updates")}</strong>
            <small>
              {skill.globallyEnabled === false
                ? t("Checks resume when this skill is enabled.")
                : draft.policy === "tracked"
                  ? t("Include in manual and automatic checks.")
                  : draft.source
                    ? t("Excluded from all update checks.")
                    : t("Add an update source before tracking.")}
            </small>
          </span>
          <Switch
            checked={draft.policy === "tracked"}
            disabled={!draft.source.trim()}
            label={t("Track updates for {{id}}", { id: skill.id })}
            onClick={() =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      policy: current.policy === "tracked" ? "untracked" : "tracked"
                    }
                  : current)}
          >
            <strong>{t(draft.policy === "tracked" ? "On" : "Off")}</strong>
          </Switch>
        </div>
        <div className="skill-update-source-fields">
          <label>
            <span>{t("Source type")}</span>
            <select
              aria-label={t("Update source type for {{id}}", { id: skill.id })}
              value={draft.sourceType}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  sourceType: event.currentTarget.value as SkillSourceType
                })}
            >
              <option value="local">{t("Local folder")}</option>
              <option value="github">{t("GitHub directory")}</option>
              <option value="git">{t("Git repository")}</option>
            </select>
          </label>
          <label>
            <span>{t("Update source")}</span>
            <input
              aria-label={t("Update source for {{id}}", { id: skill.id })}
              placeholder={
                draft.sourceType === "github"
                  ? "https://github.com/owner/repo/tree/main/path/to/skill"
                  : draft.sourceType === "git"
                    ? "git@host:team/repo.git"
                    : "/path/to/skill"
              }
              value={draft.source}
              onChange={(event) => setDraft({ ...draft, source: event.currentTarget.value })}
            />
          </label>
          {draft.sourceType === "git" ? (
            <>
              <label>
                <span>{t("Ref")}</span>
                <input
                  aria-label={t("Update source ref for {{id}}", { id: skill.id })}
                  placeholder={t("Default branch")}
                  value={draft.ref}
                  onChange={(event) => setDraft({ ...draft, ref: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>{t("Directory")}</span>
                <input
                  aria-label={t("Update source directory for {{id}}", { id: skill.id })}
                  placeholder="skills/review"
                  value={draft.directory}
                  onChange={(event) =>
                    setDraft({ ...draft, directory: event.currentTarget.value })}
                />
              </label>
            </>
          ) : null}
        </div>
        <p className="skill-update-settings-help">
          <InfoTip
            label={t(
              "Use a local skill folder, GitHub tree directory, or Git clone address. Repository credentials stay with System Git."
            )}
          />
          {t("Changes take effect together when you save.")}
        </p>
      </div>
      <footer className="preview-actions ui-dialog-footer">
        <Button
          ref={closeRef}
          variant="secondary"
          disabled={saving}
          onClick={onDismiss}
        >
          {t("Close")}
        </Button>
        <Button
          variant="primary"
          disabled={!canSave}
          busy={saving}
          busyLabel={t("Saving...")}
          onClick={() => void save()}
        >
          {t("Save settings")}
        </Button>
      </footer>
    </ModalFrame>
  );
};
