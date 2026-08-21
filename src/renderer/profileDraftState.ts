import type {
  ProfileDetail,
  ProfileResources,
  SaveProfileInput
} from "../shared/types";

export const emptyProfileResources: ProfileResources = {
  instructions: [],
  skills: [],
  managementByTarget: {},
  mcpByTarget: {}
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
};

export const profileSaveInput = (profile: ProfileDetail): SaveProfileInput => ({
  manifest: profile.manifest,
  instructions: profile.instructions,
  resources: profile.resources,
  expectedContentHash: profile.contentHash
});

const normalizeResources = (resources: ProfileResources): ProfileResources => {
  const managementByTarget = Object.fromEntries(
    Object.entries(resources.managementByTarget ?? {}).filter(
      ([, policy]) =>
        policy.instructions !== "manage" || policy.skills !== "manage"
    )
  );
  const mcpByTarget = Object.fromEntries(
    Object.entries(resources.mcpByTarget).filter(
      ([, policy]) => policy.mode !== "ignore" || policy.selections.length > 0
    )
  );
  return {
    ...(resources.instructions ? { instructions: resources.instructions } : {}),
    skills: resources.skills,
    ...(resources.skillGroups?.length
      ? { skillGroups: resources.skillGroups }
      : {}),
    ...(Object.keys(managementByTarget).length > 0
      ? { managementByTarget }
      : {}),
    mcpByTarget
  };
};

const comparableProfileInput = (profile: ProfileDetail): SaveProfileInput => ({
  ...profileSaveInput(profile),
  resources: normalizeResources(profile.resources)
});

export const profileDraftsEqual = (
  left: ProfileDetail | undefined,
  right: ProfileDetail | undefined
) => {
  if (!left || !right || left.id !== right.id) {
    return left === right;
  }
  return JSON.stringify(canonicalize(comparableProfileInput(left))) ===
    JSON.stringify(canonicalize(comparableProfileInput(right)));
};
