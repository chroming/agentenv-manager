import type {
  ProfileDetail,
  ProfileResources,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo,
  TargetManagementState
} from "../../shared/types";
import type { ProfileResourcePolicy } from "./ProfileResourcePolicyControl";
import { SkillsEditor } from "./SkillsEditor";

interface ProfileSkillsEditorProps {
  profile: ProfileDetail;
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  checkingSkillUpdates: boolean;
  policy: ProfileResourcePolicy;
  currentSkills: SkillInventoryEntry[];
  environmentScanStatus: "checking" | "ready" | "error";
  targetState?: TargetManagementState;
  selectedTargetId?: string;
  sharedRuntimeBoundary?: {
    libraryIds: string[];
    paths: string[];
    requiresMigration: boolean;
    targetName: string;
    onReview(): void;
  };
  onRefresh(): void;
  onCheckUpdates(ids: string[]): void;
  onPreviewUpdate(id: string): void;
  onChange(resources: ProfileResources): void;
}

export const ProfileSkillsEditor = (props: ProfileSkillsEditorProps) => (
  <SkillsEditor
    value={props.profile.resources ?? { skills: [], managementByTarget: {}, mcpByTarget: {} }}
    librarySkills={props.librarySkills}
    skillUpdates={props.skillUpdates}
    checkingSkillUpdates={props.checkingSkillUpdates}
    policy={props.policy}
    currentSkills={props.currentSkills}
    currentStateStatus={props.currentSkills.length > 0
      ? "ready"
      : props.environmentScanStatus === "checking"
        ? "loading"
        : props.environmentScanStatus === "error"
          ? "error"
          : "ready"}
    appliedSkillVersions={props.targetState?.activeProfileId === props.profile.id
      ? props.targetState.appliedLibraryVersions?.skills
      : undefined}
    skillReceipts={props.targetState?.activeProfileId === props.profile.id
      ? props.targetState.skillReceipts
      : undefined}
    sharedRuntimeBoundary={props.sharedRuntimeBoundary}
    selectedTargetId={props.selectedTargetId}
    onRefreshCurrentSkills={props.onRefresh}
    onCheckSkillUpdates={props.onCheckUpdates}
    onPreviewSkillUpdate={props.onPreviewUpdate}
    onChange={props.onChange}
  />
);
