import type {
  AppliedSkillReceipt,
  LibraryResourceVersions,
  ProfileDetail,
  SharedSkillPreparation
} from "./types";

export const profileWithoutLocalSkillOverrides = (
  profile: ProfileDetail,
  skillReceipts: readonly AppliedSkillReceipt[] = [],
  sharedPreparations: readonly SharedSkillPreparation[] = [],
  appliedLibraryVersions?: LibraryResourceVersions
): ProfileDetail => {
  const appliedLibraryIds = new Set(
    Object.keys(appliedLibraryVersions?.skills ?? {})
  );
  const managedActive = new Set(
    skillReceipts
      .filter(
        (receipt) =>
          receipt.desired === "install" &&
          receipt.outcome === "managed-active" &&
          !receipt.localOverride &&
          appliedLibraryIds.has(receipt.libraryId)
      )
      .map((receipt) => `${receipt.libraryId}:${receipt.targetName}`)
  );
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
      .filter(
        (preparation) =>
          preparation.profileId === profile.id &&
          !managedActive.has(`${preparation.libraryId}:${preparation.targetName}`)
      )
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
