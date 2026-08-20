import type {
  ProfileDetail,
  ProfileSummary,
  SkillLibraryEntry,
  TargetDescriptor,
  TargetInfo,
  TargetManagementState
} from "../shared/types";

export const reconcileProfileUsage = (
  current: Record<string, string[]>,
  previousReferencedIds: readonly string[],
  nextReferencedIds: readonly string[],
  previousName: string,
  nextName: string
) => {
  const next = Object.fromEntries(
    Object.entries(current).map(([id, names]) => [id, [...names]])
  );
  const previousIds = previousReferencedIds.length > 0
    ? previousReferencedIds
    : Object.entries(current)
        .filter(([, names]) => names.includes(previousName))
        .map(([id]) => id);
  for (const id of new Set(previousIds)) {
    const names = next[id] ?? [];
    const previousIndex = names.indexOf(previousName);
    if (previousIndex >= 0) names.splice(previousIndex, 1);
    if (names.length === 0) delete next[id];
  }
  for (const id of new Set(nextReferencedIds)) {
    next[id] = [...(next[id] ?? []), nextName];
  }
  return next;
};
import { isTargetInstalled } from "../shared/targetHealth";
import { profileResourceMode } from "../shared/profileResources";
import type { ProfileResourceMode } from "../shared/types";

export interface ProfileResourceSummary {
  instructions: { count: number; total: number; mode: ProfileResourceMode };
  skills: { count: number; total: number; names: string[]; mode: ProfileResourceMode };
  mcp: { count: number; total: number; names: string[]; mode: ProfileResourceMode };
}

export interface RecentProfileApplication {
  state: TargetManagementState;
  target?: TargetInfo;
}

export type ProfileDeploymentState = "attention" | "current" | "pending" | "empty";

export interface ProfileApplicationStatus {
  name: string;
  state: Exclude<ProfileDeploymentState, "empty">;
}

export interface ProfileDeploymentSummary {
  applications: RecentProfileApplication[];
  items: ProfileApplicationStatus[];
  state: ProfileDeploymentState;
}

export const profileDeploymentStatusLabels = {
  attention: "Attention",
  current: "Active",
  pending: "Pending",
  empty: "Not applied"
} as const;

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

export const summarizeProfileApplications = (
  profileId: string,
  targetStates: readonly TargetManagementState[],
  targets: readonly TargetInfo[]
): ProfileDeploymentSummary => {
  const applications = listProfileApplications(profileId, targetStates, targets);
  const items = applications.map((application) => {
    const needsAttention =
      application.state.lifecycleStatus === "drifted" ||
      application.state.lifecycleStatus === "recovery-required" ||
      (application.state.errorCount ?? 0) > 0;
    const isCurrent =
      !needsAttention &&
      (
        application.state.lifecycleStatus === "applied" ||
        application.state.lifecycleStatus === "applied-with-local-override"
      );
    return {
      name: application.target?.name ?? application.state.targetId,
      state: needsAttention ? "attention" : isCurrent ? "current" : "pending"
    } as const;
  });
  const state: ProfileDeploymentState = items.length === 0
    ? "empty"
    : items.some((application) => application.state === "attention")
      ? "attention"
      : items.every((application) => application.state === "current")
        ? "current"
        : "pending";
  return { applications, items, state };
};

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
  const hasInlineInstructions = profile.instructions.trim().length > 0;
  const instructionReferences = profile.resources.instructions ?? [];
  const enabledInstructionCount = instructionReferences.filter((reference) => reference.enabled).length +
    Number(hasInlineInstructions);
  const totalInstructionCount = instructionReferences.length + Number(hasInlineInstructions);
  const instructionsMode = profileResourceMode(
    profile.resources,
    target.id,
    "instructions"
  );
  const skillsMode = profileResourceMode(profile.resources, target.id, "skills");
  const mcpMode = profileResourceMode(profile.resources, target.id, "mcp");

  return {
    instructions: {
      count: instructionsMode === "disable" ? 0 : enabledInstructionCount,
      total: totalInstructionCount,
      mode: instructionsMode
    },
    skills: {
      count: skillsMode === "disable" ? 0 : skillNames.length,
      total: allSkillNames.length,
      names: skillNames,
      mode: skillsMode
    },
    mcp: {
      count: mcpMode === "disable" ? 0 : mcpNames.length,
      total: allMcpNames.length,
      names: mcpNames,
      mode: mcpMode
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
