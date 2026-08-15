import type {
  ProfileDetail,
  SkillInventoryEntry,
  SkillUpdateImpact
} from "../shared/types";

export interface SkillUpdateImpactIndex {
  profileNamesBySkillId: Map<string, string[]>;
  installsByLibraryId: Map<string, SkillInventoryEntry[]>;
}

export const createSkillUpdateImpactIndex = (
  profiles: readonly ProfileDetail[],
  inventory: readonly SkillInventoryEntry[]
): SkillUpdateImpactIndex => {
  const profileNamesBySkillId = new Map<string, string[]>();
  for (const profile of profiles) {
    for (const reference of profile.resources.skills) {
      if (reference.enabled === false) continue;
      profileNamesBySkillId.set(reference.libraryId, [
        ...(profileNamesBySkillId.get(reference.libraryId) ?? []),
        profile.manifest.name
      ]);
    }
  }

  const installsByLibraryId = new Map<string, SkillInventoryEntry[]>();
  for (const item of inventory) {
    if (item.status !== "managed" || !item.libraryId) continue;
    installsByLibraryId.set(item.libraryId, [
      ...(installsByLibraryId.get(item.libraryId) ?? []),
      item
    ]);
  }
  return { profileNamesBySkillId, installsByLibraryId };
};

export const skillUpdateImpactFromIndex = (
  id: string,
  index: SkillUpdateImpactIndex
): SkillUpdateImpact => {
  const profileNames = index.profileNamesBySkillId.get(id) ?? [];
  const installs = index.installsByLibraryId.get(id) ?? [];
  const targetIdsFor = (method: "linked" | "copied") =>
    [...new Set(
      installs
        .filter((item) => item.installMethod === method)
        .flatMap((item) => item.foundIn)
    )].sort((left, right) => left.localeCompare(right));

  return {
    profileNames: [...new Set(profileNames)].sort((left, right) => left.localeCompare(right)),
    linkedInstallCount: installs.filter((item) => item.installMethod === "linked").length,
    linkedTargetIds: targetIdsFor("linked"),
    copiedInstallCount: installs.filter((item) => item.installMethod === "copied").length,
    copiedTargetIds: targetIdsFor("copied")
  };
};
