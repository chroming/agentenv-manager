import type {
  ProfileDetail,
  ProfileResources,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo,
  TargetManagementState
} from "../../shared/types";
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
  const activeSharedSkills = currentSkills.filter((entry) => {
    if (!entry.sharedLocation && !entry.collectionLink) return false;
    const runtimeState = entry.runtimeStates?.find((state) => state.targetId === targetId);
    const availability = runtimeState?.availability ?? entry.runtimeAvailability ?? "unknown";
    return availability !== "disabled" && availability !== "shadowed";
  });
  const sharedRuntimePaths = [...new Set([
    ...activeSharedSkills.map((entry) => entry.collectionLink?.path ?? entry.path),
    ...(targetState?.activeProfileId === profile.id
      ? (targetState.sharedSkillPreparations ?? []).flatMap((item) => item.sharedPaths)
      : [])
  ])].sort();

  return (
    <ProfileComposerSection
      id="skills"
      icon={<ProductIcon name="skills" size={18} />}
      title={t("Skills")}
      description={t("Reusable skills and workflows")}
      count={summary.total}
      enabledCount={summary.count}
      countSummary={sharedRuntimePaths.length > 0 ? t("Shared folder active") : undefined}
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
        skillUpdates={skillUpdates}
        checkingSkillUpdates={checkingSkillUpdates}
        policy={policy}
        currentSkills={currentSkills}
        environmentScanStatus={environmentScanStatus}
        targetState={targetState}
        selectedTargetId={targetId}
        sharedRuntimeBoundary={sharedRuntimePaths.length > 0 ? {
          paths: sharedRuntimePaths,
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
