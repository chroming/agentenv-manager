import { ArrowRight, History } from "lucide-react";
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
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";
import type { MoveSkillCollectionOutcome } from "../skillCollectionMigrationAction";
import type {
  AutomaticCleanupProgress,
  AutomaticCleanupReviewItem
} from "./AutomaticSkillCleanupDialog";
import { Button, SegmentedControl } from "./ui";

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
  ...collections.map((collection) => ({
    effect: "move-shared-to-agents" as const,
    skillKey: `collection:${collection.path}`,
    name: collection.name,
    paths: [collection.path],
    secondary: collection.consumerTargetIds
      .map((targetId) => targetNameFor(targetId, targetNames, targetId))
      .join(", ")
  }))
];

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
  for (const collection of collections) {
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
}

export const SharedSkillAreaModeActions = ({
  mode,
  operation,
  disabled,
  canMoveToProfiles,
  canRestore,
  onChange,
  onMoveToProfiles,
  onShowRestorePoints
}: SharedSkillAreaModeActionsProps) => {
  const { t } = useI18n();
  const policy = mode === "managed" ? "managed" : "keep";
  const moveToProfilesLabel = mode === "profiles-only"
    ? t("Move new Skills to Profiles…")
    : t("Move to Profiles…");
  return (
    <div className="shared-area-mode-actions">
      {mode !== "profiles-only" ? (
        <SegmentedControl<"keep" | "managed">
          className="shared-area-mode-policy ui-segmented-control--compact"
          label={t("Shared folder policy")}
          value={policy}
          disabled={disabled}
          options={[
            { value: "keep", label: t("Leave unchanged"), busy: operation === "keep" },
            {
              value: "managed",
              label: t("Manage in place"),
              busy: operation === "managed"
            }
          ]}
          onChange={(value) => {
            if (value !== mode) onChange(value);
          }}
        />
      ) : null}
      {canMoveToProfiles ? (
        <Button
          busy={operation === "profiles-only"}
          disabled={disabled}
          icon={<ArrowRight size={14} strokeWidth={2.2} />}
          size="compact"
          onClick={onMoveToProfiles}
        >
          {moveToProfilesLabel}
        </Button>
      ) : null}
      {mode === "profiles-only" && canRestore ? (
        <Button
          disabled={disabled}
          icon={<History size={14} strokeWidth={2.2} />}
          size="compact"
          onClick={onShowRestorePoints}
        >
          {t("Restore shared setup…")}
        </Button>
      ) : null}
    </div>
  );
};
