import { lstat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
  ManagedResourceSnapshot,
  TargetPaths,
  TargetState
} from "../shared/types";
import type {
  TargetStateFile,
  TargetStateRepository
} from "./targetStateRepository";
import { managedResourceOrigin } from "../shared/managedResource";

export const readManagedSkillResourcesByTarget = async (
  targetPaths: readonly TargetPaths[],
  repository: TargetStateRepository
) => new Map(await Promise.all(targetPaths.map(async (target) => {
  const resources = await repository.read(target.targetId)
    .then((file) => file.state.managedResources ?? [])
    .catch(() => []);
  return [
    target.targetId,
    new Map(resources
      .filter((resource) => resource.kind === "skill" && !resource.paused)
      .map((resource) => [resolve(resource.path), resource]))
  ] as const;
})));

export const readTargetStateFiles = async (
  repository: TargetStateRepository,
  targetIds: Iterable<string>
) => new Map(await Promise.all([...new Set(targetIds)].map(async (targetId) =>
  [targetId, await repository.read(targetId)] as const
)));

export const createManagedSkillResource = async (input: {
  id: string;
  path: string;
  libraryId: string;
  contentHash: string;
  origin: "adopted" | "created" | "replaced" | "unknown";
}): Promise<ManagedResourceSnapshot> => ({
  kind: "skill",
  id: input.id,
  path: input.path,
  contentHash: input.contentHash,
  source: `skills-library/${input.libraryId}`,
  materialization: (await lstat(input.path)).isSymbolicLink() ? "link" : "copy",
  origin: input.origin,
  deploymentMode: (await lstat(input.path)).isSymbolicLink() ? "linked" : "copied",
  createdByAgentEnv: input.origin === "created"
});

export const upsertManagedSkillResource = (
  state: TargetState,
  resource: ManagedResourceSnapshot
): TargetState => ({
  ...state,
  managedResources: [
    ...(state.managedResources ?? []).filter(
      (current) => resolve(current.path) !== resolve(resource.path)
    ),
    resource
  ]
});

export const updateMergedSkillTargetStates = async (input: {
  repository: TargetStateRepository;
  stateFiles: ReadonlyMap<string, TargetStateFile>;
  installs: readonly { path: string; foundIn: string[] }[];
  removedIds: readonly string[];
  keepId: string;
  contentHash: string;
  recordMutation(path: string): Promise<void>;
}) => {
  const removedIds = new Set(input.removedIds);
  for (const [targetId, stateFile] of input.stateFiles) {
    const installPaths = new Set(input.installs
      .filter((install) => install.foundIn[0] === targetId)
      .map((install) => resolve(install.path)));
    const appliedSkills = { ...(stateFile.state.appliedLibraryVersions?.skills ?? {}) };
    const managedRemovedVersion = input.removedIds.some((id) => id in appliedSkills);
    for (const removedId of input.removedIds) delete appliedSkills[removedId];
    if (managedRemovedVersion) appliedSkills[input.keepId] = input.contentHash;
    const managedResources = await Promise.all(
      (stateFile.state.managedResources ?? []).map(async (resource) =>
        resource.kind === "skill" && installPaths.has(resolve(resource.path))
          ? {
              ...resource,
              id: basename(resource.path),
              contentHash: input.contentHash,
              source: `skills-library/${input.keepId}`,
              materialization: (await lstat(resource.path)).isSymbolicLink()
                ? "link" as const
                : "copy" as const,
              origin: managedResourceOrigin(resource),
              deploymentMode: (await lstat(resource.path)).isSymbolicLink()
                ? "linked" as const
                : "copied" as const,
              createdByAgentEnv: managedResourceOrigin(resource) === "created"
            }
          : resource
      )
    );
    await input.repository.write(targetId, {
      ...stateFile.state,
      appliedLibraryVersions: stateFile.state.appliedLibraryVersions
        ? { ...stateFile.state.appliedLibraryVersions, skills: appliedSkills }
        : undefined,
      managedResources,
      skillReceipts: (stateFile.state.skillReceipts ?? []).map((receipt) =>
        removedIds.has(receipt.libraryId)
          ? { ...receipt, libraryId: input.keepId, contentHash: input.contentHash }
          : receipt
      )
    }, { expectedPathHash: stateFile.pathHash });
    await input.recordMutation(stateFile.path);
  }
};

export const updateConsolidatedSkillTargetStates = async (input: {
  repository: TargetStateRepository;
  stateFiles: ReadonlyMap<string, TargetStateFile>;
  locations: readonly { targetDir: string; targetPaths: TargetPaths }[];
  libraryId: string;
  computeContentHash(path: string): Promise<string>;
  originsByPath?: ReadonlyMap<string, "adopted" | "created" | "replaced" | "unknown">;
  recordMutation(path: string): Promise<void>;
}) => {
  for (const [targetId, stateFile] of input.stateFiles) {
    const targetLocations = input.locations.filter(
      (location) => location.targetPaths.targetId === targetId
    );
    let nextState = stateFile.state;
    for (const location of targetLocations) {
      nextState = upsertManagedSkillResource(nextState, await createManagedSkillResource({
        id: basename(location.targetDir),
        path: location.targetDir,
        libraryId: input.libraryId,
        contentHash: await input.computeContentHash(location.targetDir),
        origin: input.originsByPath?.get(resolve(location.targetDir)) ?? "unknown"
      }));
    }
    await input.repository.write(targetId, nextState, { expectedPathHash: stateFile.pathHash });
    await input.recordMutation(stateFile.path);
  }
};
