import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleArrowUp,
  FolderInput,
  FolderTree,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2
} from "lucide-react";
import type {
  AppliedSkillReceipt,
  ProfileResources,
  SkillGroup,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillSourceGroupView,
  SkillUpdateInfo
} from "../../shared/types";
import {
  addProfileSkillGroup,
  manualProfileSkillGroup,
  profileSkillEnabled,
  profileSkillGroupChanged,
  profileSkillGroupGateOpen,
  removeProfileSkillGroup,
  setProfileSkillGroupEnabled,
  sourceProfileSkillGroup,
  syncProfileSkillGroup,
  type AvailableProfileSkillGroup
} from "../../shared/profileSkillGroups";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import { LibrarySkillPicker } from "./LibrarySkillPicker";
import { LibrarySkillGroupPicker } from "./LibrarySkillGroupPicker";
import type { ProfileResourcePolicy } from "./ProfileResourcePolicyControl";
import {
  AlignedResourceList,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  InteractiveStatus,
  ModalFrame,
  Notice,
  ResourcePanelToolbar,
  ResourceDisclosureSection,
  ResourceRow,
  SegmentedControl,
  ToolbarOverflowMenu,
  Switch
} from "./ui";

interface SkillsEditorProps {
  value: ProfileResources;
  librarySkills?: SkillLibraryEntry[];
  skillGroups?: SkillGroup[];
  sourceGroups?: SkillSourceGroupView[];
  skillUpdates?: SkillUpdateInfo[];
  checkingSkillUpdates?: boolean;
  disabled?: boolean;
  appliedSkillVersions?: Record<string, string>;
  skillReceipts?: AppliedSkillReceipt[];
  selectedTargetId?: string;
  policy?: ProfileResourcePolicy;
  currentSkills?: SkillInventoryEntry[];
  currentStateStatus?: "loading" | "ready" | "error";
  sharedRuntimeBoundary?: {
    libraryIds: string[];
    paths: string[];
    requiresMigration: boolean;
    targetName: string;
    onReview(): void;
  };
  onCheckSkillUpdates?(ids: string[]): void;
  onImportNewSkill?(): void;
  onPreviewSkillUpdate?(id: string): void;
  onRefreshCurrentSkills?(): void;
  onChange(value: ProfileResources): void;
}

export const SkillsEditor = ({
  value,
  librarySkills = [],
  skillGroups = [],
  sourceGroups = [],
  skillUpdates = [],
  checkingSkillUpdates = false,
  disabled = false,
  appliedSkillVersions,
  skillReceipts = [],
  selectedTargetId,
  policy = "manage",
  currentSkills = [],
  currentStateStatus = "ready",
  sharedRuntimeBoundary,
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
  const sharedRuntimeLibraryIds = new Set(sharedRuntimeBoundary?.libraryIds ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>([]);
  const [pickerMode, setPickerMode] = useState<"skills" | "groups">("skills");
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
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
  const availableGroups = useMemo<AvailableProfileSkillGroup[]>(() => [
    ...skillGroups.map(manualProfileSkillGroup),
    ...sourceGroups.map(sourceProfileSkillGroup)
  ], [skillGroups, sourceGroups]);
  const availableGroupsByKey = useMemo(
    () => new Map(availableGroups.map((group) => [`${group.kind}:${group.groupId}`, group])),
    [availableGroups]
  );
  const attachedIds = new Set(value.skills.map((skill) => skill.libraryId));
  const enabledCount = value.skills.filter((reference) => {
    const skill = skillsById.get(reference.libraryId);
    return Boolean(skill && profileSkillEnabled(value, reference) && skill.globallyEnabled !== false);
  }).length;
  const checkableIds = value.skills
    .filter((reference) => profileManagesSkills && profileSkillEnabled(value, reference))
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
  const attachedGroupKeys = new Set(
    (value.skillGroups ?? []).map((group) => `${group.kind}:${group.groupId}`)
  );
  const pickerGroups = availableGroups.filter((group) =>
    !attachedGroupKeys.has(`${group.kind}:${group.groupId}`) && group.memberIds.length > 0
  );

  const closePicker = () => {
    setPickerOpen(false);
    setSelectedIds([]);
    setSelectedGroupKeys([]);
    setPickerMode("skills");
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
    setSelectedGroupKeys([]);
    setPickerMode("skills");
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
    if (pickerMode === "groups") {
      const next = selectedGroupKeys.reduce((resources, key) => {
        const group = availableGroupsByKey.get(key);
        return group ? addProfileSkillGroup(resources, group, librarySkills) : resources;
      }, value);
      if (next !== value) onChange(next);
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

  const renderProfileSkill = (
    reference: ProfileResources["skills"][number],
    index: number,
    options: { groupEnabled?: boolean; grouped?: boolean } = {}
  ) => {
    const skill = skillsById.get(reference.libraryId);
    const update = updatesById.get(reference.libraryId);
    const preferenceEnabled = reference.enabled !== false;
    const groupEnabled = options.groupEnabled !== false;
    const globallyEnabled = skill?.globallyEnabled !== false;
    const effectiveEnabled = profileDisablesSkills
      ? false
      : Boolean(skill && profileSkillEnabled(value, reference) && globallyEnabled);
    const switchChecked = !profileDisablesSkills && !groupEnabled
      ? preferenceEnabled
      : effectiveEnabled;
    const appliedRevision = appliedSkillVersions?.[reference.libraryId];
    const localOverride = skillReceipts.find(
      (entry) =>
        entry.localOverride &&
        entry.libraryId === reference.libraryId &&
        entry.targetName === reference.targetName
    );
    const sharedRuntimeControlsSkill = sharedRuntimeLibraryIds.has(reference.libraryId);
    const deploymentPending = Boolean(
      profileManagesSkills && !sharedRuntimeControlsSkill && !localOverride && skill && appliedSkillVersions && (effectiveEnabled
        ? appliedRevision !== skill.contentHash
        : appliedRevision)
    );
    const status = !groupEnabled
      ? "Group off"
      : sharedRuntimeControlsSkill
        ? effectiveEnabled ? "Will be on" : "Will be off"
        : !skill
          ? "Missing"
          : localOverride?.outcome === "external-active"
            ? "External active"
            : localOverride?.outcome === "external-remains"
              ? "External still active"
              : profileDisablesSkills
                ? "Off for Agent"
                : !globallyEnabled
                  ? "Disabled in Library"
                  : !preferenceEnabled
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
    const menuItems = options.grouped ? [] : [
      ...(!skill ? [{
        id: "relink",
        icon: <Link2 size={14} strokeWidth={2.2} aria-hidden="true" />,
        label: t("Relink {{name}}", { name: reference.targetName }),
        onSelect: () => openPicker(index)
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
        className={`ui-resource-children__item profile-skill-row${effectiveEnabled ? "" : " is-disabled"}${
          options.grouped ? " is-group-member" : ""
        }${localOverride ? " has-local-override" : ""}`}
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
        state={status === "Update available" ? (
          <InteractiveStatus
            className="profile-skill-state is-update"
            icon={<CircleArrowUp size={13} strokeWidth={2.2} />}
            label={t("Update available")}
            reviewLabel={t("Review update {{id}}", { id: reference.libraryId })}
            statusKind="update-available"
            tone="accent"
            onReview={onPreviewSkillUpdate
              ? () => onPreviewSkillUpdate(reference.libraryId)
              : undefined}
          />
        ) : (
          <span
            className={`profile-skill-state${
              status === "Ready" || localOverride ? " is-neutral" : ""
            }${status === "Apply pending" ? " is-update" : ""}${
              !skill || update?.error ? " is-error" : ""
            }`}
            title={update?.error ?? status}
          >
            {t(status)}
          </span>
        )}
        title={<OverflowTooltip className="profile-skill-name" text={skillName} />}
        tone={effectiveEnabled ? "default" : "disabled"}
        actions={(
          <>
            <Switch
              checked={switchChecked}
              className="profile-skill-switch"
              disabled={disabled || !profileManagesSkills || !skill || !globallyEnabled || !groupEnabled}
              label={t(!groupEnabled
                ? "Enable the Group to change {{name}}"
                : !globallyEnabled
                  ? "{{name}} is disabled in Library"
                  : switchChecked
                    ? "Disable {{name}}"
                    : "Enable {{name}}", { name: skillName })}
              onClick={() => onChange({
                ...value,
                skills: value.skills.map((entry, currentIndex) =>
                  currentIndex === index ? { ...entry, enabled: entry.enabled === false } : entry
                )
              })}
            />
            {menuItems.length > 0 ? (
              <ToolbarOverflowMenu
                disabled={disabled || !profileManagesSkills}
                items={menuItems}
                label={t("More actions for {{name}}", { name: skillName })}
                menuLabel={t("Actions for {{name}}", { name: skillName })}
              />
            ) : null}
          </>
        )}
      />
    );
  };

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

      {sharedRuntimeBoundary?.requiresMigration ? (
        <Notice
          actions={(
            <Button
              icon={<FolderInput size={14} strokeWidth={2.1} aria-hidden="true" />}
              size="compact"
              variant="warning"
              onClick={sharedRuntimeBoundary.onReview}
            >
              {t("Move shared Skills to Profile control…")}
            </Button>
          )}
          className="profile-skill-shared-notice"
          icon={<FolderInput size={16} strokeWidth={2.1} aria-hidden="true" />}
          title={t("Shared copies prevent this Profile change")}
          tone="info"
        >
          <span>{t(
            "{{target}} still loads these Skills from a shared folder. Move them after preview and backup so this Profile can control whether they are on or off.",
            { target: sharedRuntimeBoundary.targetName }
          )}</span>
          <OverflowTooltip
            ariaLabel={t("Shared Skill paths")}
            className="profile-skill-shared-path"
            displayText={sharedRuntimeBoundary.paths.length > 1
              ? t("{{path}} and {{count}} more", {
                  path: sharedRuntimeBoundary.paths[0],
                  count: sharedRuntimeBoundary.paths.length - 1
                })
              : sharedRuntimeBoundary.paths[0]}
            text={sharedRuntimeBoundary.paths.join("\n")}
          />
        </Notice>
      ) : null}

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
        {!agentOwnsSkills ? (value.skillGroups ?? []).map((group) => {
          const available = availableGroups.find((candidate) =>
            candidate.kind === group.kind && candidate.groupId === group.groupId
          );
          const changed = profileSkillGroupChanged(group, available);
          const members = group.memberIds.flatMap((libraryId) => {
            const index = value.skills.findIndex((skill) =>
              skill.libraryId === libraryId && (skill.groupIds ?? []).includes(group.id)
            );
            return index >= 0 ? [{ reference: value.skills[index], index }] : [];
          });
          const preferredCount = members.filter(({ reference }) => reference.enabled !== false).length;
          const expanded = expandedGroupIds.includes(group.id);
          return (
            <ResourceDisclosureSection
              actions={(
                <>
                  <Switch
                    checked={group.enabled}
                    disabled={disabled || !profileManagesSkills}
                    label={t(group.enabled ? "Turn off {{name}}" : "Turn on {{name}}", { name: group.name })}
                    onClick={() => onChange(setProfileSkillGroupEnabled(value, group.id, !group.enabled))}
                  />
                  <ToolbarOverflowMenu
                    disabled={disabled || !profileManagesSkills}
                    items={[
                      ...(changed && available ? [{
                        id: "sync",
                        icon: <RefreshCw size={14} strokeWidth={2.1} />,
                        label: t("Sync Group members"),
                        onSelect: () => onChange(syncProfileSkillGroup(value, group.id, available, librarySkills))
                      }] : []),
                      {
                        id: "remove",
                        icon: <Trash2 size={14} strokeWidth={2.1} />,
                        label: t("Remove Group from Profile"),
                        onSelect: () => onChange(removeProfileSkillGroup(value, group.id))
                      }
                    ]}
                    label={t("More actions for {{name}}", { name: group.name })}
                    menuLabel={t("Actions for {{name}}", { name: group.name })}
                  />
                </>
              )}
              className={`profile-skill-group${group.enabled ? "" : " is-group-off"}`}
              density="compact"
              description={group.kind === "source" ? t("Source Group") : t("Manual Group")}
              expanded={expanded}
              icon={<FolderTree size={17} strokeWidth={2} />}
              id={group.id}
              key={group.id}
              onToggle={() => setExpandedGroupIds((current) =>
                current.includes(group.id)
                  ? current.filter((id) => id !== group.id)
                  : [...current, group.id]
              )}
              nested
              muted={!group.enabled}
              summary={[
                group.enabled
                  ? t("{{enabled}} of {{total}} on", { enabled: preferredCount, total: members.length })
                  : t("Group off"),
                changed ? t("Group changed") : undefined
              ].filter(Boolean).join(" · ")}
              summaryWidth="wide"
              title={group.name}
              toggleLabel={t("Toggle {{name}}", { name: group.name })}
            >
              <AlignedResourceList className="profile-skill-group__members" role="list">
                {members.map(({ reference, index }) => renderProfileSkill(reference, index, {
                  grouped: true,
                  groupEnabled: profileSkillGroupGateOpen(value, reference)
                }))}
              </AlignedResourceList>
            </ResourceDisclosureSection>
          );
        }) : null}
        {!agentOwnsSkills ? value.skills.map((reference, index) =>
          (reference.groupIds ?? []).length === 0 ? renderProfileSkill(reference, index) : null
        ) : null}
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
              title={t(replacingIndex === undefined ? "Add Skills or Groups" : "Relink missing skill")}
              description={t("Choose individual Skills or add a reusable Group.")}
            />
            <DialogBody className="resource-picker-dialog__body">
              {replacingIndex === undefined ? (
                <SegmentedControl
                  label={t("Resource type")}
                  className="profile-skill-picker-mode"
                  options={[
                    { value: "skills", label: t("Skills") },
                    { value: "groups", label: t("Groups") }
                  ]}
                  value={pickerMode}
                  onChange={(mode) => setPickerMode(mode as "skills" | "groups")}
                />
              ) : null}
              {pickerMode === "skills" || replacingIndex !== undefined ? (
                <LibrarySkillPicker
                  excludedIds={pickerExcludedIds}
                  onChange={setSelectedIds}
                  selectedIds={selectedIds}
                  selectionMode={replacingIndex === undefined ? "multiple" : "single"}
                  skills={pickerSkills}
                />
              ) : (
                <LibrarySkillGroupPicker
                  groups={pickerGroups}
                  selectedKeys={selectedGroupKeys}
                  onChange={setSelectedGroupKeys}
                />
              )}
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
              <Button
                variant="primary"
                disabled={disabled || (pickerMode === "groups" ? selectedGroupKeys.length === 0 : selectedIds.length === 0)}
                onClick={commitPicker}
              >
                {replacingIndex !== undefined
                  ? t("Relink skill")
                  : t("Add {{count}}", {
                    count: pickerMode === "groups" ? selectedGroupKeys.length : selectedIds.length
                  })}
              </Button>
            </DialogFooter>
        </ModalFrame>
      ) : null}
    </section>
  );
};
