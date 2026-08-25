import { FolderTree, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type {
  CreateSkillGroupInput,
  ResourceIconKey,
  SkillGroup,
  SkillLibraryEntry,
  UpdateSkillGroupInput
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { LibrarySkillPicker } from "./LibrarySkillPicker";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  ResourceIconArtwork,
  ResourceIconPicker
} from "./ResourceIconPicker";
import {
  AlignedResourceList,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  IconButton,
  ModalFrame,
  ResourcePanelToolbar,
  ResourceDisclosureSection,
  ResourceRow,
  SearchField,
  TextAction,
  TextField,
  ToolbarOverflowMenu
} from "./ui";

interface SkillGroupViewProps {
  active: boolean;
  groups: SkillGroup[];
  skills: SkillLibraryEntry[];
  onOpenSkill?(skill: SkillLibraryEntry): void;
  onCreate(input: CreateSkillGroupInput): Promise<boolean>;
  onUpdate(input: UpdateSkillGroupInput): Promise<boolean>;
  onRemove(id: string): Promise<boolean>;
}

interface GroupDraft {
  id?: string;
  name: string;
  description: string;
  iconKey?: ResourceIconKey;
  skillIds: string[];
}

const emptyDraft = (): GroupDraft => ({
  name: "",
  description: "",
  iconKey: "folder",
  skillIds: []
});

export const SkillGroupView = ({
  active,
  groups,
  skills,
  onOpenSkill,
  onCreate,
  onUpdate,
  onRemove
}: SkillGroupViewProps) => {
  const { t } = useI18n();
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<GroupDraft>();
  const [deleteCandidate, setDeleteCandidate] = useState<SkillGroup>();
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const skillsById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  const visibleGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return groups;
    return groups.filter((group) => [group.name, group.description, ...group.skillIds]
      .some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [groups, query]);

  const closeEditor = () => {
    if (!saving) setDraft(undefined);
  };
  useModalDialog({
    open: Boolean(draft),
    dialogRef,
    initialFocusRef: cancelRef,
    onDismiss: closeEditor,
    focusKey: draft?.id ?? "new-group"
  });
  useModalDialog({
    open: Boolean(deleteCandidate),
    dialogRef: deleteDialogRef,
    initialFocusRef: deleteCancelRef,
    onDismiss: () => setDeleteCandidate(undefined),
    focusKey: deleteCandidate?.id
  });

  const editGroup = (group: SkillGroup) => setDraft({
    id: group.id,
    name: group.name,
    description: group.description,
    iconKey: group.iconKey,
    skillIds: [...group.skillIds]
  });
  const saveGroup = async () => {
    if (!draft?.name.trim()) return;
    setSaving(true);
    const input = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      iconKey: draft.iconKey,
      skillIds: draft.skillIds
    };
    const saved = draft.id
      ? await onUpdate({ ...input, id: draft.id })
      : await onCreate(input);
    setSaving(false);
    if (saved) setDraft(undefined);
  };

  if (!active) return null;

  return (
    <section className="skill-group-view" aria-label={t("Skill Groups")}>
      <ResourcePanelToolbar className="skill-group-toolbar">
        <SearchField
          fieldClassName="skill-group-search"
          icon={<Search size={15} strokeWidth={2.2} />}
          label={t("Search Skill Groups")}
          placeholder={t("Search Groups...")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <Button
          icon={<Plus size={15} strokeWidth={2.2} />}
          onClick={() => setDraft(emptyDraft())}
        >
          {t("New group")}
        </Button>
      </ResourcePanelToolbar>

      <div className="skill-group-list">
        {visibleGroups.length === 0 ? (
          <EmptyState
            className="skill-group-empty"
            icon={<FolderTree size={22} strokeWidth={1.8} />}
            title={query ? t("No matching Skill Groups") : t("No Skill Groups")}
            description={query
              ? t("Try another search.")
              : t("Create a group to add several Skills to a Profile together.")}
          />
        ) : null}
        {visibleGroups.map((group) => {
          const expanded = expandedIds.includes(group.id);
          const memberSkills = group.skillIds.flatMap((id) => {
            const skill = skillsById.get(id);
            return skill ? [skill] : [];
          });
          return (
            <ResourceDisclosureSection
              actions={(
                <>
                  <IconButton
                    label={t("Add Skills to {{name}}", { name: group.name })}
                    size="compact"
                    variant="ghost"
                    onClick={() => editGroup(group)}
                  >
                    <Plus size={14} strokeWidth={2.2} />
                  </IconButton>
                  <ToolbarOverflowMenu
                    items={[
                      {
                        id: "edit",
                        icon: <Pencil size={14} strokeWidth={2.1} />,
                        label: t("Edit"),
                        onSelect: () => editGroup(group)
                      },
                      {
                        id: "delete",
                        icon: <Trash2 size={14} strokeWidth={2.1} />,
                        label: t("Delete"),
                        onSelect: () => setDeleteCandidate(group)
                      }
                    ]}
                    label={t("More actions for {{name}}", { name: group.name })}
                    menuLabel={t("Actions for {{name}}", { name: group.name })}
                  />
                </>
              )}
              className="skill-group-card"
              density="compact"
              description={group.description || t("Reusable Skill collection")}
              expanded={expanded}
              icon={(
                <ResourceIconArtwork
                  fallbackIconKey="folder"
                  iconKey={group.iconKey}
                  size={17}
                />
              )}
              id={group.id}
              nested
              onToggle={() => setExpandedIds((current) =>
                current.includes(group.id)
                  ? current.filter((id) => id !== group.id)
                  : [...current, group.id]
              )}
              summary={t("{{count}} Skills", { count: group.skillIds.length })}
              title={group.name}
              toggleLabel={t("Toggle {{name}}", { name: group.name })}
            >
              <AlignedResourceList actionTrack="compact" className="skill-group-members" role="list">
                {memberSkills.map((skill) => (
                  <ResourceRow
                    actionsVisibility="contextual"
                    density="compact"
                    icon={(
                      <ResourceIconArtwork
                        fallbackIconKey={skill.sourceType === "github" || skill.sourceType === "git" ? "github" : "folder"}
                        iconKey={skill.iconKey}
                        sourceUrl={skill.sourceType === "github" || skill.sourceType === "git" ? skill.source : undefined}
                        size={16}
                      />
                    )}
                    key={skill.id}
                    role="listitem"
                    title={onOpenSkill ? (
                      <TextAction
                        className="skill-group-member-button"
                        onClick={() => onOpenSkill(skill)}
                      >
                        <OverflowTooltip className="skill-group-member-name" text={skill.name} />
                      </TextAction>
                    ) : <OverflowTooltip className="skill-group-member-name" text={skill.name} />}
                    actions={(
                      <ToolbarOverflowMenu
                        items={[{
                          id: "remove-from-group",
                          icon: <Trash2 size={14} strokeWidth={2.1} />,
                          label: t("Remove from group"),
                          onSelect: () => void onUpdate({
                            id: group.id,
                            name: group.name,
                            description: group.description,
                            iconKey: group.iconKey,
                            skillIds: group.skillIds.filter((id) => id !== skill.id)
                          })
                        }]}
                        label={t("More actions for {{name}}", { name: skill.name })}
                        menuLabel={t("Actions for {{name}}", { name: skill.name })}
                      />
                    )}
                  />
                ))}
              </AlignedResourceList>
            </ResourceDisclosureSection>
          );
        })}
      </div>

      {draft ? (
        <ModalFrame
          ariaLabel={t(draft.id ? "Edit Skill Group" : "New Skill Group")}
          className="skill-group-dialog ui-dialog-shell"
          dialogRef={dialogRef}
          dismissPolicy="intentional"
          onDismiss={closeEditor}
        >
          <DialogHeader
            title={t(draft.id ? "Edit Skill Group" : "New Skill Group")}
            description={t("Choose the Skills this reusable group contains.")}
          />
          <DialogBody className="skill-group-dialog__body">
            <div className="skill-group-fields">
              <div className="skill-group-identity-fields">
                <ResourceIconPicker
                  className="skill-group-icon-picker"
                  fallbackIconKey="folder"
                  iconKey={draft.iconKey}
                  label={draft.name || t("Skill Group")}
                  triggerLabel={t("Choose Group icon")}
                  onChange={(iconKey) => setDraft({ ...draft, iconKey })}
                />
                <TextField
                  autoFocus
                  label={t("Group name")}
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                />
              </div>
              <TextField
                label={t("Description")}
                maxLength={500}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
              />
            </div>
            <LibrarySkillPicker
              onChange={(skillIds) => setDraft({ ...draft, skillIds })}
              selectedIds={draft.skillIds}
              selectionMode="multiple"
              skills={skills.filter((skill) => skill.globallyEnabled !== false)}
            />
          </DialogBody>
          <DialogFooter>
            <Button ref={cancelRef} disabled={saving} onClick={closeEditor}>{t("Cancel")}</Button>
            <Button
              busy={saving}
              disabled={!draft.name.trim()}
              variant="primary"
              onClick={() => void saveGroup()}
            >
              {t("Save")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}

      {deleteCandidate ? (
        <ModalFrame
          ariaLabel={t("Delete {{name}}", { name: deleteCandidate.name })}
          className="confirm-dialog ui-dialog-shell"
          dialogRef={deleteDialogRef}
          onDismiss={() => setDeleteCandidate(undefined)}
        >
          <DialogHeader
            title={t("Delete {{name}}?", { name: deleteCandidate.name })}
            description={t("The Skills stay in Library. Existing Profiles keep their saved group snapshot.")}
          />
          <DialogFooter>
            <Button ref={deleteCancelRef} onClick={() => setDeleteCandidate(undefined)}>{t("Cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => void onRemove(deleteCandidate.id).then((removed) => {
                if (removed) setDeleteCandidate(undefined);
              })}
            >
              {t("Delete group")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
    </section>
  );
};
