import { useEffect, useRef, useState } from "react";
import { History, Settings2, TriangleAlert } from "lucide-react";
import type {
  RetireSharedSkillInput,
  SharedSkillAreaMode,
  SkillCleanupRequest
} from "../../shared/types";
import {
  automaticSkillCleanupRequest,
  type SkillCleanupGroup,
  type SkillCollectionLinkGroup
} from "../../shared/skillCleanup";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";
import type { MoveSkillCollectionOutcome } from "../skillCollectionMigrationAction";
import type {
  AutomaticCleanupProgress,
  AutomaticCleanupReviewItem
} from "./AutomaticSkillCleanupDialog";
import {
  Button,
  ChoiceInput,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ModalFrame,
  Notice
} from "./ui";

export const buildProfilesOnlyReviewItems = (
  groups: SkillCleanupGroup[],
  collections: SkillCollectionLinkGroup[],
  targetNames: TargetNameIndex
): AutomaticCleanupReviewItem[] => [
  ...groups.flatMap((group) => {
    const migration = group.sharedMigration;
    if (!migration || migration.state === "unmanaged" || migration.state === "outside") return [];
    return [{
      effect: "move-shared-to-agents" as const,
      request: automaticSkillCleanupRequest(group),
      skillKey: group.skillKey,
      name: group.primary?.name ?? group.skillKey,
      paths: migration.paths,
      secondary: migration.consumers
        .map((targetId) => targetNameFor(targetId, targetNames, targetId))
        .join(", ")
    }];
  }),
  ...collections.filter((collection) => collection.state !== "unmanaged").map((collection) => ({
    effect: "move-shared-to-agents" as const,
    skillKey: `collection:${collection.path}`,
    name: collection.name,
    paths: [collection.path],
    secondary: collection.consumerTargetIds
      .map((targetId) => targetNameFor(targetId, targetNames, targetId))
      .join(", ")
  }))
];

export const sharedSkillCleanupDialogCopy = (
  intent: "manage" | "profiles-only",
  sharedScope: boolean
) => {
  if (intent === "profiles-only") {
    return {
      title: "Move shared Skills to Profile control",
      description:
        "AgentEnv will add eligible Skills to Library, install each saved Profile's " +
        "intended state in supported Agents, then remove the listed shared entries. Other " +
        "tools that read the shared folder will stop receiving them.",
      runLabel: "Move shared Skills to Profile control",
      runVariant: "warning" as const,
      safetyNote:
        "Only the listed shared entries are removed. Linked source folders and the parent " +
        "shared folder are never deleted."
    };
  }
  return sharedScope
    ? {
        title: "Manage shared Skills",
        description:
          "AgentEnv will manage these Skills in the shared folder. Profiles and " +
          "Agent-specific directories will not be changed.",
        runLabel: "Manage shared Skills"
      }
    : {};
};

interface RunProfilesOnlySharedCleanupInput {
  groups: SkillCleanupGroup[];
  collections: SkillCollectionLinkGroup[];
  blockedSkillKeys: string[];
  shouldStop(): boolean;
  updateProgress(skillKey: string, progress: AutomaticCleanupProgress): void;
  consolidate(requests: SkillCleanupRequest[]): Promise<{
    completedSkillKeys: string[];
    failures: Record<string, string>;
  }>;
  moveSkill(
    input: RetireSharedSkillInput,
    consumers: string[],
    options: { blockedSkillKeys: string[] }
  ): Promise<boolean>;
  retireSkill(input: RetireSharedSkillInput): Promise<boolean>;
  moveCollection?(collection: SkillCollectionLinkGroup): Promise<MoveSkillCollectionOutcome>;
}

export const runProfilesOnlySharedCleanup = async ({
  groups,
  collections,
  blockedSkillKeys,
  shouldStop,
  updateProgress,
  consolidate,
  moveSkill,
  retireSkill,
  moveCollection
}: RunProfilesOnlySharedCleanupInput): Promise<boolean> => {
  let failed = false;
  for (const group of groups.filter((item) => Boolean(item.sharedMigration))) {
    if (shouldStop()) {
      updateProgress(group.skillKey, { status: "skipped" });
      continue;
    }
    const migration = group.sharedMigration;
    if (!migration || migration.state === "unmanaged" || migration.state === "outside") continue;
    const request = automaticSkillCleanupRequest(group);
    updateProgress(group.skillKey, { status: "managing" });
    try {
      if (request) {
        const outcome = await consolidate([request]);
        if (!outcome.completedSkillKeys.includes(group.skillKey)) {
          throw new Error(outcome.failures[group.skillKey] ?? "Shared Skill could not be added to Library");
        }
      }
      const libraryId = request?.libraryId ?? migration.libraryId;
      if (!libraryId || migration.state === "conflict") {
        throw new Error("Review the content difference before using Profiles only");
      }
      const input = { skillKey: group.skillKey, libraryId, paths: migration.paths };
      const completed = migration.consumers.length > 0
        ? await moveSkill(input, migration.consumers, { blockedSkillKeys })
        : await retireSkill(input);
      if (!completed) throw new Error("Shared Skill could not be moved into Profiles");
      updateProgress(group.skillKey, { status: "managed" });
    } catch (error) {
      failed = true;
      updateProgress(group.skillKey, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  for (const collection of collections.filter((item) => item.state !== "unmanaged")) {
    const key = `collection:${collection.path}`;
    if (shouldStop()) {
      updateProgress(key, { status: "skipped" });
      continue;
    }
    updateProgress(key, { status: "managing" });
    try {
      if (collection.state !== "ready" || !moveCollection) {
        throw new Error("Review this collection and choose a Library version for every Skill first");
      }
      const outcome = await moveCollection(collection);
      if (outcome.status !== "moved") throw new Error(outcome.message);
      updateProgress(key, { status: "managed" });
    } catch (error) {
      failed = true;
      updateProgress(key, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return !failed && !shouldStop();
};

interface SharedSkillAreaModeActionsProps {
  mode?: SharedSkillAreaMode;
  operation?: SharedSkillAreaMode;
  disabled: boolean;
  canMoveToProfiles: boolean;
  canRestore: boolean;
  onChange(mode: "keep" | "managed"): void;
  onMoveToProfiles(): void;
  onShowRestorePoints(): void;
  onDialogOpenChange?(open: boolean): void;
}

export const SharedSkillAreaModeActions = ({
  mode,
  operation,
  disabled,
  canMoveToProfiles,
  canRestore,
  onChange,
  onMoveToProfiles,
  onShowRestorePoints,
  onDialogOpenChange
}: SharedSkillAreaModeActionsProps) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const policy = mode === "managed" ? "managed" : "keep";
  const moveToProfilesLabel = mode === "profiles-only"
    ? t("Move new shared Skills to Profile control…")
    : t("Move shared Skills to Profile control…");

  const setDialogOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onDialogOpenChange?.(nextOpen);
  };

  useEffect(() => () => onDialogOpenChange?.(false), [onDialogOpenChange]);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: closeRef,
    dismissDisabled: disabled,
    onDismiss: () => setDialogOpen(false)
  });

  const selectMode = (nextMode: "keep" | "managed") => {
    if (nextMode !== mode) onChange(nextMode);
    setDialogOpen(false);
  };

  return (
    <div className="shared-area-mode-actions">
      <Button
        busy={Boolean(operation)}
        disabled={disabled}
        icon={<Settings2 size={14} strokeWidth={2.1} />}
        size="compact"
        variant="secondary"
        onClick={() => setDialogOpen(true)}
      >
        {t("Change…")}
      </Button>
      {open ? (
        <ModalFrame
          ariaLabel={t("Shared Skills behavior")}
          className="shared-skill-behavior-dialog ui-dialog-shell"
          dialogRef={dialogRef}
          dismissDisabled={disabled}
          onDismiss={() => setDialogOpen(false)}
        >
          <DialogHeader
            title={t("Shared Skills behavior")}
            description={t("Choose who controls Skills in the shared folder.")}
          />
          <DialogBody className="shared-skill-behavior-dialog__body">
            {mode !== "profiles-only" ? (
              <div className="ui-choice-list" role="radiogroup" aria-label={t("Shared Skills behavior") }>
                <label className={`ui-choice-card${policy === "keep" ? " is-selected" : ""}`}>
                  <ChoiceInput
                    checked={policy === "keep"}
                    disabled={disabled}
                    name="shared-skill-behavior"
                    type="radio"
                    onChange={() => selectMode("keep")}
                  />
                  <span>
                    <strong>{t("Leave as-is")}</strong>
                    <small>{t("AgentEnv observes this folder but does not change its Skills.")}</small>
                  </span>
                </label>
                <label className={`ui-choice-card${policy === "managed" ? " is-selected" : ""}`}>
                  <ChoiceInput
                    checked={policy === "managed"}
                    disabled={disabled}
                    name="shared-skill-behavior"
                    type="radio"
                    onChange={() => selectMode("managed")}
                  />
                  <span>
                    <strong>{t("Manage shared Skills")}</strong>
                    <small>{t("Library manages the shared copies used by every Agent that reads this folder.")}</small>
                  </span>
                </label>
              </div>
            ) : (
              <Notice
                title={t("Profiles control these Skills")}
                tone="info"
              >
                {t("Shared copies were removed after a reviewed migration. Restore them from recovery history if needed.")}
              </Notice>
            )}
            {canMoveToProfiles ? (
              <section className="shared-skill-behavior-dialog__migration">
                <span>
                  <strong>{t("Use Profile control instead")}</strong>
                  <small>{t("Moves the listed Skills out of the shared folder after preview and backup.")}</small>
                </span>
                <Button
                  busy={operation === "profiles-only"}
                  disabled={disabled}
                  icon={<TriangleAlert size={14} strokeWidth={2.2} />}
                  size="compact"
                  variant="warning"
                  onClick={() => {
                    setDialogOpen(false);
                    onMoveToProfiles();
                  }}
                >
                  {moveToProfilesLabel}
                </Button>
              </section>
            ) : null}
            {mode === "profiles-only" && canRestore ? (
              <Button
                disabled={disabled}
                icon={<History size={14} strokeWidth={2.2} />}
                size="compact"
                onClick={() => {
                  setDialogOpen(false);
                  onShowRestorePoints();
                }}
              >
                {t("Restore shared setup…")}
              </Button>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button ref={closeRef} disabled={disabled} onClick={() => setDialogOpen(false)}>
              {t("Close")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
    </div>
  );
};
