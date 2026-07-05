import { cp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TargetPaths } from "../../shared/types";
import { pathExists } from "../fileUtils";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir,
  markerPathFor
} from "../ownershipMarkers";
import type { TargetAssetInput } from "./types";

const removeIfExists = async (path: string) => {
  await rm(path, { recursive: true, force: true });
};

const copyEntries = async (sourceDir: string, targetDir: string) => {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".agentenv-skill.json") {
      continue;
    }
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    await cp(sourcePath, targetPath, { recursive: true, dereference: true });
  }
};

const symlinkEntries = async (sourceDir: string, targetDir: string) => {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".agentenv-skill.json") {
      continue;
    }
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    await symlink(sourcePath, targetPath, entry.isDirectory() ? "dir" : "file");
  }
};

const librarySourceFor = (skillLibraryDir: string, libraryId: string) =>
  join(skillLibraryDir, libraryId);

export const skillTargetNames = ({ profile }: TargetAssetInput) =>
  new Set(
    profile.assetPolicy.ownedDirs
      .filter((ownedDir) => ownedDir.kind === "skill")
      .map((ownedDir) => ownedDir.targetName)
      .concat((profile.assetPolicy.skillRefs ?? []).map((skillRef) => skillRef.targetName))
  );

export const validateSkillRefs = async ({
  profile,
  targetPaths,
  skillLibraryDir
}: TargetAssetInput) => {
  const errors: string[] = [];
  const skillRefs = profile.assetPolicy.skillRefs ?? [];
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
    if (
      (await pathExists(targetDir)) &&
      !(await isAgentEnvOwnedDir(targetDir, {
        targetId: targetPaths.targetId,
        kind: "skill"
      }))
    ) {
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
  if (!targetPaths.skillsDir) {
    return;
  }
  for (const skillRef of input.profile.assetPolicy.skillRefs ?? []) {
    paths.add(join(targetPaths.skillsDir, skillRef.targetName));
  }
};

export const applySkillRefs = async ({
  profile,
  targetPaths,
  skillLibraryDir,
  skillSyncMethod = "copy"
}: TargetAssetInput) => {
  if (!targetPaths.skillsDir || !skillLibraryDir) {
    return;
  }

  for (const skillRef of profile.assetPolicy.skillRefs ?? []) {
    const sourceDir = librarySourceFor(skillLibraryDir, skillRef.libraryId);
    const targetDir = join(targetPaths.skillsDir, skillRef.targetName);

    if (
      await isAgentEnvOwnedDir(targetDir, {
        targetId: targetPaths.targetId,
        kind: "skill"
      })
    ) {
      await removeIfExists(targetDir);
    }

    await mkdir(targetDir, { recursive: true });
    if (skillSyncMethod === "copy") {
      await copyEntries(sourceDir, targetDir);
    } else if (skillSyncMethod === "auto") {
      try {
        await symlinkEntries(sourceDir, targetDir);
      } catch {
        await removeIfExists(targetDir);
        await mkdir(targetDir, { recursive: true });
        await copyEntries(sourceDir, targetDir);
      }
    } else {
      await symlinkEntries(sourceDir, targetDir);
    }
    await writeFile(
      markerPathFor(targetDir),
      createOwnerMarkerContent({
        profileId: profile.id,
        targetId: profile.manifest.targetId,
        kind: "skill",
        source: `skills-library/${skillRef.libraryId}`
      }),
      "utf8"
    );
  }
};
