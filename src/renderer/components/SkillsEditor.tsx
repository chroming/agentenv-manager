import { useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type {
  ProfileResources,
  SkillLibraryEntry,
  SkillUpdateInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import { Button, ModalFrame, Switch } from "./ui";

interface SkillsEditorProps {
  value: ProfileResources;
  librarySkills?: SkillLibraryEntry[];
  skillUpdates?: SkillUpdateInfo[];
  checkingSkillUpdates?: boolean;
  disabled?: boolean;
  appliedSkillVersions?: Record<string, string>;
  selectedTargetName?: string;
  onCheckSkillUpdates?(ids: string[]): void;
  onImportNewSkill?(): void;
  onPreviewSkillUpdate?(id: string): void;
  onChange(value: ProfileResources): void;
}

export const SkillsEditor = ({
  value,
  librarySkills = [],
  skillUpdates = [],
  checkingSkillUpdates = false,
  disabled = false,
  appliedSkillVersions,
  selectedTargetName,
  onCheckSkillUpdates,
  onImportNewSkill,
  onPreviewSkillUpdate,
  onChange
}: SkillsEditorProps) => {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [replacingIndex, setReplacingIndex] = useState<number>();
  const pickerDialogRef = useRef<HTMLElement>(null);
  const pickerCancelRef = useRef<HTMLButtonElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const skillsById = useMemo(
    () => new Map(librarySkills.map((skill) => [skill.id, skill])),
    [librarySkills]
  );
  const updatesById = useMemo(
    () => new Map(skillUpdates.map((update) => [update.id, update])),
    [skillUpdates]
  );
  const attachedIds = new Set(value.skills.map((skill) => skill.libraryId));
  const enabledCount = value.skills.filter((reference) => {
    const skill = skillsById.get(reference.libraryId);
    return Boolean(skill && reference.enabled !== false && skill.globallyEnabled !== false);
  }).length;
  const checkableIds = value.skills
    .filter((reference) => reference.enabled !== false)
    .map((reference) => skillsById.get(reference.libraryId))
    .filter((skill): skill is SkillLibraryEntry => Boolean(skill))
    .filter((skill) => skill.globallyEnabled !== false && skill.updatePolicy === "tracked")
    .map((skill) => skill.id);
  const availableSkills = librarySkills.filter((skill) => {
    if (skill.globallyEnabled === false) return false;
    const attachedElsewhere = value.skills.some(
      (reference, index) => index !== replacingIndex && reference.libraryId === skill.id
    );
    if (attachedElsewhere) return false;
    const query = pickerQuery.trim().toLocaleLowerCase();
    return !query || [skill.name, skill.id, skill.description, skill.path, skill.source ?? ""]
      .some((field) => field.toLocaleLowerCase().includes(query));
  });

  const closePicker = () => {
    setPickerOpen(false);
    setPickerQuery("");
    setSelectedIds([]);
    setReplacingIndex(undefined);
  };
  useModalDialog({
    open: pickerOpen,
    dialogRef: pickerDialogRef,
    initialFocusRef: pickerCancelRef,
    fallbackFocusRef: pickerTriggerRef,
    onDismiss: closePicker,
    focusKey: `${pickerOpen}:${replacingIndex ?? "add"}`
  });

  const openPicker = (replaceIndex?: number) => {
    setReplacingIndex(replaceIndex);
    setSelectedIds([]);
    setPickerQuery("");
    setPickerOpen(true);
  };
  const commitPicker = () => {
    if (replacingIndex !== undefined) {
      const libraryId = selectedIds[0];
      if (!libraryId) return;
      onChange({
        ...value,
        skills: value.skills.map((reference, index) =>
          index === replacingIndex
            ? { ...reference, libraryId }
            : reference
        )
      });
      closePicker();
      return;
    }
    const additions = selectedIds
      .filter((id) => !attachedIds.has(id))
      .map((id) => ({ libraryId: id, targetName: skillsById.get(id)?.id ?? id, enabled: true }));
    if (additions.length === 0) return;
    onChange({ ...value, skills: [...value.skills, ...additions] });
    closePicker();
  };

  return (
    <section
      className={`profile-skill-manager${value.skills.length <= 1 ? " is-compact" : ""}`}
      aria-label={t("Profile skills")}
      data-profile-skill-count={value.skills.length}
    >
      <header className="profile-skill-toolbar">
        <div className="profile-skill-summary">
          <strong>{t("Skills")}</strong>
          <span>
            {t("{{count}} enabled", { count: enabledCount })}
            {value.skills.length > enabledCount
              ? ` · ${t("{{count}} disabled", { count: value.skills.length - enabledCount })}`
              : ""}
          </span>
        </div>
        <div className="profile-skill-toolbar__actions">
          <Button
            className="secondary-action profile-skill-check"
            variant="secondary"
            aria-label={t("Check profile skill updates")}
            disabled={disabled || checkingSkillUpdates || checkableIds.length === 0}
            onClick={() => onCheckSkillUpdates?.(checkableIds)}
            icon={(
              <RefreshCw
                className={checkingSkillUpdates ? "is-spinning" : undefined}
                size={14}
                strokeWidth={2.2}
                aria-hidden="true"
              />
            )}
          >
            {t(checkingSkillUpdates ? "Checking" : "Check updates")}
          </Button>
          <Button
            className="secondary-action"
            ref={pickerTriggerRef}
            variant="secondary"
            disabled={disabled}
            onClick={() => openPicker()}
            icon={<Plus size={14} strokeWidth={2.2} aria-hidden="true" />}
          >
            {t("Add")}
          </Button>
        </div>
      </header>

      <div className="profile-skill-list" role="list">
        {value.skills.map((reference, index) => {
          const skill = skillsById.get(reference.libraryId);
          const update = updatesById.get(reference.libraryId);
          const profileEnabled = reference.enabled !== false;
          const globallyEnabled = skill?.globallyEnabled !== false;
          const enabled = Boolean(skill && profileEnabled && globallyEnabled);
          const appliedRevision = appliedSkillVersions?.[reference.libraryId];
          const deploymentPending = Boolean(
            skill && appliedSkillVersions && (enabled
              ? appliedRevision !== skill.contentHash
              : appliedRevision)
          );
          const status = !skill
            ? "Missing"
            : !globallyEnabled
              ? "Disabled in Library"
              : !profileEnabled
                ? deploymentPending ? "Apply pending" : "Disabled"
                : update?.error
                  ? "Check failed"
                  : update?.updateAvailable
                    ? "Update available"
                    : deploymentPending
                      ? "Apply pending"
                      : "Ready";
          const sourceLabel = skill?.sourceType === "github" ? "GitHub" : t("Local");
          const versionLabel = skill?.version
            ? `v${skill.version}`
            : skill?.contentHash.slice(0, 7) ?? reference.libraryId;
          const detail = skill
            ? `${versionLabel} · ${sourceLabel} · ${skill.path}`
            : t("Library skill {{id}} is missing", { id: reference.libraryId });
          return (
            <div
              className={`profile-skill-row${enabled ? "" : " is-disabled"}`}
              key={`${reference.libraryId}:${reference.targetName}:${index}`}
              role="listitem"
              aria-label={t("Profile skill {{name}}", { name: reference.libraryId })}
            >
              <span className="profile-skill-icon" aria-hidden="true">
                <ResourceIconArtwork
                  fallbackIconKey={skill?.sourceType === "github" || skill?.sourceType === "git" ? "github" : "folder"}
                  iconKey={skill?.iconKey}
                  sourceUrl={skill?.sourceType === "github" || skill?.sourceType === "git" ? skill.source : undefined}
                  size={16}
                />
              </span>
              <div className="profile-skill-main">
                <OverflowTooltip className="profile-skill-name" text={skill?.name ?? reference.targetName} />
                <OverflowTooltip
                  ariaLabel={t("Full skill detail {{id}}", { id: reference.libraryId })}
                  className="profile-skill-detail"
                  text={detail}
                />
              </div>
              <span
                className={`profile-skill-state${status === "Ready" ? " is-neutral" : ""}${status === "Update available" || status === "Apply pending" ? " is-update" : ""}${!skill || update?.error ? " is-error" : ""}`}
                title={update?.error ?? status}
              >
                <strong>{t(status)}</strong>
                {appliedRevision && selectedTargetName ? (
                  <small>{t("{{name}} · {{revision}}", {
                    name: selectedTargetName,
                    revision: appliedRevision.slice(0, 7)
                  })}</small>
                ) : null}
              </span>
              {!skill ? (
                <button className="secondary-action profile-skill-update" type="button" disabled={disabled} onClick={() => openPicker(index)}>
                  {t("Relink")}
                </button>
              ) : enabled && update?.updateAvailable ? (
                <button
                  className="secondary-action profile-skill-update"
                  type="button"
                  disabled={disabled}
                  onClick={() => onPreviewSkillUpdate?.(reference.libraryId)}
                >
                  {t("Update")}
                </button>
              ) : <span aria-hidden="true" />}
              <Switch
                checked={enabled}
                className="profile-skill-switch"
                disabled={disabled || !skill || !globallyEnabled}
                label={t(!globallyEnabled
                  ? "{{name}} is disabled in Library"
                  : profileEnabled
                    ? "Disable {{name}}"
                    : "Enable {{name}}", {
                  name: skill?.name ?? reference.targetName
                })}
                onClick={() => onChange({
                  ...value,
                  skills: value.skills.map((entry, currentIndex) =>
                    currentIndex === index ? { ...entry, enabled: entry.enabled === false } : entry
                  )
                })}
              />
              <button
                className="icon-action"
                type="button"
                disabled={disabled}
                aria-label={t("Remove {{name}} from profile", { name: skill?.name ?? reference.targetName })}
                title={t("Remove from profile")}
                onClick={() => onChange({
                  ...value,
                  skills: value.skills.filter((_, currentIndex) => currentIndex !== index)
                })}
              >
                <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          );
        })}
        {value.skills.length === 0 ? (
          <div className="profile-skill-empty">
            <strong>{t("No skills in this profile")}</strong>
            <span>{t("Add reusable skills from Library.")}</span>
          </div>
        ) : null}
      </div>

      {pickerOpen ? (
        <ModalFrame
          ariaLabel={t(replacingIndex === undefined ? "Add library skills" : "Relink missing skill")}
          className="resource-picker-dialog resource-picker-dialog--skills ui-dialog-shell"
          dialogRef={pickerDialogRef}
          onDismiss={closePicker}
        >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">
                  {t(replacingIndex === undefined ? "Add library skills" : "Relink missing skill")}
                </div>
                <p className="ui-dialog-description">{t("Choose reusable skills from Library.")}</p>
              </div>
            </header>
            <div className="resource-picker-dialog__body ui-dialog-body">
              <label className="resource-picker-search">
                <Search size={15} strokeWidth={2.2} aria-hidden="true" />
                <input
                  aria-label={t("Search library skills")}
                  placeholder={t("Search skills...")}
                  value={pickerQuery}
                  onChange={(event) => setPickerQuery(event.currentTarget.value)}
                />
              </label>
              <div className="resource-picker-list">
                {availableSkills.length === 0 ? (
                  <div className="inline-state">{t("No library skills available")}</div>
                ) : null}
                {availableSkills.map((skill) => (
                  <label className="resource-picker-option" key={skill.id}>
                    <input
                      aria-label={skill.name}
                      checked={selectedIds.includes(skill.id)}
                      type="checkbox"
                      onChange={() => setSelectedIds((current) =>
                        replacingIndex !== undefined
                          ? current.includes(skill.id) ? [] : [skill.id]
                          : current.includes(skill.id)
                            ? current.filter((id) => id !== skill.id)
                            : [...current, skill.id]
                      )}
                    />
                    <span className="resource-picker-option__main">
                      <strong>{skill.name}</strong>
                      <OverflowTooltip className="resource-picker-option__description" text={skill.description || skill.id} />
                      <OverflowTooltip
                        className="resource-picker-option__metadata"
                        text={`${skill.version ? `v${skill.version}` : skill.contentHash.slice(0, 7)} · ${skill.path}`}
                      />
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="preview-actions ui-dialog-footer">
              {onImportNewSkill ? (
                <button
                  className="secondary-action resource-picker-import"
                  type="button"
                  onClick={() => {
                    closePicker();
                    onImportNewSkill();
                  }}
                >
                  {t("Import new Skill")}
                </button>
              ) : null}
              <button ref={pickerCancelRef} className="secondary-action" type="button" onClick={closePicker}>
                {t("Cancel")}
              </button>
              <button className="primary-action" type="button" disabled={disabled || selectedIds.length === 0} onClick={commitPicker}>
                {replacingIndex !== undefined
                  ? t("Relink skill")
                  : t("Add {{count}}", { count: selectedIds.length })}
              </button>
            </footer>
        </ModalFrame>
      ) : null}
    </section>
  );
};
