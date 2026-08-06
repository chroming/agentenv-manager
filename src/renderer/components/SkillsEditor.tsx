import { useMemo, useRef, useState } from "react";
import { Download, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import type {
  AppliedSkillReceipt,
  ProfileResources,
  SkillLibraryEntry,
  SkillUpdateInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import { LibrarySkillPicker } from "./LibrarySkillPicker";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  ModalFrame,
  Switch
} from "./ui";

interface SkillsEditorProps {
  value: ProfileResources;
  librarySkills?: SkillLibraryEntry[];
  skillUpdates?: SkillUpdateInfo[];
  checkingSkillUpdates?: boolean;
  disabled?: boolean;
  appliedSkillVersions?: Record<string, string>;
  skillReceipts?: AppliedSkillReceipt[];
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
  skillReceipts = [],
  selectedTargetName,
  onCheckSkillUpdates,
  onImportNewSkill,
  onPreviewSkillUpdate,
  onChange
}: SkillsEditorProps) => {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
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
  const pickerSkills = librarySkills.filter((skill) => skill.globallyEnabled !== false);
  const pickerExcludedIds = new Set(
    value.skills
      .filter((_, index) => index !== replacingIndex)
      .map((reference) => reference.libraryId)
  );

  const closePicker = () => {
    setPickerOpen(false);
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
      aria-label={t("Profile Skills")}
      data-profile-skill-count={value.skills.length}
    >
      <header className="profile-skill-toolbar">
        <div className="profile-skill-summary ui-visually-hidden">
          <span>
            {t("{{count}} enabled", { count: enabledCount })}
            {value.skills.length > enabledCount
              ? ` · ${t("{{count}} disabled", { count: value.skills.length - enabledCount })}`
              : ""}
          </span>
        </div>
        <div className="profile-skill-toolbar__actions">
          <Button
            className="profile-skill-check"
            variant="secondary"
            size="compact"
            aria-label={t("Check Profile Skill updates")}
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
            ref={pickerTriggerRef}
            variant="secondary"
            size="compact"
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
          const localOverride = skillReceipts.find(
            (entry) =>
              entry.localOverride &&
              entry.libraryId === reference.libraryId &&
              entry.targetName === reference.targetName
          );
          const deploymentPending = Boolean(
            !localOverride && skill && appliedSkillVersions && (enabled
              ? appliedRevision !== skill.contentHash
              : appliedRevision)
          );
          const status = !skill
            ? "Missing"
            : localOverride?.outcome === "external-active"
              ? "External active"
              : localOverride?.outcome === "external-remains"
                ? "External still active"
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
            ? `${versionLabel} · ${sourceLabel} · ${
                localOverride?.path ?? skill.path
              }`
            : t("Library skill {{id}} is missing", { id: reference.libraryId });
          return (
            <div
              className={`profile-skill-row${enabled ? "" : " is-disabled"}${
                localOverride ? " has-local-override" : ""
              }`}
              key={`${reference.libraryId}:${reference.targetName}:${index}`}
              role="listitem"
              aria-label={t("Profile Skill {{name}}", { name: reference.libraryId })}
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
                className={`profile-skill-state${
                  status === "Ready" || localOverride ? " is-neutral" : ""
                }${
                  status === "Update available" || status === "Apply pending"
                    ? " is-update"
                    : ""
                }${!skill || update?.error ? " is-error" : ""}`}
                title={update?.error ?? status}
              >
                <strong>{t(status)}</strong>
                {localOverride && selectedTargetName ? (
                  <small>{selectedTargetName} · {t("Unmanaged")}</small>
                ) : appliedRevision && selectedTargetName ? (
                  <small>{t("{{name}} · {{revision}}", {
                    name: selectedTargetName,
                    revision: appliedRevision.slice(0, 7)
                  })}</small>
                ) : null}
              </span>
              {!skill ? (
                <IconButton
                  className="profile-skill-update"
                  label={t("Relink {{name}}", { name: reference.targetName })}
                  size="compact"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => openPicker(index)}
                >
                  <Link2 size={14} strokeWidth={2.2} />
                </IconButton>
              ) : enabled && update?.updateAvailable ? (
                <IconButton
                  className="profile-skill-update"
                  label={t("Update {{name}}", { name: skill.name })}
                  size="compact"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onPreviewSkillUpdate?.(reference.libraryId)}
                >
                  <Download size={14} strokeWidth={2.2} />
                </IconButton>
              ) : <span className="profile-skill-update-placeholder" aria-hidden="true" />}
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
                aria-label={t("Remove {{name}} from Profile", { name: skill?.name ?? reference.targetName })}
                title={t("Remove from Profile")}
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
            <strong>{t("No Skills in this Profile")}</strong>
            <span>{t("Add reusable skills from Library.")}</span>
          </div>
        ) : null}
      </div>

      {pickerOpen ? (
        <ModalFrame
          ariaLabel={t(replacingIndex === undefined ? "Add library skills" : "Relink missing skill")}
          className="resource-picker-dialog resource-picker-dialog--skills ui-dialog-shell"
          dialogRef={pickerDialogRef}
          dismissPolicy="intentional"
          onDismiss={closePicker}
        >
            <DialogHeader
              title={t(replacingIndex === undefined ? "Add library skills" : "Relink missing skill")}
              description={t("Choose reusable skills from Library.")}
            />
            <DialogBody className="resource-picker-dialog__body">
              <LibrarySkillPicker
                excludedIds={pickerExcludedIds}
                onChange={setSelectedIds}
                selectedIds={selectedIds}
                selectionMode={replacingIndex === undefined ? "multiple" : "single"}
                skills={pickerSkills}
              />
            </DialogBody>
            <DialogFooter>
              {onImportNewSkill ? (
                <Button
                  className="resource-picker-import"
                  onClick={() => {
                    closePicker();
                    onImportNewSkill();
                  }}
                >
                  {t("Import new Skill")}
                </Button>
              ) : null}
              <Button ref={pickerCancelRef} onClick={closePicker}>
                {t("Cancel")}
              </Button>
              <Button variant="primary" disabled={disabled || selectedIds.length === 0} onClick={commitPicker}>
                {replacingIndex !== undefined
                  ? t("Relink skill")
                  : t("Add {{count}}", { count: selectedIds.length })}
              </Button>
            </DialogFooter>
        </ModalFrame>
      ) : null}
    </section>
  );
};
