import type {
  LibraryResourceVersions,
  SkillInventoryEntry,
  SkillLibraryUpdateResult,
  TargetManagementState
} from "../shared/types";

const updatesById = (updated: SkillLibraryUpdateResult[]) =>
  new Map(updated.map((skill) => [skill.id, skill]));

export const updateSkillInventoryAfterLibraryUpdate = (
  current: SkillInventoryEntry[],
  updated: SkillLibraryUpdateResult[],
  includeCopied = false
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
        ? includeCopied && item.status === "managed" &&
          !updates.get(item.libraryId)!.skippedAgentCopies?.some((copy) => copy.path === item.path)
          ? {
              ...item,
              contentHash: item.invocationMode === "manual" ? item.contentHash : updates.get(item.libraryId)!.contentHash,
              sourceContentHash: updates.get(item.libraryId)!.contentHash,
              contentMatchesLibrary: true
            }
          : { ...item, contentMatchesLibrary: false }
      : item
  );
};

export const updateProfileLibraryVersions = (
  current: Record<string, LibraryResourceVersions>,
  updated: SkillLibraryUpdateResult[]
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
  updated: SkillLibraryUpdateResult[],
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
            !updates.get(id)?.skippedAgentCopies?.some((copy) => copy.targetIds.includes(state.targetId)) && inventory.some(
              (install) =>
                install.libraryId === id &&
                install.status === "managed" &&
                !install.managedAsShared &&
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
