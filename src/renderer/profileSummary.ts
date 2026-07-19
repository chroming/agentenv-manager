import type {
  ProfileDetail,
  ProfileSummary,
  SkillLibraryEntry,
  TargetDescriptor,
  TargetInfo,
  TargetManagementState
} from "../shared/types";
import { isTargetInstalled } from "../shared/targetHealth";

export interface ProfileResourceSummary {
  instructions: { count: 0 | 1 };
  skills: { count: number; names: string[] };
  mcp: { count: number; names: string[] };
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
  nativeTargetId: string,
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

  if (availableTargetIds.has(nativeTargetId)) {
    return nativeTargetId;
  }

  return targets.find((target) => isTargetInstalled(target.health))?.id ?? targets[0]?.id;
};

const unique = (names: readonly string[]): string[] => [...new Set(names)];

type ProfileTargetSchema = Pick<TargetDescriptor, "id" | "configLanguage" | "mcpConfigKey">;

export const summarizeProfile = (
  profile: Pick<ProfileDetail, "manifest" | "instructions" | "configText" | "assetPolicy">,
  target: ProfileTargetSchema,
  librarySkills: readonly Pick<SkillLibraryEntry, "id" | "globallyEnabled">[] = []
): ProfileResourceSummary => {
  const globallyDisabledIds = new Set(
    librarySkills.filter((skill) => skill.globallyEnabled === false).map((skill) => skill.id)
  );
  const profileOwnedSkills = [...profile.assetPolicy.ownedDirs, ...profile.assetPolicy.ownedFiles]
    .filter((asset) => asset.kind === "skill")
    .map((asset) => asset.targetName);
  const skillNames = unique([
    ...profileOwnedSkills,
    ...profile.assetPolicy.skillRefs
      .filter(
        (skill) => skill.enabled !== false && !globallyDisabledIds.has(skill.libraryId)
      )
      .map((skill) => skill.targetName)
  ]);
  const mcpNames = unique([
    ...(profile.assetPolicy.mcpSelections ?? [])
      .filter((selection) => selection.targetId === target.id)
      .map((selection) => selection.name),
    ...profile.assetPolicy.mcpRefs.map((server) => server.targetName)
  ]);

  return {
    instructions: {
      count:
        profile.manifest.managed.instructions && profile.instructions.trim().length > 0 ? 1 : 0
    },
    skills: { count: skillNames.length, names: skillNames },
    mcp: { count: mcpNames.length, names: mcpNames }
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
