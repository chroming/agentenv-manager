import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  pathEntryExists,
  pathExists,
  replacePathAtomically,
  writeAtomic
} from "../../fileUtils";
import { hashComparableResource } from "../../resourceHash";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir,
  markerPathFor,
  markerPathForFile
} from "../../ownershipMarkers";
import { removeSkillDeployment } from "../../skillDeployment";
import {
  addSkillRefBackupPaths,
  applySkillRefs,
  skillTargetNames,
  validateSkillRefs
} from "../skillRefs";
import type { TargetAssetDriver } from "../contract";
import type { TargetAssetInput } from "../types";
import type { TargetPaths } from "../../../shared/types";

interface DirectoryAssetDriverOptions {
  targetName: string;
  markerTargetId?(input: TargetAssetInput): string;
}

const targetRootFor = (targetPaths: TargetPaths, kind: "agent" | "skill") =>
  kind === "agent" ? targetPaths.agentsDir : targetPaths.skillsDir;

const targetDirFor = (
  targetPaths: TargetPaths,
  kind: "agent" | "skill",
  targetName: string
) => {
  const root = targetRootFor(targetPaths, kind);
  if (!root) {
    throw new Error(`Target does not support ${kind} directories`);
  }
  return join(root, targetName);
};

const isOwnedTargetDir = (
  targetDir: string,
  targetPaths: TargetPaths,
  kind: "agent" | "skill"
) => isAgentEnvOwnedDir(targetDir, { targetId: targetPaths.targetId, kind });

export const createDirectoryAssetDriver = ({
  targetName,
  markerTargetId = (input) => input.targetPaths.targetId
}: DirectoryAssetDriverOptions): TargetAssetDriver => {
  const removeStaleOwnedDirs = async (input: TargetAssetInput) => {
    const { profile, targetPaths } = input;
    const desired = new Set(
      profile.assetPolicy.ownedDirs.map((ownedDir) =>
        `${ownedDir.kind}:${ownedDir.targetName}`
      )
    );
    for (const skillName of skillTargetNames(input)) {
      desired.add(`skill:${skillName}`);
    }
    const roots: Array<{ kind: "agent" | "skill"; path?: string }> = [
      { kind: "agent", path: targetPaths.agentsDir },
      { kind: "skill", path: targetPaths.skillsDir }
    ];

    for (const root of roots) {
      if (!root.path || !(await pathExists(root.path))) continue;
      const entries = await readdir(root.path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const targetDir = join(root.path, entry.name);
        const key = `${root.kind}:${entry.name}`;
        if (
          !desired.has(key) &&
          await isOwnedTargetDir(targetDir, targetPaths, root.kind)
        ) {
          if (root.kind === "skill") {
            await removeSkillDeployment(targetDir);
          } else {
            await rm(targetDir, { recursive: true, force: true });
          }
        }
      }
    }
  };

  return {
    validateAssets: async (input) => {
      const { profile, targetPaths } = input;
      const errors: string[] = [];
      if (profile.assetPolicy.ownedFiles.length > 0) {
        errors.push(`${targetName} target does not support owned file assets`);
      }
      if (!profile.profileDir && profile.assetPolicy.ownedDirs.length > 0) {
        return ["Profile directory is required to copy owned assets"];
      }
      for (const ownedDir of profile.assetPolicy.ownedDirs) {
        const sourceDir = join(profile.profileDir ?? "", ownedDir.source);
        const targetDir = targetDirFor(targetPaths, ownedDir.kind, ownedDir.targetName);
        const sourceExists = await pathExists(sourceDir);
        if (!sourceExists) {
          errors.push(`Owned ${ownedDir.kind} source does not exist: ${sourceDir}`);
        }
        const targetExists =
          !(input.isolateSkillRoot && ownedDir.kind === "skill") &&
          await pathExists(targetDir);
        const owned = targetExists &&
          await isOwnedTargetDir(targetDir, targetPaths, ownedDir.kind);
        const matching = targetExists && sourceExists &&
          input.allowMatchingUnmanagedAssets &&
          (await hashComparableResource(sourceDir)) ===
            (await hashComparableResource(targetDir));
        if (targetExists && !owned && !matching) {
          errors.push(
            `${ownedDir.kind} target already exists and is not AgentEnv-owned: ${targetDir}`
          );
        }
      }
      errors.push(...(await validateSkillRefs(input)));
      return errors;
    },
    getAssetBackupPaths: async (input) => {
      const { profile, targetPaths } = input;
      const paths = new Set<string>();
      const desired = new Set(
        profile.assetPolicy.ownedDirs.map((ownedDir) =>
          `${ownedDir.kind}:${ownedDir.targetName}`
        )
      );
      for (const skillName of skillTargetNames(input)) {
        desired.add(`skill:${skillName}`);
      }
      const roots: Array<{ kind: "agent" | "skill"; path?: string }> = [
        { kind: "agent", path: targetPaths.agentsDir },
        { kind: "skill", path: targetPaths.skillsDir }
      ];
      for (const ownedDir of profile.assetPolicy.ownedDirs) {
        if (!(input.isolateSkillRoot && ownedDir.kind === "skill")) {
          paths.add(targetDirFor(targetPaths, ownedDir.kind, ownedDir.targetName));
        }
      }
      addSkillRefBackupPaths(paths, targetPaths, input);
      for (const root of roots) {
        if (input.isolateSkillRoot && root.kind === "skill") continue;
        if (!root.path || !(await pathExists(root.path))) continue;
        const entries = await readdir(root.path, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          const targetDir = join(root.path, entry.name);
          const key = `${root.kind}:${entry.name}`;
          if (
            !desired.has(key) &&
            await isOwnedTargetDir(targetDir, targetPaths, root.kind)
          ) {
            paths.add(targetDir);
            if (root.kind === "skill") paths.add(markerPathForFile(targetDir));
          }
        }
      }
      return [...paths];
    },
    applyAssets: async (input) => {
      const { profile, targetPaths } = input;
      await removeStaleOwnedDirs(input);
      for (const ownedDir of profile.assetPolicy.ownedDirs) {
        const sourceDir = join(profile.profileDir ?? "", ownedDir.source);
        const targetDir = targetDirFor(targetPaths, ownedDir.kind, ownedDir.targetName);
        const owned = await isOwnedTargetDir(targetDir, targetPaths, ownedDir.kind);
        const matching = input.allowMatchingUnmanagedAssets &&
          await pathExists(sourceDir) &&
          await pathExists(targetDir) &&
          (await hashComparableResource(sourceDir)) ===
            (await hashComparableResource(targetDir));
        if ((await pathEntryExists(targetDir)) && !owned && !matching) {
          throw new Error(
            `${ownedDir.kind} target changed after preview and is not AgentEnv-owned: ${targetDir}`
          );
        }
        await mkdir(targetDirFor(targetPaths, ownedDir.kind, "."), { recursive: true });
        await replacePathAtomically(targetDir, async (stagingPath) => {
          await cp(sourceDir, stagingPath, { recursive: true });
          await writeAtomic(
            markerPathFor(stagingPath),
            createOwnerMarkerContent({
              profileId: profile.id,
              targetId: markerTargetId(input),
              kind: ownedDir.kind,
              source: ownedDir.source
            })
          );
        });
      }
      await applySkillRefs(input);
    }
  };
};
