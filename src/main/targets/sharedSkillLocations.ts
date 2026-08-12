import { join, resolve } from "node:path";
import type {
  SharedSkillLocationId,
  TargetPaths,
  TargetSkillLocation
} from "../../shared/types";

interface SharedSkillLocationDefinition {
  id: SharedSkillLocationId;
  relativePath: readonly string[];
  location: Omit<TargetSkillLocation, "path" | "sharedLocationId">;
}

const SHARED_SKILL_LOCATIONS: Record<
  SharedSkillLocationId,
  SharedSkillLocationDefinition
> = {
  "agents-skills": {
    id: "agents-skills",
    relativePath: [".agents", "skills"],
    location: {
      role: "compatibility-runtime",
      shared: true,
      scope: "shared",
      scanDepth: "recursive",
      management: "shared-runtime"
    }
  }
};

export const resolveSharedSkillLocation = (
  id: SharedSkillLocationId,
  input: {
    homeDir: string;
    pathOverride?: string;
  }
): TargetSkillLocation => {
  const definition = SHARED_SKILL_LOCATIONS[id];
  if (!definition) {
    throw new Error(`Unknown shared Skill location: ${id}`);
  }
  return {
    ...definition.location,
    path: input.pathOverride ?? join(input.homeDir, ...definition.relativePath),
    sharedLocationId: definition.id
  };
};

export const materializeSharedSkillLocations = (
  paths: TargetPaths,
  input: {
    homeDir: string;
    pathOverrides?: Partial<Record<SharedSkillLocationId, string>>;
  }
): TargetPaths => {
  const ids = [...new Set(paths.sharedSkillLocationIds ?? [])];
  if (ids.length === 0) {
    return paths;
  }
  const sharedLocations = ids.map((id) =>
    resolveSharedSkillLocation(id, {
      homeDir: input.homeDir,
      pathOverride: input.pathOverrides?.[id]
    })
  );
  const sharedPaths = new Set(sharedLocations.map((location) => resolve(location.path)));
  if (paths.skillsDir && sharedPaths.has(resolve(paths.skillsDir))) {
    throw new Error(
      `Target ${paths.targetId} cannot use a shared Skill location as its managed Skills directory`
    );
  }
  const targetLocations = (paths.skillLocations ?? []).filter(
    (location) => !sharedPaths.has(resolve(location.path))
  );
  const skillLocations = [...targetLocations, ...sharedLocations];

  return {
    ...paths,
    sharedSkillLocationIds: ids,
    skillLocations,
    skillScanDirs: [...new Set([
      ...(paths.skillScanDirs ?? []).filter((path) => !sharedPaths.has(resolve(path))),
      ...skillLocations.map((location) => location.path)
    ])]
  };
};

export const isManagedSharedSkillLocation = (
  location: TargetSkillLocation | undefined
) =>
  location?.shared === true &&
  location.management === "shared-runtime" &&
  Boolean(location.sharedLocationId);

export const sharedSkillLocationAuthority = (
  location: Pick<
    TargetSkillLocation,
    "role" | "shared" | "sharedLocationId" | "management"
  > | undefined
): number => {
  if (!location) return -1;
  const roleRank: Record<TargetSkillLocation["role"], number> = {
    "preferred-runtime": 4,
    "alternate-runtime": 3,
    "compatibility-runtime": 2,
    "discovery-only": 1
  };
  return (
    (location.shared === false ? 10 : 0) +
    roleRank[location.role] +
    (location.sharedLocationId ? 2 : 0) +
    (location.management === "shared-runtime" ? 1 : 0)
  );
};

export const assertSharedSkillCleanupAuthority = (input: {
  path: string;
  sharedLocation: boolean | undefined;
  mode: "target-copies" | "shared-compatibility" | undefined;
  unavailableLinkCleanup: boolean;
}): void => {
  if (
    input.sharedLocation === true &&
    input.mode !== "shared-compatibility" &&
    !input.unavailableLinkCleanup
  ) {
    throw new Error(
      `Shared Skill locations require a reviewed shared-location operation: ${input.path}`
    );
  }
};
