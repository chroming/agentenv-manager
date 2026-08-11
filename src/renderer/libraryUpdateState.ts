import type {
  LibraryResourceVersions,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetManagementState
} from "../shared/types";

const updatesById = (updated: SkillLibraryEntry[]) =>
  new Map(updated.map((skill) => [skill.id, skill]));

export const updateSkillInventoryAfterLibraryUpdate = (
  current: SkillInventoryEntry[],
  updated: SkillLibraryEntry[]
) => {
  const updates = updatesById(updated);
  return current.map((item) =>
    item.libraryId && updates.has(item.libraryId) && item.installMethod === "linked"
      ? {
          ...item,
          contentHash: updates.get(item.libraryId)!.contentHash,
          contentMatchesLibrary: true
        }
      : item.libraryId && updates.has(item.libraryId) && item.installMethod === "copied"
        ? { ...item, contentMatchesLibrary: false }
      : item
  );
};

export const updateProfileLibraryVersions = (
  current: Record<string, LibraryResourceVersions>,
  updated: SkillLibraryEntry[]
) => {
  const updates = updatesById(updated);
  return Object.fromEntries(
    Object.entries(current).map(([profileId, versions]) => [
      profileId,
      {
        ...versions,
        skills: Object.fromEntries(
          Object.entries(versions.skills).map(([id, version]) => [
            id,
            updates.get(id)?.contentHash ?? version
          ])
        )
      }
    ])
  );
};

export const updateAppliedTargetLibraryVersions = (
  current: TargetManagementState[],
  updated: SkillLibraryEntry[],
  inventory: SkillInventoryEntry[],
  includeCopied = false
) => {
  const updates = updatesById(updated);
  return current.map((state) => {
    const appliedSkills = state.appliedLibraryVersions?.skills;
    if (!appliedSkills || !Object.keys(appliedSkills).some((id) => updates.has(id))) {
      return state;
    }
    return {
      ...state,
      appliedLibraryVersions: {
        ...state.appliedLibraryVersions,
        skills: Object.fromEntries(
          Object.entries(appliedSkills).map(([id, version]) => [
            id,
            inventory.some(
              (install) =>
                install.libraryId === id &&
                (install.installMethod === "linked" ||
                  (includeCopied && install.installMethod === "copied")) &&
                install.foundIn.includes(state.targetId)
            )
              ? updates.get(id)?.contentHash ?? version
              : version
          ])
        )
      }
    };
  });
};
