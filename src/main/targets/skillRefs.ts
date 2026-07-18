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
  (await hashComparableResource(sourceDir)) === (await hashComparableResource(targetDir));

export const skillTargetNames = ({ profile }: TargetAssetInput) =>
  new Set(
    profile.assetPolicy.ownedDirs
      .filter((ownedDir) => ownedDir.kind === "skill")
      .map((ownedDir) => ownedDir.targetName)
      .concat(
        (profile.assetPolicy.skillRefs ?? [])
          .filter((skillRef) => skillRef.enabled !== false)
          .map((skillRef) => skillRef.targetName)
      )
  );

export const validateSkillRefs = async ({
  profile,
  targetPaths,
  skillLibraryDir,
  allowMatchingUnmanagedSkills,
  isolateSkillRoot
}: TargetAssetInput) => {
  const errors: string[] = [];
  const skillRefs = (profile.assetPolicy.skillRefs ?? []).filter(
    (skillRef) => skillRef.enabled !== false
  );
  if (skillRefs.length === 0) {
    return errors;
  }
  if (!targetPaths.skillsDir) {
    return ["Target does not expose a skills directory"];
  }
  if (!skillLibraryDir) {
    return ["Skill library directory is required for shared skill references"];
  }

  const declaredTargets = new Map<string, string>();
  for (const ownedDir of profile.assetPolicy.ownedDirs) {
    if (ownedDir.kind === "skill") {
      declaredTargets.set(ownedDir.targetName, ownedDir.source);
    }
  }

  for (const skillRef of skillRefs) {
    const previousSource = declaredTargets.get(skillRef.targetName);
    if (previousSource) {
      errors.push(
        `Skill target ${skillRef.targetName} is declared more than once: ${previousSource} and skills-library/${skillRef.libraryId}`
      );
      continue;
    }
    declaredTargets.set(skillRef.targetName, `skills-library/${skillRef.libraryId}`);

    const sourceDir = librarySourceFor(skillLibraryDir, skillRef.libraryId);
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);
    if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
      errors.push(`Library skill does not exist: ${sourceDir}`);
    }
    const exists = !isolateSkillRoot && await pathExists(targetDir);
    const owned = exists && await isOwnedSkillDir(targetDir, targetPaths);
    const matchingUnmanaged =
      exists && allowMatchingUnmanagedSkills && await contentMatches(sourceDir, targetDir);
    if (exists && !owned && !matchingUnmanaged) {
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
  if (!targetPaths.skillsDir || input.isolateSkillRoot) {
    return;
  }
  for (const skillRef of (input.profile.assetPolicy.skillRefs ?? []).filter(
    (reference) => reference.enabled !== false
  )) {
    paths.add(join(targetPaths.skillsDir, skillRef.targetName));
    paths.add(`${join(targetPaths.skillsDir, skillRef.targetName)}.agentenv-owner.json`);
  }
};

export const applySkillRefs = async ({
  profile,
  targetPaths,
  skillLibraryDir,
  skillSyncMethod = "symlink",
  allowMatchingUnmanagedSkills
}: TargetAssetInput) => {
  if (!targetPaths.skillsDir || !skillLibraryDir) {
    return;
  }

  for (const skillRef of (profile.assetPolicy.skillRefs ?? []).filter(
    (reference) => reference.enabled !== false
  )) {
    const sourceDir = librarySourceFor(skillLibraryDir, skillRef.libraryId);
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);
    const targetExists = await pathEntryExists(targetDir);
    const owned = targetExists && await isOwnedSkillDir(targetDir, targetPaths);
    const matchingUnmanaged =
      targetExists && allowMatchingUnmanagedSkills && await contentMatches(sourceDir, targetDir);
    if (targetExists && !owned && !matchingUnmanaged) {
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
