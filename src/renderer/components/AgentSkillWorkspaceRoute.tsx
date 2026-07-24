import type {
  ApplyIssue,
  ProfileResourceMode,
  ProfileResources,
  SkillLibraryEntry,
  SkillUpdateInfo,
  SkillUpdatePlan
} from "../../shared/types";
import type { AgentSkillWorkspaceController } from "../hooks/useAgentSkillWorkspace";
import { AgentSkillWorkspace } from "./AgentSkillWorkspace";
import { SkillUpdateDialog } from "./SkillUpdateDialog";

interface AgentSkillWorkspaceRouteProps {
  workspace: AgentSkillWorkspaceController;
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  checkingSkillUpdates: boolean;
  selectedSkillUpdatePlan?: SkillUpdatePlan;
  updateBusy: boolean;
  onBeginSetup(scope: "all" | "skills"): void;
  onOpenProfile(profileId: string, targetId: string): void;
  onOpenImport(): void;
  onCheckSkillUpdates(ids: string[]): void;
  onPreviewSkillUpdate(id: string): void;
  onCloseSkillUpdate(): void;
  onConfirmSkillUpdate(plan: SkillUpdatePlan): void;
  onKeepSkillOutside(issue: ApplyIssue): Promise<void>;
}

export const AgentSkillWorkspaceRoute = ({
  workspace,
  librarySkills,
  skillUpdates,
  checkingSkillUpdates,
  selectedSkillUpdatePlan,
  updateBusy,
  onBeginSetup,
  onOpenProfile,
  onOpenImport,
  onCheckSkillUpdates,
  onPreviewSkillUpdate,
  onCloseSkillUpdate,
  onConfirmSkillUpdate,
  onKeepSkillOutside
}: AgentSkillWorkspaceRouteProps) => {
  const target = workspace.selectedTarget;
  if (!target) return null;
  return (
    <>
      <AgentSkillWorkspace
        target={target}
        targetState={workspace.targetState}
        profile={workspace.profile}
        librarySkills={librarySkills}
        skillUpdates={skillUpdates}
        importedSkills={workspace.importedSkills}
        sharedProfileTargetNames={workspace.sharedProfileTargetNames}
        localSkillCount={workspace.localSkillCount}
        loading={workspace.loading}
        loadError={workspace.loadError}
        saving={workspace.saving}
        saveStatus={workspace.saveStatus}
        checkingSkillUpdates={checkingSkillUpdates}
        preview={workspace.preview}
        previewing={workspace.previewing}
        applying={workspace.applying}
        onBack={workspace.close}
        onRetry={() => void workspace.retry()}
        onBeginSetup={onBeginSetup}
        onOpenProfile={(profileId) => {
          if (profileId) onOpenProfile(profileId, target.id);
        }}
        onOpenImport={onOpenImport}
        onDismissImported={workspace.clearImportedSkills}
        onCheckSkillUpdates={onCheckSkillUpdates}
        onPreviewSkillUpdate={onPreviewSkillUpdate}
        onSaveProfileSkills={(
          resources: ProfileResources,
          strategy: "fork" | "shared",
          managementMode?: ProfileResourceMode
        ) => {
          void workspace.saveProfileSkills(resources, strategy, managementMode);
        }}
        onPreviewApply={() => void workspace.previewApply()}
        onCancelPreview={workspace.cancelPreview}
        onApply={() => void workspace.apply()}
        onKeepSkillOutside={onKeepSkillOutside}
      />
      <SkillUpdateDialog
        plan={selectedSkillUpdatePlan}
        busy={updateBusy}
        onClose={onCloseSkillUpdate}
        onConfirm={onConfirmSkillUpdate}
      />
    </>
  );
};
