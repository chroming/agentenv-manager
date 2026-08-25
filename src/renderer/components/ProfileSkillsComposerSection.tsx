import type {
  ProfileDetail,
  ProfileResources,
  SkillInventoryEntry,
  SkillGroup,
  SkillLibraryEntry,
  SkillSourceGroupView,
  SkillUpdateInfo,
  TargetManagementState
} from "../../shared/types";
import { profileSharedSkillBoundary } from "../../shared/sharedSkillBoundary";
import type { ProfileResourceSummary } from "../profileSummary";
import { useI18n } from "../i18n";
import { ProductIcon } from "../productIcons";
import { ProfileComposerSection } from "./ProfileComposerSection";
import type { ProfileResourcePolicy } from "./ProfileResourcePolicyControl";
import { ProfileSkillsEditor } from "./ProfileSkillsEditor";

interface ProfileSkillsComposerSectionProps {
  profile: ProfileDetail;
  summary: ProfileResourceSummary["skills"];
  policy: ProfileResourcePolicy;
  capabilityAvailable: boolean;
  expanded: boolean;
  targetId?: string;
  targetName: string;
  targetState?: TargetManagementState;
  currentSkills: SkillInventoryEntry[];
  environmentScanStatus: "checking" | "ready" | "error";
  librarySkills: SkillLibraryEntry[];
  skillGroups?: SkillGroup[];
  sourceGroups?: SkillSourceGroupView[];
  skillUpdates: SkillUpdateInfo[];
  checkingSkillUpdates: boolean;
  onToggle(): void;
  onPolicyChange(policy: ProfileResourcePolicy): void;
  onReviewSharedSkills(): void;
  onRefresh(): void;
  onCheckUpdates(ids: string[]): void;
  onPreviewUpdate(id: string): void;
  onChange(resources: ProfileResources): void;
}

export const ProfileSkillsComposerSection = ({
  profile,
  summary,
  policy,
  capabilityAvailable,
  expanded,
  targetId,
  targetName,
  targetState,
  currentSkills,
  environmentScanStatus,
  librarySkills,
  skillGroups = [],
  sourceGroups = [],
  skillUpdates,
  checkingSkillUpdates,
  onToggle,
  onPolicyChange,
  onReviewSharedSkills,
  onRefresh,
  onCheckUpdates,
  onPreviewUpdate,
  onChange
}: ProfileSkillsComposerSectionProps) => {
  const { t } = useI18n();
  const sharedBoundary = profileSharedSkillBoundary({
    profile,
    targetId,
    policy,
    inventory: currentSkills,
    librarySkills
  });
  const sharedRuntimeSummary = sharedBoundary.migrationPaths.length > 0
    ? t("Needs review")
    : sharedBoundary.activePaths.length > 0
      ? t("Shared")
        : undefined;

  return (
    <ProfileComposerSection
      id="skills"
      icon={<ProductIcon name="skills" size={18} />}
      title={t("Skills")}
      description={t("Reusable skills and workflows")}
      count={summary.total}
      enabledCount={summary.count}
      countSummary={sharedRuntimeSummary}
      countStatusKind={sharedBoundary.migrationPaths.length > 0 ? "warning" : undefined}
      chipNames={summary.names}
      policy={summary.mode}
      policyDisabled={!capabilityAvailable}
      policyLabel={t("Skills application policy for {{name}}", { name: targetName })}
      policyStatus={capabilityAvailable ? undefined : t("Agent controlled")}
      expanded={expanded}
      onToggle={onToggle}
      onPolicyChange={onPolicyChange}
    >
      <ProfileSkillsEditor
        profile={profile}
        librarySkills={librarySkills}
        skillGroups={skillGroups}
        sourceGroups={sourceGroups}
        skillUpdates={skillUpdates}
        checkingSkillUpdates={checkingSkillUpdates}
        policy={policy}
        currentSkills={currentSkills}
        environmentScanStatus={environmentScanStatus}
        targetState={targetState}
        selectedTargetId={targetId}
        sharedRuntimeBoundary={sharedBoundary.activePaths.length > 0 ? {
          libraryIds: sharedBoundary.activeLibraryIds,
          paths: sharedBoundary.migrationPaths.length > 0
            ? sharedBoundary.migrationPaths
            : sharedBoundary.activePaths,
          requiresMigration: sharedBoundary.migrationPaths.length > 0,
          targetName,
          onReview: onReviewSharedSkills
        } : undefined}
        onRefresh={onRefresh}
        onCheckUpdates={onCheckUpdates}
        onPreviewUpdate={onPreviewUpdate}
        onChange={onChange}
      />
    </ProfileComposerSection>
  );
};
