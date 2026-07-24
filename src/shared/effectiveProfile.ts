import type {
  ProfileDetail,
  SharedSkillPreparation,
  TargetKeptOutsideSkill
} from "./types";

export const profileWithoutLocalSkillExceptions = (
  profile: ProfileDetail,
  keptOutsideSkills: readonly TargetKeptOutsideSkill[] = [],
  sharedPreparations: readonly SharedSkillPreparation[] = []
): ProfileDetail => {
  const excluded = new Set([
    ...keptOutsideSkills.map((entry) => `${entry.libraryId}:${entry.targetName}`),
    ...sharedPreparations
      .filter((preparation) => preparation.profileId === profile.id)
      .map((preparation) => `${preparation.libraryId}:${preparation.targetName}`)
  ]);
  return excluded.size === 0
    ? profile
    : {
        ...profile,
        resources: {
          ...profile.resources,
          skills: profile.resources.skills.filter(
            (reference) =>
              !excluded.has(`${reference.libraryId}:${reference.targetName}`)
          )
        }
      };
};
