import type { ProfileResources, ProfileSkill, ProfileSkillGroup } from "./schemas";
import type { ResourceIconKey, SkillLibraryEntry, SkillSourceGroupView } from "./types";

export interface AvailableProfileSkillGroup {
  kind: "manual" | "source";
  groupId: string;
  name: string;
  description?: string;
  iconKey?: ResourceIconKey;
  sourceUrl?: string;
  memberIds: string[];
}

const uniqueSorted = (values: Iterable<string>) => [...new Set(values)].sort();

export const profileSkillGroupGateOpen = (
  resources: Pick<ProfileResources, "skillGroups">,
  reference: Pick<ProfileSkill, "groupIds">
) => {
  const groupIds = reference.groupIds ?? [];
  if (groupIds.length === 0) return true;
  const groups = new Map((resources.skillGroups ?? []).map((group) => [group.id, group]));
  return groupIds.every((groupId) => groups.get(groupId)?.enabled !== false);
};

export const profileSkillEnabled = (
  resources: Pick<ProfileResources, "skillGroups">,
  reference: Pick<ProfileSkill, "enabled" | "groupIds">
) => reference.enabled && profileSkillGroupGateOpen(resources, reference);

export const materializeProfileSkillGroups = <T extends ProfileResources>(resources: T): T => ({
  ...resources,
  skills: resources.skills.map((reference) => ({
    ...reference,
    enabled: profileSkillEnabled(resources, reference)
  }))
});

export const profileSkillGroupState = (
  resources: ProfileResources,
  group: ProfileSkillGroup
): "on" | "off" | "mixed" => {
  if (!group.enabled) return "off";
  const members = resources.skills.filter((skill) => (skill.groupIds ?? []).includes(group.id));
  if (members.length === 0 || members.every((skill) => skill.enabled)) return "on";
  if (members.every((skill) => !skill.enabled)) return "off";
  return "mixed";
};

export const setProfileSkillGroupEnabled = (
  resources: ProfileResources,
  groupId: string,
  enabled: boolean
): ProfileResources => ({
  ...resources,
  skillGroups: (resources.skillGroups ?? []).map((group) =>
    group.id === groupId ? { ...group, enabled } : group
  )
});

export const addProfileSkillGroup = (
  resources: ProfileResources,
  available: AvailableProfileSkillGroup,
  librarySkills: readonly SkillLibraryEntry[]
): ProfileResources => {
  if ((resources.skillGroups ?? []).some((group) =>
    group.kind === available.kind && group.groupId === available.groupId
  )) return resources;
  const id = `${available.kind}-${available.groupId}`;
  const libraryById = new Map(librarySkills.map((skill) => [skill.id, skill]));
  const memberIds = uniqueSorted(
    available.memberIds.filter((libraryId) => libraryById.has(libraryId))
  );
  const memberSet = new Set(memberIds);
  const existingIds = new Set(resources.skills.map((skill) => skill.libraryId));
  const nextSkills = resources.skills.map((skill) =>
    memberSet.has(skill.libraryId)
      ? { ...skill, groupIds: uniqueSorted([...(skill.groupIds ?? []), id]) }
      : skill
  );
  for (const libraryId of memberIds) {
    if (existingIds.has(libraryId)) continue;
    const librarySkill = libraryById.get(libraryId)!;
    nextSkills.push({
      libraryId,
      targetName: librarySkill.id,
      enabled: true,
      direct: false,
      groupIds: [id]
    });
  }
  return {
    ...resources,
    skills: nextSkills,
    skillGroups: [
      ...(resources.skillGroups ?? []),
      {
        id,
        kind: available.kind,
        groupId: available.groupId,
        name: available.name,
        iconKey: available.iconKey,
        enabled: true,
        memberIds
      }
    ]
  };
};

export const removeProfileSkillGroup = (
  resources: ProfileResources,
  groupId: string
): ProfileResources => {
  const nextSkills = resources.skills.flatMap((skill) => {
    if (!(skill.groupIds ?? []).includes(groupId)) return [skill];
    const remainingGroupIds = (skill.groupIds ?? []).filter((id) => id !== groupId);
    if (remainingGroupIds.length > 0) return [{ ...skill, groupIds: remainingGroupIds }];
    return skill.direct !== false ? [{ ...skill, groupIds: undefined }] : [];
  });
  return {
    ...resources,
    skills: nextSkills,
    skillGroups: (resources.skillGroups ?? []).filter((group) => group.id !== groupId)
  };
};

export const syncProfileSkillGroup = (
  resources: ProfileResources,
  profileGroupId: string,
  available: AvailableProfileSkillGroup,
  librarySkills: readonly SkillLibraryEntry[]
): ProfileResources => {
  const previous = (resources.skillGroups ?? []).find((group) => group.id === profileGroupId);
  if (!previous) return resources;
  const previousPreferences = new Map(
    resources.skills
      .filter((skill) => (skill.groupIds ?? []).includes(profileGroupId))
      .map((skill) => [skill.libraryId, skill.enabled])
  );
  const without = removeProfileSkillGroup(resources, profileGroupId);
  const restored = addProfileSkillGroup(without, available, librarySkills);
  const generated = restored.skillGroups?.at(-1);
  if (!generated) return resources;
  const generatedId = generated.id;
  return {
    ...restored,
    skills: restored.skills.map((skill) => ({
      ...skill,
      enabled: previousPreferences.get(skill.libraryId) ?? skill.enabled,
      groupIds: (skill.groupIds ?? []).map((id) => id === generatedId ? profileGroupId : id)
    })),
    skillGroups: (restored.skillGroups ?? []).map((group) =>
      group.id === generatedId
        ? { ...group, id: profileGroupId, enabled: previous.enabled }
        : group
    )
  };
};

export const reconcileProfileSkillGroups = (
  resources: ProfileResources,
  availableGroups: readonly AvailableProfileSkillGroup[],
  librarySkills: readonly SkillLibraryEntry[]
): ProfileResources => {
  const availableByKey = new Map(
    availableGroups.map((group) => [`${group.kind}:${group.groupId}`, group])
  );
  return (resources.skillGroups ?? []).reduce((current, group) => {
    const available = availableByKey.get(`${group.kind}:${group.groupId}`);
    return available && profileSkillGroupChanged(group, available)
      ? syncProfileSkillGroup(current, group.id, available, librarySkills)
      : current;
  }, resources);
};

export const manualProfileSkillGroup = (group: {
  id: string;
  name: string;
  description?: string;
  iconKey?: ResourceIconKey;
  skillIds: string[];
}): AvailableProfileSkillGroup => ({
  kind: "manual",
  groupId: group.id,
  name: group.name,
  description: group.description,
  iconKey: group.iconKey,
  memberIds: uniqueSorted(group.skillIds)
});

const sourceRepositoryName = (repository: string) => {
  try {
    const url = new URL(repository);
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (!path) return url.hostname;
    return url.hostname === "github.com" ? path : `${url.hostname}/${path}`;
  } catch {
    const scpPath = repository.includes(":")
      ? repository.slice(repository.indexOf(":") + 1)
      : repository;
    const segments = scpPath.replace(/\.git$/i, "").split(/[\\/]/).filter(Boolean);
    return segments.slice(-2).join("/") || repository;
  }
};

export const sourceProfileSkillGroupName = (group: SkillSourceGroupView) => {
  if (group.displayName?.trim()) return group.displayName.trim();
  const repository = sourceRepositoryName(group.repository);
  const directory = group.directory.replace(/^\/+|\/+$/g, "");
  return directory ? `${repository} · ${directory}` : repository;
};

export const sourceProfileSkillGroup = (
  group: SkillSourceGroupView
): AvailableProfileSkillGroup => ({
  kind: "source",
  groupId: group.sourceId,
  name: sourceProfileSkillGroupName(group),
  description: group.directory || group.repository,
  sourceUrl: group.canonicalLink,
  memberIds: uniqueSorted(
    group.candidates.flatMap((candidate) => candidate.libraryId ? [candidate.libraryId] : [])
  )
});

export const profileSkillGroupChanged = (
  group: ProfileSkillGroup,
  available: AvailableProfileSkillGroup | undefined
) => Boolean(available && (
  group.name !== available.name ||
  group.iconKey !== available.iconKey ||
  JSON.stringify(uniqueSorted(group.memberIds)) !== JSON.stringify(uniqueSorted(available.memberIds))
));
