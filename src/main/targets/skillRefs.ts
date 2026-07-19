import { join } from "node:path";
import type { TargetPaths } from "../../shared/types";
import { pathEntryExists, pathExists } from "../fileUtils";
import { hashComparableResource } from "../resourceHash";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir
} from "../ownershipMarkers";
import { deploySkillDirectory } from "../skillDeployment";
import type { TargetAssetInput } from "./types";

const librarySourceFor = (skillLibraryDir: string, libraryId: string) =>
  join(skillLibraryDir, libraryId);

const isOwnedSkillDir = async (targetDir: string, targetPaths: TargetPaths) =>
  isAgentEnvOwnedDir(targetDir, {
    targetId: targetPaths.targetId,
    kind: "skill"
  });

const contentMatches = async (sourceDir: string, targetDir: string) =>
  (await pathExists(sourceDir)) &&
  (await pathExists(targetDir)) &&
  (await hashComparableResource(sourceDir)) ===
    (await hashComparableResource(targetDir));

export const skillTargetNames = ({ profile }: TargetAssetInput) =>
  new Set(
    profile.resources.skills
      .filter((skill) => skill.enabled)
      .map((skill) => skill.targetName)
  );

export const validateSkillRefs = async ({
  profile,
  targetPaths,
  skillLibraryDir,
  allowMatchingUnmanagedSkills,
  replaceablePaths,
  isolateSkillRoot
}: TargetAssetInput) => {
  const errors: string[] = [];
  const skillRefs = profile.resources.skills;
  if (skillRefs.length === 0) return errors;
  if (!targetPaths.skillsDir) {
    return skillRefs.some((skill) => skill.enabled)
      ? ["Agent does not expose a Skills directory"]
      : [];
  }
  if (!skillLibraryDir) {
    return ["Skill Library directory is required for Profile Skills"];
  }

  for (const skillRef of skillRefs) {
    const sourceDir = librarySourceFor(skillLibraryDir, skillRef.libraryId);
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);
    const targetExists = !isolateSkillRoot && await pathEntryExists(targetDir);
    const owned = targetExists && await isOwnedSkillDir(targetDir, targetPaths);
    if (!skillRef.enabled) {
      if (targetExists && !owned) {
        errors.push(
          `Cannot turn off Skill ${skillRef.targetName} because the active copy is outside AgentEnv ownership: ${targetDir}`
        );
      }
      continue;
    }

    if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
      errors.push(`Library Skill does not exist: ${sourceDir}`);
      continue;
    }
    const matchingUnmanaged =
      targetExists &&
      allowMatchingUnmanagedSkills &&
      await contentMatches(sourceDir, targetDir);
    const replaceable = replaceablePaths?.has(targetDir) === true;
    if (targetExists && !owned && !matchingUnmanaged && !replaceable) {
      errors.push(`Skill target already exists and is not AgentEnv-owned: ${targetDir}`);
    }
  }
  return errors;
};

export const addSkillRefBackupPaths = (
  paths: Set<string>,
  targetPaths: TargetPaths,
  input: TargetAssetInput
) => {
  if (!targetPaths.skillsDir || input.isolateSkillRoot) return;
  for (const skillRef of input.profile.resources.skills) {
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);
    paths.add(targetDir);
    paths.add(`${targetDir}.agentenv-owner.json`);
  }
};

export const applySkillRefs = async ({
  profile,
  targetPaths,
  skillLibraryDir,
  skillSyncMethod = "symlink",
  allowMatchingUnmanagedSkills,
  replaceablePaths
}: TargetAssetInput) => {
  if (!targetPaths.skillsDir || !skillLibraryDir) return;

  for (const skillRef of profile.resources.skills.filter((skill) => skill.enabled)) {
    const sourceDir = librarySourceFor(skillLibraryDir, skillRef.libraryId);
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);
    const targetExists = await pathEntryExists(targetDir);
    const owned = targetExists && await isOwnedSkillDir(targetDir, targetPaths);
    const matchingUnmanaged =
      targetExists &&
      allowMatchingUnmanagedSkills &&
      await contentMatches(sourceDir, targetDir);
    const replaceable = replaceablePaths?.has(targetDir) === true;
    if (targetExists && !owned && !matchingUnmanaged && !replaceable) {
      throw new Error(
        `Skill target changed after preview and is not AgentEnv-owned: ${targetDir}`
      );
    }
    await deploySkillDirectory({
      sourceDir,
      targetDir,
      syncMethod: skillSyncMethod,
      markerContent: createOwnerMarkerContent({
        profileId: profile.id,
        targetId: targetPaths.targetId,
        kind: "skill",
        source: `skills-library/${skillRef.libraryId}`
      })
    });
  }
};
