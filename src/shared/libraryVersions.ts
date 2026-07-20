import type {
  LibraryResourceVersions,
  ProfileDetail,
  SkillLibraryEntry
} from "./types";
import { profileManagesResource } from "./profileResources";

export const collectLibraryResourceVersions = (
  profile: Pick<ProfileDetail, "resources">,
  skills: readonly SkillLibraryEntry[],
  targetId?: string
): LibraryResourceVersions => {
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const managesSkills = !targetId || profileManagesResource(profile.resources, targetId, "skills");
  return {
    skills: Object.fromEntries(
      [...new Set(
        (managesSkills ? profile.resources.skills : [])
          .filter(
            (reference) =>
              reference.enabled &&
              skillById.get(reference.libraryId)?.globallyEnabled !== false
          )
          .map((reference) => reference.libraryId)
      )]
        .sort()
        .map((id) => [id, skillById.get(id)?.contentHash ?? "missing"])
    )
  };
};

export const libraryResourceVersionsEqual = (
  left: LibraryResourceVersions | undefined,
  right: LibraryResourceVersions | undefined
): boolean => Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));
