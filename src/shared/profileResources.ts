import type {
  ProfileResourceMode,
  ProfileResources,
  ProfileTargetResourcePolicy
} from "./schemas";
import type { ProfileDetail } from "./types";
import { profileEffectiveInstructions } from "./profileInstructions";
import { materializeProfileSkillGroups } from "./profileSkillGroups";

export type ManagedProfileResource = "instructions" | "skills" | "mcp";

const DEFAULT_TARGET_POLICY: ProfileTargetResourcePolicy = {
  instructions: "manage",
  skills: "manage"
};

export const profileResourceMode = (
  resources: ProfileResources,
  targetId: string,
  resource: ManagedProfileResource
): ProfileResourceMode => {
  if (resource === "mcp") {
    return resources.mcpByTarget[targetId]?.mode ?? "ignore";
  }
  return resources.managementByTarget?.[targetId]?.[resource] ??
    DEFAULT_TARGET_POLICY[resource];
};

export const profileManagesResource = (
  resources: ProfileResources,
  targetId: string,
  resource: ManagedProfileResource
) => profileResourceMode(resources, targetId, resource) !== "ignore";

export const profileUsesResource = (
  resources: ProfileResources,
  targetId: string,
  resource: ManagedProfileResource
) => profileResourceMode(resources, targetId, resource) === "manage";

export const profileDisablesResource = (
  resources: ProfileResources,
  targetId: string,
  resource: ManagedProfileResource
) => profileResourceMode(resources, targetId, resource) === "disable";

export const setProfileResourceMode = (
  resources: ProfileResources,
  targetId: string,
  resource: ManagedProfileResource,
  mode: ProfileResourceMode
): ProfileResources => {
  if (resource === "mcp") {
    const current = resources.mcpByTarget[targetId] ?? { mode: "ignore", selections: [] };
    return {
      ...resources,
      mcpByTarget: {
        ...resources.mcpByTarget,
        [targetId]: { ...current, mode }
      }
    };
  }
  const current = resources.managementByTarget?.[targetId] ?? DEFAULT_TARGET_POLICY;
  return {
    ...resources,
    managementByTarget: {
      ...resources.managementByTarget,
      [targetId]: { ...current, [resource]: mode }
    }
  };
};

export const materializeTargetResourcePolicy = (
  profile: ProfileDetail,
  targetId: string
): ProfileDetail => {
  const instructionsDisabled = profileDisablesResource(
    profile.resources,
    targetId,
    "instructions"
  );
  const skillsDisabled = profileDisablesResource(
    profile.resources,
    targetId,
    "skills"
  );
  const mcpDisabled = profileDisablesResource(profile.resources, targetId, "mcp");
  const effectiveInstructions = instructionsDisabled ? "" : profileEffectiveInstructions(profile);
  const groupMaterializedResources = materializeProfileSkillGroups(profile.resources);
  const groupsChangeSkillState = groupMaterializedResources.skills.some(
    (reference, index) => reference.enabled !== profile.resources.skills[index]?.enabled
  );
  if (
    !instructionsDisabled &&
    !skillsDisabled &&
    !mcpDisabled &&
    !groupsChangeSkillState &&
    profile.instructions === effectiveInstructions
  ) return profile;

  const mcpPolicy = profile.resources.mcpByTarget[targetId];
  return {
    ...profile,
    instructions: effectiveInstructions,
    resolvedInstructions: effectiveInstructions,
    resources: {
      ...profile.resources,
      skills: skillsDisabled
        ? groupMaterializedResources.skills.map((reference) => ({
            ...reference,
            enabled: false
          }))
        : groupMaterializedResources.skills,
      mcpByTarget:
        mcpDisabled && mcpPolicy
          ? {
              ...profile.resources.mcpByTarget,
              [targetId]: {
                mode: "manage",
                selections: mcpPolicy.selections.map((selection) => ({
                  ...selection,
                  enabled: false
                }))
              }
            }
          : profile.resources.mcpByTarget
    }
  };
};
