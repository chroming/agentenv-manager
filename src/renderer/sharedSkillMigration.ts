import type {
  AgentEnvApi,
  ProfileDetail,
  RetireSkillCollectionInput,
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
  | "retireSkillCollection"
>;

export interface MoveSharedSkillToAgentsInput {
  api: SharedSkillMigrationApi;
  migration: RetireSharedSkillInput;
  targetIds: string[];
  targetNames?: Record<string, string>;
  onProgress?: (targetId: string) => void;
}

export interface MoveSkillCollectionToAgentsInput {
  api: SharedSkillMigrationApi;
  collection: RetireSkillCollectionInput & {
    members: Array<{
      skillKey: string;
      libraryId: string;
      consumerTargetIds: string[];
    }>;
  };
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
  runtimeName: string
) => {
  const mode = profile.resources.managementByTarget?.[targetId]?.skills ?? "manage";
  if (mode === "disable") return profile;
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
  const profileChanged =
    mode !== "manage" ||
    !existing ||
    existing.enabled !== true ||
    existing.targetName !== runtimeName;
  if (!profileChanged) return profile;

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

  const states = await api.listTargetStates();
  const statesByTarget = new Map(states.map((state) => [state.targetId, state]));

  for (const targetId of uniqueTargetIds) {
    onProgress?.(targetId);
    const state = statesByTarget.get(targetId);
    let profile: ProfileDetail;

    if (state?.activeProfileId) {
      if (
        state.lifecycleStatus !== "applied" &&
        state.lifecycleStatus !== "applied-with-local-override"
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
        migration.skillKey
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
          migration.skillKey
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

export const moveSkillCollectionToAgents = async ({
  api,
  collection,
  targetNames,
  onProgress
}: MoveSkillCollectionToAgentsInput): Promise<SkillCleanupResult> => {
  const targetIds = [...new Set(
    collection.members.flatMap((member) => member.consumerTargetIds)
  )].sort();
  if (targetIds.length === 0) {
    throw new Error("Skill collection has no Agent consumers to move.");
  }

  const library = await api.listSkillLibrary();
  const libraryIds = new Set(library.map((skill) => skill.id));
  const unavailable = collection.members.find((member) => !libraryIds.has(member.libraryId));
  if (unavailable) {
    throw new Error(`Library Skill is unavailable: ${unavailable.libraryId}`);
  }
  const states = await api.listTargetStates();
  const statesByTarget = new Map(states.map((state) => [state.targetId, state]));

  for (const targetId of targetIds) {
    onProgress?.(targetId);
    const state = statesByTarget.get(targetId);
    let profile: ProfileDetail;
    if (state?.activeProfileId) {
      if (
        state.lifecycleStatus !== "applied" &&
        state.lifecycleStatus !== "applied-with-local-override"
      ) {
        throw new Error(
          `${targetLabel(targetId, targetNames)} has pending or changed Profile resources. Review and Apply that Profile first.`
        );
      }
      profile = await api.readProfile(state.activeProfileId);
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
    }

    const mode = profile.resources.managementByTarget?.[targetId]?.skills ?? "manage";
    if (!profile.contentHash) {
      throw new Error(`Profile ${profile.manifest.name} is missing its current content hash.`);
    }
    const members = collection.members.filter(
      (member) => member.consumerTargetIds.includes(targetId)
    );
    const nextSkills = [...profile.resources.skills];
    let profileChanged = false;
    if (mode !== "disable") {
      for (const member of members) {
        let existingIndex = nextSkills.findIndex(
          (reference) => reference.libraryId === member.libraryId
        );
        const collisionIndex = nextSkills.findIndex(
          (reference) =>
            reference.libraryId !== member.libraryId &&
            reference.targetName === member.skillKey
        );
        if (collisionIndex >= 0) {
          if (existingIndex >= 0) {
            nextSkills.splice(collisionIndex, 1);
            existingIndex = nextSkills.findIndex(
              (reference) => reference.libraryId === member.libraryId
            );
          } else {
            nextSkills[collisionIndex] = {
              libraryId: member.libraryId,
              targetName: member.skillKey,
              enabled: true
            };
            existingIndex = collisionIndex;
          }
          profileChanged = true;
        }
        if (existingIndex >= 0) {
          if (
            !nextSkills[existingIndex].enabled ||
            nextSkills[existingIndex].targetName !== member.skillKey
          ) {
            nextSkills[existingIndex] = {
              ...nextSkills[existingIndex],
              targetName: member.skillKey,
              enabled: true
            };
            profileChanged = true;
          }
        } else {
          nextSkills.push({
            libraryId: member.libraryId,
            targetName: member.skillKey,
            enabled: true
          });
          profileChanged = true;
        }
      }
    }
    if (profileChanged || mode === "ignore") {
      profile = (
        await api.updateProfileSkills({
          profileId: profile.id,
          targetId,
          expectedContentHash: profile.contentHash,
          skills: nextSkills,
          managementMode: "manage"
        })
      ).profile;
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

  return api.retireSkillCollection({ path: collection.path });
};
