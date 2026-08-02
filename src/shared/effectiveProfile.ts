import type {
  AppliedSkillReceipt,
  ProfileDetail,
  SharedSkillPreparation
} from "./types";

export const profileWithoutLocalSkillOverrides = (
  profile: ProfileDetail,
  skillReceipts: readonly AppliedSkillReceipt[] = [],
  sharedPreparations: readonly SharedSkillPreparation[] = []
): ProfileDetail => {
  const excluded = new Set([
    ...skillReceipts
      .filter(
        (receipt) =>
          receipt.localOverride &&
          receipt.desired === "install" &&
          receipt.outcome === "external-active"
      )
      .map((entry) => `${entry.libraryId}:${entry.targetName}`),
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
