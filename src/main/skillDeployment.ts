import {
  cp,
  lstat,
  mkdir,
  readdir,
  rm,
  rmdir,
  symlink,
  unlink
} from "node:fs/promises";
import { join } from "node:path";
import type { AgentEnvSettings } from "../shared/types";
import { isMissingFileError, replacePathAtomically } from "./fileUtils";
import { isPathInside } from "./platformPaths";
import {
  isAgentEnvOwnedDir,
  markerPathForFile,
  type OwnedDirExpectation
} from "./ownershipMarkers";

export const copySkillEntries = async (sourceDir: string, targetDir: string) => {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (entry.name === ".agentenv-skill.json" || entry.name === ".agentenv-owner.json") {
      continue;
    }
    await cp(join(sourceDir, entry.name), join(targetDir, entry.name), {
      recursive: true,
      dereference: true
    });
  }
};

export const deploySkillDirectory = async (input: {
  sourceDir: string;
  targetDir: string;
  syncMethod: AgentEnvSettings["skillSyncMethod"];
  platform?: NodeJS.Platform;
  createSymlink?: typeof symlink;
}) => {
  const platform = input.platform ?? process.platform;
  const deployedAs: "copy" | "symlink" = input.syncMethod === "symlink"
    ? "symlink"
    : "copy";
  await replacePathAtomically(input.targetDir, async (stagingPath) => {
    if (deployedAs === "symlink") {
      await (input.createSymlink ?? symlink)(
        input.sourceDir,
        stagingPath,
        platform === "win32" ? "junction" : "dir"
      );
      return;
    }
    await copySkillEntries(input.sourceDir, stagingPath);
  }, { platform });

  await rm(markerPathForFile(input.targetDir), { force: true });
  return deployedAs;
};

const assertContainedChild = (targetPath: string, allowedRoot: string) => {
  if (!isPathInside(allowedRoot, targetPath)) {
    throw new Error(`Refusing to remove a Skill outside its allowed root: ${targetPath}`);
  }
};

const removeTreeWithoutFollowingLinks = async (path: string): Promise<void> => {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  if (info.isDirectory() && !info.isSymbolicLink()) {
    for (const entry of await readdir(path)) {
      await removeTreeWithoutFollowingLinks(join(path, entry));
    }
    await rmdir(path);
    return;
  }
  await unlink(path);
};

export const removeSkillDeployment = async (
  targetDir: string,
  options: {
    allowedRoot: string;
    expectedOwnership?: OwnedDirExpectation;
  }
) => {
  assertContainedChild(targetDir, options.allowedRoot);
  if (
    options.expectedOwnership &&
    !(await isAgentEnvOwnedDir(targetDir, options.expectedOwnership))
  ) {
    throw new Error(`Refusing to remove a Skill outside AgentEnv ownership: ${targetDir}`);
  }
  await removeTreeWithoutFollowingLinks(targetDir);
  await rm(markerPathForFile(targetDir), { force: true });
};
