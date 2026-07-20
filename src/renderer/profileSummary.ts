import type {
  ProfileDetail,
  ProfileSummary,
  SkillLibraryEntry,
  TargetDescriptor,
  TargetInfo,
  TargetManagementState
} from "../shared/types";
import { isTargetInstalled } from "../shared/targetHealth";
import { profileManagesResource } from "../shared/profileResources";

export interface ProfileResourceSummary {
  instructions: { count: 0 | 1; total: 0 | 1; managed: boolean };
  skills: { count: number; total: number; names: string[]; managed: boolean };
  mcp: { count: number; total: number; names: string[]; managed: boolean };
}

export interface RecentProfileApplication {
  state: TargetManagementState;
  target?: TargetInfo;
}

export const compareProfilesByCreationTime = (
  left: Pick<ProfileSummary, "id" | "name" | "createdAt">,
  right: Pick<ProfileSummary, "id" | "name" | "createdAt">
) => {
  const leftTime = Date.parse(left.createdAt ?? "");
  const rightTime = Date.parse(right.createdAt ?? "");
  const timeDifference =
    (Number.isFinite(rightTime) ? rightTime : 0) -
    (Number.isFinite(leftTime) ? leftTime : 0);
  return timeDifference || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
};

export const listProfileApplications = (
  profileId: string,
  targetStates: readonly TargetManagementState[],
  targets: readonly TargetInfo[]
): RecentProfileApplication[] =>
  targetStates
    .filter((state) => state.activeProfileId === profileId)
    .map((state) => ({
      state,
      target: targets.find((target) => target.id === state.targetId)
    }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.state.lastAppliedAt ?? "");
      const rightTime = Date.parse(right.state.lastAppliedAt ?? "");
      if (Number.isFinite(leftTime) || Number.isFinite(rightTime)) {
        return (Number.isFinite(rightTime) ? rightTime : 0) -
          (Number.isFinite(leftTime) ? leftTime : 0);
      }
      return (left.target?.name ?? left.state.targetId).localeCompare(
        right.target?.name ?? right.state.targetId
      );
    });

export const preferredTargetForProfile = (
  profileId: string,
  preferredTargetId: string | undefined,
  targetStates: readonly TargetManagementState[],
  targets: readonly TargetInfo[],
  rememberedTargetId?: string
): string | undefined => {
  const availableTargetIds = new Set(targets.map((target) => target.id));
  if (rememberedTargetId && availableTargetIds.has(rememberedTargetId)) {
    return rememberedTargetId;
  }

  const activeTargetId = listProfileApplications(profileId, targetStates, targets)[0]?.state.targetId;
  if (activeTargetId && availableTargetIds.has(activeTargetId)) {
    return activeTargetId;
  }

  if (preferredTargetId && availableTargetIds.has(preferredTargetId)) {
    return preferredTargetId;
  }

  return targets.find((target) => isTargetInstalled(target.health))?.id ?? targets[0]?.id;
};

const unique = (names: readonly string[]): string[] => [...new Set(names)];

type ProfileTargetSchema = Pick<TargetDescriptor, "id">;

export const summarizeProfile = (
  profile: Pick<ProfileDetail, "instructions" | "resources">,
  target: ProfileTargetSchema,
  librarySkills: readonly Pick<SkillLibraryEntry, "id" | "globallyEnabled">[] = []
): ProfileResourceSummary => {
  const globallyDisabledIds = new Set(
    librarySkills.filter((skill) => skill.globallyEnabled === false).map((skill) => skill.id)
  );
  const skillNames = unique(
    profile.resources.skills
      .filter(
        (skill) => skill.enabled !== false && !globallyDisabledIds.has(skill.libraryId)
      )
      .map((skill) => skill.targetName)
  );
  const allSkillNames = unique(profile.resources.skills.map((skill) => skill.targetName));
  const mcpPolicy = profile.resources.mcpByTarget[target.id];
  const mcpNames = unique(
    mcpPolicy?.selections
      .filter((selection) => selection.enabled)
      .map((selection) => selection.name) ?? []
  );
  const allMcpNames = unique(mcpPolicy?.selections.map((selection) => selection.name) ?? []);
  const hasInstructions = profile.instructions.trim().length > 0;

  return {
    instructions: {
      count: hasInstructions ? 1 : 0,
      total: hasInstructions ? 1 : 0,
      managed: profileManagesResource(profile.resources, target.id, "instructions")
    },
    skills: {
      count: skillNames.length,
      total: allSkillNames.length,
      names: skillNames,
      managed: profileManagesResource(profile.resources, target.id, "skills")
    },
    mcp: {
      count: mcpNames.length,
      total: allMcpNames.length,
      names: mcpNames,
      managed: profileManagesResource(profile.resources, target.id, "mcp")
    }
  };
};

export const findRecentProfileApplication = (
  profileId: string,
  targetStates: readonly TargetManagementState[],
  targets: readonly TargetInfo[]
): RecentProfileApplication | undefined => {
  return listProfileApplications(profileId, targetStates, targets).find(
    (application) => Number.isFinite(Date.parse(application.state.lastAppliedAt ?? ""))
  );
};
