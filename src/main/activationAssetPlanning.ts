import { lstat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
  ManagedResourceKind,
  ManagedResourceSnapshot,
  PlannedResourceChange,
  ProfileDetail,
  TargetPaths
} from "../shared/types";
import { profileManagesResource } from "../shared/profileResources";
import { hashComparablePath } from "./activationProfileSupport";
import { pathEntryExists } from "./fileUtils";
import { hashManagedResourcePath, hashPath } from "./managedResourceHashes";
import {
  legacyOwnerMarkerPathsFor,
  markerPathForFile
} from "./ownershipMarkers";
import { isPathInside } from "./platformPaths";
import type { SkillRootTransition } from "./skillRootTopology";
import {
  managedResourceMaterialization,
  managedResourceOrigin
} from "../shared/managedResource";

export const resourceKindForPath = (
  path: string,
  targetPaths: TargetPaths
): { kind: ManagedResourceKind; id: string } => {
  if (path === targetPaths.instructionsPath) return { kind: "instructions", id: "instructions" };
  if (path === targetPaths.configPath || path === targetPaths.mcpConfigPath) {
    return { kind: "config", id: "config" };
  }
  if (path.endsWith(".agentenv-owner.json")) return { kind: "file", id: basename(path) };
  if (
    [targetPaths.skillsDir, ...(targetPaths.skillLocations ?? []).map((location) => location.path)]
      .filter((skillsRoot): skillsRoot is string => Boolean(skillsRoot))
      .some((skillsRoot) => isPathInside(skillsRoot, path))
  ) {
    return { kind: "skill", id: basename(path) };
  }
  if (targetPaths.agentsDir && isPathInside(targetPaths.agentsDir, path)) {
    return { kind: "agent", id: basename(path) };
  }
  return { kind: "file", id: basename(path) || path };
};

export const snapshotManagedResources = async (
  pathsToSnapshot: string[],
  targetPaths: TargetPaths,
  options: {
    sourceByPath?: ReadonlyMap<string, string>;
    previousResources?: readonly ManagedResourceSnapshot[];
    mutatedPaths?: ReadonlySet<string>;
    createdPaths?: ReadonlySet<string>;
    replacedPaths?: ReadonlySet<string>;
    adoptedPaths?: ReadonlySet<string>;
    legacyOwnedPaths?: ReadonlySet<string>;
  } = {}
) => {
  const snapshots: ManagedResourceSnapshot[] = [];
  for (const path of [...new Set(pathsToSnapshot)]) {
    if (path.endsWith(".agentenv-owner.json")) continue;
    const identity = resourceKindForPath(path, targetPaths);
    if (identity.kind === "config") continue;
    const contentHash = await hashManagedResourcePath(path, identity.kind);
    if (!contentHash) continue;
    const previous = options.previousResources?.find(
      (resource) => resolve(resource.path) === resolve(path)
    );
    const stats = await lstat(path).catch(() => undefined);
    const mutated = options.mutatedPaths?.has(resolve(path)) === true;
    const created = options.createdPaths?.has(resolve(path)) === true;
    const replaced = options.replacedPaths?.has(resolve(path)) === true;
    const adopted = options.adoptedPaths?.has(resolve(path)) === true;
    const legacyOwned = options.legacyOwnedPaths?.has(resolve(path)) === true;
    const materialization = stats?.isSymbolicLink() ? "link" as const : "copy" as const;
    const origin = adopted
      ? "adopted" as const
      : previous
        ? managedResourceOrigin(previous)
        : created
          ? "created" as const
          : replaced || mutated || legacyOwned
            ? "replaced" as const
            : "unknown" as const;
    snapshots.push({
      ...identity,
      path,
      contentHash,
      source: options.sourceByPath?.get(resolve(path)) ?? previous?.source ?? "profile-apply",
      materialization,
      origin,
      deploymentMode: materialization === "link"
        ? "linked"
        : origin === "adopted"
          ? "adopted"
          : "copied",
      createdByAgentEnv: origin === "created"
    });
  }
  return snapshots.sort((left, right) => left.path.localeCompare(right.path));
};

export const desiredAssetResources = (
  profile: ProfileDetail,
  targetPaths: TargetPaths,
  skillLibraryDir: string
) => {
  const desired = new Map<string, {
    resource: Omit<PlannedResourceChange, "action" | "path">;
    sourcePath: string;
    markerSource: string;
  }>();
  if (!profileManagesResource(profile.resources, targetPaths.targetId, "skills")) return desired;
  for (const skillRef of profile.resources.skills.filter((reference) => reference.enabled)) {
    if (!targetPaths.skillsDir) continue;
    desired.set(join(targetPaths.skillsDir, skillRef.targetName), {
      resource: {
        kind: "skill",
        name: skillRef.targetName,
        source: `Library / ${skillRef.libraryId}`
      },
      sourcePath: join(skillLibraryDir, skillRef.libraryId),
      markerSource: `skills-library/${skillRef.libraryId}`
    });
  }
  return desired;
};

export const planAssetResources = async (input: {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  assetPaths: string[];
  skillLibraryDir: string;
  topologyOnlyPaths: ReadonlySet<string>;
  skillRootTransition?: SkillRootTransition;
  managedResources?: readonly ManagedResourceSnapshot[];
  skillSyncMethod: "symlink" | "copy" | "auto";
}) => {
  const {
    profile,
    targetPaths,
    assetPaths,
    skillLibraryDir,
    topologyOnlyPaths,
    skillRootTransition,
    managedResources = [],
    skillSyncMethod
  } = input;
  if (!profileManagesResource(profile.resources, targetPaths.targetId, "skills")) {
    return {
      resourceChanges: [] as PlannedResourceChange[],
      resourceFingerprints: {} as Record<string, string>,
      sourceFingerprints: {} as Record<string, string>,
      legacyOwnershipMarkerPaths: [] as string[],
      adoptedResourcePaths: [] as string[],
      legacyOwnedResourcePaths: [] as string[]
    };
  }
  const desired = desiredAssetResources(profile, targetPaths, skillLibraryDir);
  const resourceChanges: PlannedResourceChange[] = skillRootTransition
    ? [{
        kind: "directory",
        action: "replace",
        name: "Skills folder",
        path: skillRootTransition.path,
        source: `Linked to ${skillRootTransition.resolvedPath}`
      }]
    : [];
  const resourceFingerprints: Record<string, string> = {};
  const sourceFingerprints: Record<string, string> = {};
  const legacyOwnershipMarkerPaths: string[] = [];
  const adoptedResourcePaths: string[] = [];
  const legacyOwnedResourcePaths: string[] = [];

  await Promise.all([...desired.values()].map(async ({ sourcePath }) => {
    sourceFingerprints[sourcePath] = (await hashComparablePath(sourcePath)) ?? "";
  }));
  if (skillRootTransition) {
    resourceFingerprints[skillRootTransition.path] = (await hashPath(skillRootTransition.path)) ?? "";
  }

  for (const path of [...new Set([...assetPaths, ...desired.keys()])]) {
    const behindTransitionedRoot = Boolean(
      skillRootTransition && dirname(path) === skillRootTransition.path
    );
    if (!behindTransitionedRoot && !topologyOnlyPaths.has(resolve(path))) {
      resourceFingerprints[path] = (await hashPath(path)) ?? "";
    }
    if (skillRootTransition && path === skillRootTransition.path) continue;
    const resource = desired.get(path);
    if (resource) {
      const exists = !behindTransitionedRoot && await pathEntryExists(path);
      const stats = exists ? await lstat(path) : undefined;
      const contentMatches = exists &&
        (await hashComparablePath(resource.sourcePath)) === (await hashComparablePath(path));
      const matchingMarkerPaths = exists
        ? await legacyOwnerMarkerPathsFor(path, {
            targetId: targetPaths.targetId,
            kind: resource.resource.kind === "agent" ? "agent" : "skill"
          })
        : [];
      if (contentMatches) {
        if (matchingMarkerPaths.length > 0) {
          legacyOwnershipMarkerPaths.push(...matchingMarkerPaths);
          legacyOwnedResourcePaths.push(path);
          continue;
        }
        const shouldBeLinked = skillSyncMethod === "symlink";
        const topologyMatchesPolicy = shouldBeLinked
          ? stats?.isSymbolicLink() === true
          : stats?.isSymbolicLink() !== true;
        if (!topologyMatchesPolicy) {
          resourceChanges.push({
            ...resource.resource,
            path,
            action: "replace"
          });
          continue;
        }
        const previous = managedResources.find(
          (item) => item.kind === "skill" && resolve(item.path) === resolve(path)
        );
        const topologyMatches = previous && (stats?.isSymbolicLink()
          ? managedResourceMaterialization(previous) === "link"
          : managedResourceMaterialization(previous) === "copy");
        if (!topologyMatches) adoptedResourcePaths.push(path);
        continue;
      }
      resourceChanges.push({
        ...resource.resource,
        path,
        action: exists ? "replace" : "install"
      });
      continue;
    }
    if (path.endsWith(".agentenv-owner.json")) continue;
    const stats = await pathEntryExists(path) ? await lstat(path) : undefined;
    if (!stats) continue;
    const identity = resourceKindForPath(path, targetPaths);
    resourceChanges.push({
      kind: identity.kind === "skill" || identity.kind === "agent"
        ? identity.kind
        : stats.isDirectory() ? "directory" : "file",
      action: "remove",
      name: identity.id,
      path
    });
  }

  return {
    resourceChanges: resourceChanges.sort((left, right) => left.path.localeCompare(right.path)),
    resourceFingerprints,
    sourceFingerprints,
    legacyOwnershipMarkerPaths: [...new Set(legacyOwnershipMarkerPaths)].sort(),
    adoptedResourcePaths: [...new Set(adoptedResourcePaths)].sort(),
    legacyOwnedResourcePaths: [...new Set(legacyOwnedResourcePaths)].sort()
  };
};
