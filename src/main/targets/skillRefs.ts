import { join, resolve } from "node:path";
import { createApplyIssue } from "../applyIssues";
import type { ApplyIssue, TargetPaths } from "../../shared/types";
import { profileManagesResource } from "../../shared/profileResources";
import { pathEntryExists, pathExists } from "../fileUtils";
import { hashSkillContent } from "../skillContentHash";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir,
  markerPathForFile
} from "../ownershipMarkers";
import { deploySkillDirectory, removeSkillDeployment } from "../skillDeployment";
import type { TargetAssetInput } from "./types";

const librarySourceFor = (skillLibraryDir: string, libraryId: string) =>
  join(skillLibraryDir, libraryId);

const isOwnedSkillDir = async (targetDir: string, targetPaths: TargetPaths) =>
  isAgentEnvOwnedDir(targetDir, {
    targetId: targetPaths.targetId,
    kind: "skill"
  });

export const skillTargetNames = ({ profile, targetPaths }: TargetAssetInput) =>
  new Set(
    (profileManagesResource(profile.resources, targetPaths.targetId, "skills")
      ? profile.resources.skills
      : [])
      .filter((skill) => skill.enabled)
      .map((skill) => skill.targetName)
  );

export const validateSkillRefs = async ({
  profile,
  targetPaths,
  skillLibraryDir,
  approvedUnmanagedSkillHashes,
  replaceablePaths,
  isolateSkillRoot
}: TargetAssetInput) => {
  const issues: ApplyIssue[] = [];
  if (!profileManagesResource(profile.resources, targetPaths.targetId, "skills")) {
    return issues;
  }
  const skillRefs = profile.resources.skills;
  if (skillRefs.length === 0) return issues;
  if (!targetPaths.skillsDir) {
    return skillRefs.some((skill) => skill.enabled)
      ? [createApplyIssue({
          code: "unsupported-skill-management",
          resourceKind: "skill",
          message: "Agent does not expose a Skills directory"
        })]
      : [];
  }
  if (!skillLibraryDir) {
    return [createApplyIssue({
      code: "missing-library-skill",
      resourceKind: "skill",
      message: "Skill Library directory is required for Profile Skills"
    })];
  }

  for (const skillRef of skillRefs) {
    const sourceDir = librarySourceFor(skillLibraryDir, skillRef.libraryId);
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);
    const targetExists = !isolateSkillRoot && await pathEntryExists(targetDir);
    const owned = targetExists && await isOwnedSkillDir(targetDir, targetPaths);
    const replaceable = replaceablePaths?.has(resolve(targetDir)) === true;
    if (!skillRef.enabled) {
      if (targetExists && !owned && !replaceable) {
        issues.push(createApplyIssue({
          code: "outside-skill-removal",
          resourceKind: "skill",
          resourceId: skillRef.targetName,
          path: targetDir,
          message: `${skillRef.targetName} is outside AgentEnv and requires review before removal`
        }));
      }
      continue;
    }

    if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
      issues.push(createApplyIssue({
        code: "missing-library-skill",
        resourceKind: "skill",
        resourceId: skillRef.libraryId,
        path: sourceDir,
        message: `Library Skill does not exist: ${skillRef.libraryId}`
      }));
      continue;
    }
    const approvedHash = approvedUnmanagedSkillHashes?.get(resolve(targetDir));
    const matchingUnmanaged = Boolean(
      targetExists &&
      approvedHash &&
      (await hashSkillContent(targetDir)) === approvedHash
    );
    if (targetExists && !owned && !matchingUnmanaged && !replaceable) {
      issues.push(createApplyIssue({
        code: "outside-skill-replacement",
        resourceKind: "skill",
        resourceId: skillRef.targetName,
        path: targetDir,
        message: `${skillRef.targetName} is outside AgentEnv and requires review before takeover`
      }));
    }
  }
  return issues;
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
  approvedUnmanagedSkillHashes,
  replaceablePaths,
  claimMutationPath
}: TargetAssetInput) => {
  if (!profileManagesResource(profile.resources, targetPaths.targetId, "skills")) return;
  if (!targetPaths.skillsDir || !skillLibraryDir) return;

  for (const skillRef of profile.resources.skills.filter((skill) => !skill.enabled)) {
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);
    if (replaceablePaths?.has(resolve(targetDir))) {
      await claimMutationPath?.(targetDir);
      await claimMutationPath?.(markerPathForFile(targetDir));
      await removeSkillDeployment(targetDir, {
        allowedRoot: targetPaths.skillsDir
      });
      await claimMutationPath?.recordMutation?.(
        targetDir,
        markerPathForFile(targetDir)
      );
    }
  }

  for (const skillRef of profile.resources.skills.filter((skill) => skill.enabled)) {
    const sourceDir = librarySourceFor(skillLibraryDir, skillRef.libraryId);
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);
    const targetExists = await pathEntryExists(targetDir);
    const owned = targetExists && await isOwnedSkillDir(targetDir, targetPaths);
    const approvedHash = approvedUnmanagedSkillHashes?.get(resolve(targetDir));
    const matchingUnmanaged = Boolean(
      targetExists &&
      approvedHash &&
      (await hashSkillContent(targetDir)) === approvedHash
    );
    const replaceable = replaceablePaths?.has(resolve(targetDir)) === true;
    if (targetExists && !owned && !matchingUnmanaged && !replaceable) {
      throw new Error(
        `Skill target changed after preview and is not AgentEnv-owned: ${targetDir}`
      );
    }
    await claimMutationPath?.(targetDir);
    await claimMutationPath?.(markerPathForFile(targetDir));
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
    await claimMutationPath?.recordMutation?.(
      targetDir,
      markerPathForFile(targetDir)
    );
  }
};
