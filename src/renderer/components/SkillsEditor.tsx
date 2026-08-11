import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Link2, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import type {
  AppliedSkillReceipt,
  ProfileResources,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import { LibrarySkillPicker } from "./LibrarySkillPicker";
import type { ProfileResourcePolicy } from "./ProfileResourcePolicyControl";
import {
  AlignedResourceList,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ModalFrame,
  Notice,
  ResourcePanelToolbar,
  ResourceRow,
  ToolbarOverflowMenu,
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
  selectedTargetId?: string;
  policy?: ProfileResourcePolicy;
  currentSkills?: SkillInventoryEntry[];
  currentStateStatus?: "loading" | "ready" | "error";
  onCheckSkillUpdates?(ids: string[]): void;
  onImportNewSkill?(): void;
  onPreviewSkillUpdate?(id: string): void;
  onRefreshCurrentSkills?(): void;
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
  selectedTargetId,
  policy = "manage",
  currentSkills = [],
  currentStateStatus = "ready",
  onCheckSkillUpdates,
  onImportNewSkill,
  onPreviewSkillUpdate,
  onRefreshCurrentSkills,
  onChange
}: SkillsEditorProps) => {
  const { t } = useI18n();
  const profileManagesSkills = policy === "manage";
  const profileDisablesSkills = policy === "disable";
  const agentOwnsSkills = policy === "ignore";
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
    .filter((reference) => profileManagesSkills && reference.enabled !== false)
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

  const visibleSkillCount = agentOwnsSkills ? currentSkills.length : value.skills.length;

  return (
    <section
      className={`profile-skill-manager${visibleSkillCount <= 1 ? " is-compact" : ""}`}
      aria-label={t("Profile Skills")}
      data-profile-skill-count={value.skills.length}
    >
      {profileManagesSkills ? <ResourcePanelToolbar
        aria-label={t("Profile Skill actions")}
        className="profile-skill-toolbar"
      >
        <div className="profile-skill-summary ui-visually-hidden">
          <span>
            {t("{{count}} enabled", { count: enabledCount })}
            {value.skills.length > enabledCount
              ? ` · ${t("{{count}} disabled", { count: value.skills.length - enabledCount })}`
              : ""}
          </span>
        </div>
        <div className="profile-skill-toolbar__actions">
          {profileManagesSkills && onCheckSkillUpdates &&
          (checkableIds.length > 0 || checkingSkillUpdates) ? (
            <Button
              aria-label={t("Check Profile Skill updates")}
              busy={checkingSkillUpdates}
              className="profile-skill-check"
              disabled={disabled}
              icon={<RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />}
              size="compact"
              variant="secondary"
              onClick={() => onCheckSkillUpdates(checkableIds)}
            >
              {t("Check updates")}
            </Button>
          ) : null}
          <Button
            ref={pickerTriggerRef}
            variant="secondary"
            size="compact"
            disabled={disabled}
            onClick={() => openPicker()}
            icon={<Plus size={14} strokeWidth={2.2} aria-hidden="true" />}
          >
            {t("Add Skill")}
          </Button>
        </div>
      </ResourcePanelToolbar> : null}

      {agentOwnsSkills && currentStateStatus === "loading" ? (
        <Notice
          className="profile-skill-inventory-notice"
          icon={<LoaderCircle className="is-spinning" size={15} />}
          role="status"
        >
          {t("Reading Agent Skills...")}
        </Notice>
      ) : null}
      {agentOwnsSkills && currentStateStatus === "error" ? (
        <Notice
          actions={onRefreshCurrentSkills ? (
            <Button size="compact" variant="secondary" onClick={onRefreshCurrentSkills}>
              {t("Try again")}
            </Button>
          ) : undefined}
          className="profile-skill-inventory-notice"
          icon={<AlertTriangle size={15} />}
          role="alert"
          title={t("Agent Skills unavailable")}
          tone="warning"
        >
          {t("AgentEnv could not read this Agent's current Skills. The saved Profile has not changed.")}
        </Notice>
      ) : null}

      <AlignedResourceList
        className="profile-skill-list"
        role="list"
      >
        {agentOwnsSkills && currentStateStatus === "ready" ? currentSkills.map((entry, index) => {
          const skill = entry.libraryId ? skillsById.get(entry.libraryId) : undefined;
          const runtimeState = entry.runtimeStates?.find(
            (state) => state.targetId === selectedTargetId
          );
          const availability = runtimeState?.availability ?? entry.runtimeAvailability ?? "unknown";
          const enabled = availability === "enabled";
          const status = availability === "enabled"
            ? "On in Agent"
            : availability === "disabled"
              ? "Off in Agent"
              : availability === "shadowed"
                ? "Shadowed in Agent"
                : "State unknown";
          const skillName = entry.name || entry.runtimeName || entry.deploymentName || entry.id;
          return (
            <ResourceRow
              className={`ui-resource-children__item profile-skill-row${enabled ? "" : " is-disabled"}`}
              density="compact"
              description={entry.version ? `v${entry.version}` : undefined}
              icon={(
                <ResourceIconArtwork
                  fallbackIconKey={skill?.sourceType === "github" || skill?.sourceType === "git" ? "github" : "folder"}
                  iconKey={skill?.iconKey}
                  sourceUrl={skill?.sourceType === "github" || skill?.sourceType === "git" ? skill.source : undefined}
                  size={16}
                />
              )}
              key={`${entry.path}:${index}`}
              role="listitem"
              aria-label={t("Agent Skill {{name}}", { name: skillName })}
              state={<span className="profile-skill-state is-neutral">{t(status)}</span>}
              title={(
                <OverflowTooltip
                  className="profile-skill-name"
                  displayText={skillName}
                  text={`${skillName}\n${entry.path}`}
                />
              )}
              tone={enabled ? "default" : "disabled"}
            />
          );
        }) : null}
        {!agentOwnsSkills ? value.skills.map((reference, index) => {
          const skill = skillsById.get(reference.libraryId);
          const update = updatesById.get(reference.libraryId);
          const profileEnabled = reference.enabled !== false;
          const globallyEnabled = skill?.globallyEnabled !== false;
          const enabled = profileDisablesSkills
            ? false
            : Boolean(skill && profileEnabled && globallyEnabled);
          const appliedRevision = appliedSkillVersions?.[reference.libraryId];
          const localOverride = skillReceipts.find(
            (entry) =>
              entry.localOverride &&
              entry.libraryId === reference.libraryId &&
              entry.targetName === reference.targetName
          );
          const deploymentPending = Boolean(
            profileManagesSkills && !localOverride && skill && appliedSkillVersions && (enabled
              ? appliedRevision !== skill.contentHash
              : appliedRevision)
          );
          const status = !skill
            ? "Missing"
            : localOverride?.outcome === "external-active"
                    ? "External active"
                    : localOverride?.outcome === "external-remains"
                      ? "External still active"
                      : profileDisablesSkills
                        ? "Off for Agent"
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
          const visibleDetail = skill?.version
            ? `v${skill.version}`
            : !skill
              ? t("Library skill {{id}} is missing", { id: reference.libraryId })
              : undefined;
          const skillName = skill?.name ?? reference.targetName;
          const menuItems = [
            ...(!skill ? [{
              id: "relink",
              icon: <Link2 size={14} strokeWidth={2.2} aria-hidden="true" />,
              label: t("Relink {{name}}", { name: reference.targetName }),
              onSelect: () => openPicker(index)
            }] : []),
            ...(profileManagesSkills && skill && enabled && update?.updateAvailable ? [{
              id: "update",
              icon: <Download size={14} strokeWidth={2.2} aria-hidden="true" />,
              label: t("Review update"),
              onSelect: () => onPreviewSkillUpdate?.(reference.libraryId)
            }] : []),
            {
              id: "remove",
              icon: <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />,
              label: t("Remove from Profile"),
              onSelect: () => onChange({
                ...value,
                skills: value.skills.filter((_, currentIndex) => currentIndex !== index)
              })
            }
          ];
          return (
            <ResourceRow
              className={`ui-resource-children__item profile-skill-row${enabled ? "" : " is-disabled"}${
                localOverride ? " has-local-override" : ""
              }`}
              density="compact"
              description={visibleDetail ? (
                <OverflowTooltip
                  ariaLabel={t("Full skill detail {{id}}", { id: reference.libraryId })}
                  className="profile-skill-detail"
                  displayText={visibleDetail}
                  text={visibleDetail}
                />
              ) : undefined}
              icon={(
                <ResourceIconArtwork
                  fallbackIconKey={skill?.sourceType === "github" || skill?.sourceType === "git" ? "github" : "folder"}
                  iconKey={skill?.iconKey}
                  sourceUrl={skill?.sourceType === "github" || skill?.sourceType === "git" ? skill.source : undefined}
                  size={16}
                />
              )}
              key={`${reference.libraryId}:${reference.targetName}:${index}`}
              role="listitem"
              aria-label={t("Profile Skill {{name}}", { name: reference.libraryId })}
              state={(
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
                {t(status)}
              </span>
              )}
              title={<OverflowTooltip className="profile-skill-name" text={skillName} />}
              tone={enabled ? "default" : "disabled"}
              actions={(
                <>
                  <Switch
                      checked={enabled}
                      className="profile-skill-switch"
                      disabled={disabled || !profileManagesSkills || !skill || !globallyEnabled}
                      label={t(!globallyEnabled
                        ? "{{name}} is disabled in Library"
                        : enabled
                          ? "Disable {{name}}"
                          : "Enable {{name}}", { name: skillName })}
                      onClick={() => onChange({
                        ...value,
                        skills: value.skills.map((entry, currentIndex) =>
                          currentIndex === index ? { ...entry, enabled: entry.enabled === false } : entry
                        )
                      })}
                    />
                  <ToolbarOverflowMenu
                    disabled={disabled || !profileManagesSkills}
                    items={menuItems}
                    label={t("More actions for {{name}}", { name: skillName })}
                    menuLabel={t("Actions for {{name}}", { name: skillName })}
                  />
                </>
              )}
            />
          );
        }) : null}
        {agentOwnsSkills && currentStateStatus === "ready" && currentSkills.length === 0 ? (
          <div className="profile-skill-empty">
            <strong>{t("No Skills detected in this Agent")}</strong>
            <span>{t("This Profile will leave the Agent's Skill state unchanged.")}</span>
          </div>
        ) : null}
        {!agentOwnsSkills && value.skills.length === 0 ? (
          <div className="profile-skill-empty">
            <strong>{t("No Skills in this Profile")}</strong>
            <span>{t("Add reusable skills from Library.")}</span>
          </div>
        ) : null}
      </AlignedResourceList>

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
