import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { profileManagesResource } from "../../../shared/profileResources";
import { pathEntryExists, pathExists } from "../../fileUtils";
import { isAgentEnvOwnedDir, markerPathForFile } from "../../ownershipMarkers";
import { removeSkillDeployment } from "../../skillDeployment";
import {
  addSkillRefBackupPaths,
  applySkillRefs,
  skillTargetNames,
  validateSkillRefs
} from "../skillRefs";
import type { TargetAssetDriver } from "../contract";
import type { TargetAssetInput } from "../types";
import { isPathInside, pathsEqual } from "../../platformPaths";

const isOwnedTargetSkill = async (path: string, input: TargetAssetInput) =>
  input.managedResources?.some(
    (resource) =>
      resource.kind === "skill" &&
      !resource.paused &&
      resolve(resource.path) === resolve(path)
  ) === true ||
  isAgentEnvOwnedDir(path, {
    targetId: input.targetPaths.targetId,
    kind: "skill"
  });

const managesSkills = (input: TargetAssetInput) =>
  profileManagesResource(input.profile.resources, input.targetPaths.targetId, "skills");

const isWithin = (parent: string, child: string) =>
  pathsEqual(parent, child) || isPathInside(parent, child);

const missingManagedSkillDirectories = async (input: TargetAssetInput) => {
  const skillsDir = input.targetPaths.skillsDir;
  if (!skillsDir) return [];
  const containers = [
    input.targetPaths.configDir,
    dirname(input.targetPaths.instructionsPath)
  ].filter(Boolean);
  const missing: string[] = [];
  let candidate = resolve(skillsDir);
  while (
    containers.some((container) => isWithin(container, candidate)) &&
    !(await pathEntryExists(candidate))
  ) {
    missing.push(candidate);
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return missing;
};

const staleOwnedSkillPaths = async (input: TargetAssetInput) => {
  const root = input.targetPaths.skillsDir;
  if (!root || input.isolateSkillRoot || !(await pathExists(root))) return [];
  const desired = skillTargetNames(input);
  const stale: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (desired.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (await isOwnedTargetSkill(path, input)) stale.push(path);
  }
  return stale;
};

export const createDirectoryAssetDriver = (
  _options: { targetName: string; markerTargetId?: (input: TargetAssetInput) => string }
): TargetAssetDriver => ({
  validateAssets: (input) => managesSkills(input) ? validateSkillRefs(input) : Promise.resolve([]),
  getAssetBackupPaths: async (input) => {
    if (!managesSkills(input)) return [];
    const paths = new Set<string>();
    for (const missingPath of await missingManagedSkillDirectories(input)) {
      paths.add(missingPath);
    }
    addSkillRefBackupPaths(paths, input.targetPaths, input);
    for (const stalePath of await staleOwnedSkillPaths(input)) {
      paths.add(stalePath);
      paths.add(markerPathForFile(stalePath));
    }
    return [...paths];
  },
  applyAssets: async (input) => {
    if (!managesSkills(input)) return;
    const missingDirectories = skillTargetNames(input).size > 0
      ? await missingManagedSkillDirectories(input)
      : [];
    for (const directory of missingDirectories) {
      await input.claimMutationPath?.(directory);
    }
    const usesApprovedPreviewRemovals = Boolean(input.plannedResourceRemovals);
    const stalePaths = input.plannedResourceRemovals
      ? [...input.plannedResourceRemovals]
      : await staleOwnedSkillPaths(input);
    for (const stalePath of stalePaths) {
      await input.claimMutationPath?.(stalePath);
      await input.claimMutationPath?.(markerPathForFile(stalePath));
      await removeSkillDeployment(stalePath, {
        allowedRoot: input.targetPaths.skillsDir!,
        ...(!usesApprovedPreviewRemovals
          ? {
              expectedOwnership: {
                targetId: input.targetPaths.targetId,
                kind: "skill" as const
              }
            }
          : {})
      });
      await input.claimMutationPath?.recordMutation?.(
        stalePath,
        markerPathForFile(stalePath)
      );
    }
    await applySkillRefs(input);
    await input.claimMutationPath?.recordMutation?.(...missingDirectories);
  }
});
