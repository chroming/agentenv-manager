import type {
  AgentEnvApi,
  ProfileDetail,
  RetireSharedSkillInput,
  SkillCleanupResult,
  TargetManagementState
} from "../shared/types";

type SharedSkillMigrationApi = Pick<
  AgentEnvApi,
  | "listSkillLibrary"
  | "listTargetStates"
  | "readProfile"
  | "updateProfileSkills"
  | "previewCreateProfileFromTarget"
  | "createProfileFromTarget"
  | "previewApply"
  | "applyProfile"
  | "retireSharedSkill"
>;

export interface MoveSharedSkillToAgentsInput {
  api: SharedSkillMigrationApi;
  migration: RetireSharedSkillInput;
  targetIds: string[];
  targetNames?: Record<string, string>;
  onProgress?: (targetId: string) => void;
}

const targetLabel = (
  targetId: string,
  targetNames: Record<string, string> | undefined
) => targetNames?.[targetId] ?? targetId;

const ensureSkillInProfile = async (
  api: SharedSkillMigrationApi,
  profile: ProfileDetail,
  targetId: string,
  libraryId: string,
  runtimeName: string,
  agentName: string
) => {
  const mode = profile.resources.managementByTarget?.[targetId]?.skills ?? "manage";
  if (mode !== "manage") {
    throw new Error(
      `${agentName}'s active Profile does not currently manage Skills.`
    );
  }
  if (!profile.contentHash) {
    throw new Error(`Profile ${profile.manifest.name} is missing its current content hash.`);
  }

  const existing = profile.resources.skills.find(
    (reference) => reference.libraryId === libraryId
  );
  const collision = profile.resources.skills.find(
    (reference) =>
      reference.libraryId !== libraryId &&
      reference.targetName === runtimeName
  );
  if (!existing && collision) {
    throw new Error(
      `${profile.manifest.name} already installs ${collision.libraryId} as ${runtimeName}.`
    );
  }

  const skills = existing
    ? profile.resources.skills.map((reference) =>
        reference.libraryId === libraryId
          ? { ...reference, enabled: true }
          : reference
      )
    : profile.resources.skills.concat({
        libraryId,
        targetName: runtimeName,
        enabled: true
      });
  return (
    await api.updateProfileSkills({
      profileId: profile.id,
      targetId,
      expectedContentHash: profile.contentHash,
      skills,
      managementMode: "manage"
    })
  ).profile;
};

export const moveSharedSkillToAgents = async ({
  api,
  migration,
  targetIds,
  targetNames,
  onProgress
}: MoveSharedSkillToAgentsInput): Promise<SkillCleanupResult> => {
  const uniqueTargetIds = [...new Set(targetIds)].sort();
  if (uniqueTargetIds.length === 0) {
    throw new Error(`${migration.skillKey} has no Agent consumers to move.`);
  }

  const library = await api.listSkillLibrary();
  const librarySkill = library.find((skill) => skill.id === migration.libraryId);
  if (!librarySkill) {
    throw new Error(`Library Skill is unavailable: ${migration.libraryId}`);
  }
  if (librarySkill.globallyEnabled === false) {
    throw new Error(
      `${librarySkill.name} is disabled in the Library. Enable it before moving active Agent copies.`
    );
  }

  const states = await api.listTargetStates();
  const statesByTarget = new Map(states.map((state) => [state.targetId, state]));

  for (const targetId of uniqueTargetIds) {
    onProgress?.(targetId);
    const state = statesByTarget.get(targetId);
    let profile: ProfileDetail;

    if (state?.activeProfileId) {
      if (
        state.lifecycleStatus !== "applied" &&
        state.lifecycleStatus !== "applied-with-outside"
      ) {
        throw new Error(
          `${targetLabel(targetId, targetNames)} has pending or changed Profile resources. Review and Apply that Profile first.`
        );
      }
      profile = await ensureSkillInProfile(
        api,
        await api.readProfile(state.activeProfileId),
        targetId,
        migration.libraryId,
        migration.skillKey,
        targetLabel(targetId, targetNames)
      );
    } else {
      const capture = await api.previewCreateProfileFromTarget(targetId, "skills");
      if (capture.errors.length > 0) {
        throw new Error(
          `${targetLabel(targetId, targetNames)} could not be captured: ${capture.errors.join("; ")}`
        );
      }
      profile = (
        await api.createProfileFromTarget({
          previewId: capture.id,
          name: capture.suggestedName
        })
      ).profile;
      if (
        !profile.resources.skills.some(
          (reference) =>
            reference.libraryId === migration.libraryId &&
            reference.enabled
        )
      ) {
        profile = await ensureSkillInProfile(
          api,
          profile,
          targetId,
          migration.libraryId,
          migration.skillKey,
          targetLabel(targetId, targetNames)
        );
      }
    }

    const preview = await api.previewApply(profile.id, targetId);
    const blockingIssues = preview.issues.filter(
      (issue) => issue.disposition === "block"
    );
    if (blockingIssues.length > 0) {
      throw new Error(
        `${targetLabel(targetId, targetNames)} cannot be prepared: ${blockingIssues
          .map((issue) => issue.message)
          .join("; ")}`
      );
    }
    const result = await api.applyProfile(profile.id, preview.id);
    if (!result.ok) {
      throw new Error(
        `${targetLabel(targetId, targetNames)} could not be prepared: ${result.errors.join("; ")}`
      );
    }
  }

  return api.retireSharedSkill(migration);
};
