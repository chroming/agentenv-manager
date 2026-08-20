import type {
  NativeInstructionSnapshot,
  ProfileDetail,
  ProfileResourceMode,
  RemoteAgentEndpoint,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetDescriptor,
  TargetInfo
} from "../shared/types";
import { setProfileResourceMode, type ManagedProfileResource } from "../shared/profileResources";
import { summarizeProfile } from "./profileSummary";

export const deriveProfileEndpointContext = (input: {
  selectedTargetId?: string;
  profileTargets: TargetInfo[];
  remoteEndpoints: RemoteAgentEndpoint[];
  supportedTargets: TargetDescriptor[];
  draftProfile?: ProfileDetail;
  librarySkills: SkillLibraryEntry[];
  skillInventory: SkillInventoryEntry[];
  nativeInstructionSnapshots: NativeInstructionSnapshot[];
  updateDraftProfile(profile: ProfileDetail): void;
}) => {
  const selectedTarget = input.profileTargets.find(
    (target) => target.id === input.selectedTargetId
  );
  const selectedRemoteEndpoint = input.remoteEndpoints.find(
    (endpoint) => endpoint.id === input.selectedTargetId
  );
  const selectedAgentId = selectedRemoteEndpoint?.agentId ?? input.selectedTargetId;
  const selectedPolicyTarget = selectedTarget && selectedAgentId
    ? { ...selectedTarget, id: selectedAgentId }
    : undefined;
  const profileTarget = input.supportedTargets.find((target) => target.id === selectedAgentId);
  const resourceSummary = input.draftProfile && profileTarget
    ? summarizeProfile(input.draftProfile, profileTarget, input.librarySkills)
    : undefined;
  const updateResourceManagement = (
    resource: ManagedProfileResource,
    mode: ProfileResourceMode
  ) => {
    if (!input.draftProfile || !selectedAgentId) return;
    input.updateDraftProfile({
      ...input.draftProfile,
      resources: setProfileResourceMode(
        input.draftProfile.resources,
        selectedAgentId,
        resource,
        mode
      )
    });
  };
  return {
    selectedTarget,
    selectedRemoteEndpoint,
    selectedAgentId,
    selectedPolicyTarget,
    profileTarget,
    resourceSummary,
    currentTargetSkills: selectedAgentId && !selectedRemoteEndpoint
      ? input.skillInventory.filter((entry) => entry.foundIn.includes(selectedAgentId))
      : [],
    currentTargetInstructions: input.nativeInstructionSnapshots.find(
      (snapshot) => snapshot.targetId === selectedTarget?.id
    ),
    instructionsPolicy: profileTarget?.capabilities.instructions
      ? resourceSummary?.instructions.mode ?? "manage"
      : "ignore",
    skillsPolicy: profileTarget?.capabilities.skills
      ? resourceSummary?.skills.mode ?? "manage"
      : "ignore",
    updateResourceManagement
  };
};
