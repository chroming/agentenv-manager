import { FileText, GripVertical, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type {
  InstructionBlock,
  ProfileDetail,
  ProfileResources
} from "../../shared/types";
import { joinInstructionContents } from "../../shared/profileInstructions";
import type { ProfileResourceSummary } from "../profileSummary";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { ProductIcon } from "../productIcons";
import { InstructionDocumentDialog } from "./InstructionDocumentDialog";
import { LibraryInstructionPicker } from "./LibraryInstructionPicker";
import { OverflowTooltip } from "./OverflowTooltip";
import { ProfileComposerSection } from "./ProfileComposerSection";
import type { ProfileResourcePolicy } from "./ProfileResourcePolicyControl";
import {
  AlignedResourceList,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  ModalFrame,
  ResourcePanelToolbar,
  ResourceRow,
  Switch,
  TextAction,
  ToolbarOverflowMenu
} from "./ui";

interface ProfileInstructionsComposerSectionProps {
  profile: ProfileDetail;
  blocks: InstructionBlock[];
  summary: ProfileResourceSummary["instructions"];
  policy: ProfileResourcePolicy;
  capabilityAvailable: boolean;
  expanded: boolean;
  targetName: string;
  fileName: string;
  currentValue?: string;
  currentValueAvailable?: boolean;
  onToggle(): void;
  onPolicyChange(policy: ProfileResourcePolicy): void;
  onChange(instructions: string, resources: ProfileResources): void;
}

export const ProfileInstructionsComposerSection = ({
  profile,
  blocks,
  summary,
  policy,
  capabilityAvailable,
  expanded,
  targetName,
  fileName,
  currentValue,
  currentValueAvailable = false,
  onToggle,
  onPolicyChange,
  onChange
}: ProfileInstructionsComposerSectionProps) => {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [document, setDocument] = useState<"compiled" | "inline" | string>();
  const pickerDialogRef = useRef<HTMLElement>(null);
  const pickerCancelRef = useRef<HTMLButtonElement>(null);
  const references = profile.resources.instructions ?? [];
  const enabledReferenceCount = references.filter((reference) => reference.enabled).length;
  const blockById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  const enabledContents = references
    .filter((reference) => reference.enabled)
    .map((reference) => blockById.get(reference.libraryId)?.content ?? "");
  const compiled = joinInstructionContents([...enabledContents, profile.instructions]);
  const selectedBlock = document && document !== "compiled" && document !== "inline"
    ? blockById.get(document)
    : undefined;
  const activeDocument = document === "compiled"
    ? { name: fileName, value: compiled, path: t("Compiled for {{name}}", { name: targetName }), editable: false }
    : document === "inline"
      ? { name: fileName, value: profile.instructions, path: t("Saved in this Profile"), editable: true }
      : selectedBlock
        ? { name: selectedBlock.name, value: selectedBlock.content, path: t("Instruction Library"), editable: false }
        : undefined;

  useModalDialog({
    open: pickerOpen,
    dialogRef: pickerDialogRef,
    initialFocusRef: pickerCancelRef,
    onDismiss: () => setPickerOpen(false)
  });

  const updateReferences = (next: typeof references) => onChange(profile.instructions, {
    ...profile.resources,
    instructions: next
  });
  const moveReference = (from: number, to: number) => {
    if (to < 0 || to >= references.length) return;
    const next = [...references];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    updateReferences(next);
  };
  const commitPicker = () => {
    updateReferences([
      ...references,
      ...selectedIds.map((libraryId) => ({ libraryId, enabled: true }))
    ]);
    setSelectedIds([]);
    setPickerQuery("");
    setPickerOpen(false);
  };

  return (
    <ProfileComposerSection
      id="instructions"
      icon={<ProductIcon name="instructions" size={18} />}
      title={t("Instructions")}
      description={t("Reusable rules compiled into the Agent instruction file")}
      count={summary.total}
      enabledCount={summary.count}
      chipNames={references.map((reference) => blockById.get(reference.libraryId)?.name).filter((name): name is string => Boolean(name))}
      policy={summary.mode}
      policyDisabled={!capabilityAvailable}
      policyLabel={t("Instructions application policy for {{name}}", { name: targetName })}
      policyStatus={capabilityAvailable ? undefined : t("Agent controlled")}
      expanded={expanded}
      onToggle={onToggle}
      onPolicyChange={onPolicyChange}
    >
      <section className="profile-instructions-editor">
        <ResourcePanelToolbar>
          <span className="profile-instructions-editor__summary">
            {policy === "manage"
              ? t("{{enabled}} of {{total}} blocks enabled", {
                  enabled: enabledReferenceCount,
                  total: references.length
                })
              : policy === "disable"
                ? t("Instructions are turned off for this Agent")
                : t("Current Agent instructions remain unchanged")}
          </span>
          <span className="profile-instructions-editor__toolbar-actions">
            <>
              <Button
                size="compact"
                disabled={policy !== "manage"}
                onClick={() => setDocument("compiled")}
              >{t("Preview output")}</Button>
              <Button
                size="compact"
                icon={<Plus size={14} />}
                disabled={policy !== "manage"}
                onClick={() => setPickerOpen(true)}
              >{t("Add")}</Button>
            </>
          </span>
        </ResourcePanelToolbar>
        <AlignedResourceList actionTrack="standard">
          {policy === "ignore" && currentValueAvailable ? (
            <ResourceRow
              icon={<FileText size={15} />}
              title={fileName}
              description={t("Current {{name}} file", { name: targetName })}
              state={t("Agent controlled")}
            />
          ) : null}
          {policy !== "ignore" ? references.map((reference, index) => {
            const block = blockById.get(reference.libraryId);
            const name = block?.name ?? reference.libraryId;
            return (
              <ResourceRow
                key={reference.libraryId}
                tone={!reference.enabled || policy !== "manage" ? "disabled" : "default"}
                icon={<FileText size={15} />}
                title={<TextAction onClick={() => setDocument(reference.libraryId)}>{name}</TextAction>}
                description={(
                  <OverflowTooltip
                    className="profile-instruction-description"
                    text={block?.description || t("Instruction Library")}
                  />
                )}
                metadata={t("Library")}
                state={reference.enabled ? t("On") : t("Off")}
                actions={(
                  <>
                    {references.length > 1 ? (
                      <IconButton
                        className="profile-instruction-drag"
                        label={t("Reorder {{name}}", { name })}
                        size="compact"
                        variant="ghost"
                        draggable={policy === "manage"}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          moveReference(Number(event.dataTransfer.getData("text/plain")), index);
                        }}
                        onKeyDown={(event) => {
                          if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                          event.preventDefault();
                          moveReference(index, index + (event.key === "ArrowUp" ? -1 : 1));
                        }}
                      >
                        <GripVertical size={14} />
                      </IconButton>
                    ) : null}
                    <Switch
                      checked={reference.enabled}
                      disabled={policy !== "manage" || !block}
                      label={t(reference.enabled ? "Disable {{name}}" : "Enable {{name}}", { name })}
                      onClick={() => updateReferences(references.map((item, currentIndex) =>
                        currentIndex === index ? { ...item, enabled: !item.enabled } : item
                      ))}
                    />
                    <ToolbarOverflowMenu
                      disabled={policy !== "manage"}
                      label={t("More actions for {{name}}", { name })}
                      menuLabel={t("Actions for {{name}}", { name })}
                      items={[{
                        id: "remove",
                        label: t("Remove from Profile"),
                        icon: <Trash2 size={14} />,
                        onSelect: () => updateReferences(references.filter((_, currentIndex) => currentIndex !== index))
                      }]}
                    />
                  </>
                )}
              />
            );
          }) : null}
          {policy !== "ignore" ? (
            <ResourceRow
              icon={<FileText size={15} />}
              title={(
                <TextAction
                  aria-label={t("Open {{name}}", { name: fileName })}
                  onClick={() => setDocument("inline")}
                >{fileName}</TextAction>
              )}
              description={profile.instructions.trim()
                ? t("Profile-specific instructions")
                : t("No Profile-specific content")}
              metadata={t("This Profile")}
              state={profile.instructions.trim() ? t("On") : t("Empty")}
            />
          ) : null}
        </AlignedResourceList>
      </section>
      {pickerOpen ? (
        <ModalFrame
          ariaLabel={t("Add Instruction Blocks")}
          className="resource-picker-dialog resource-picker-dialog--instructions ui-dialog-shell"
          dialogRef={pickerDialogRef}
          dismissPolicy="intentional"
          onDismiss={() => setPickerOpen(false)}
        >
          <DialogHeader
            title={t("Add Instruction Blocks")}
            description={t("Choose reusable Instructions and arrange them after adding.")}
          />
          <DialogBody className="resource-picker-dialog__body">
            <LibraryInstructionPicker
              blocks={blocks}
              excludedIds={new Set(references.map((reference) => reference.libraryId))}
              query={pickerQuery}
              selectedIds={selectedIds}
              onQueryChange={setPickerQuery}
              onChange={setSelectedIds}
            />
          </DialogBody>
          <DialogFooter>
            <Button ref={pickerCancelRef} onClick={() => setPickerOpen(false)}>{t("Cancel")}</Button>
            <Button variant="primary" disabled={selectedIds.length === 0} onClick={commitPicker}>
              {t("Add {{count}}", { count: selectedIds.length })}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
      {activeDocument ? (
        <InstructionDocumentDialog
          open
          ariaLabel={t("Instruction document")}
          editable={activeDocument.editable}
          editorLabel={t("Profile instruction content")}
          fileName={activeDocument.name}
          path={activeDocument.path}
          resetKey={`${document}-${activeDocument.value}`}
          value={activeDocument.value}
          onClose={() => setDocument(undefined)}
          onSave={(instructions) => onChange(instructions, profile.resources)}
        />
      ) : null}
    </ProfileComposerSection>
  );
};
