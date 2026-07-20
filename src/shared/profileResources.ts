import type {
  ProfileResourceMode,
  ProfileResources,
  ProfileTargetResourcePolicy
} from "./schemas";

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
) => profileResourceMode(resources, targetId, resource) === "manage";

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
