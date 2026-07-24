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
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentEnvSettings } from "../shared/types";
import { isMissingFileError, replacePathAtomically, writeAtomic } from "./fileUtils";
import {
  isAgentEnvOwnedDir,
  markerPathFor,
  markerPathForFile,
  type OwnedDirExpectation
} from "./ownershipMarkers";

const copySkillEntries = async (sourceDir: string, targetDir: string) => {
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

export const isUnsupportedSkillLinkError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EPERM" ||
        error.code === "ENOTSUP" ||
        error.code === "EOPNOTSUPP" ||
        error.code === "EINVAL")
  );

export const deploySkillDirectory = async (input: {
  sourceDir: string;
  targetDir: string;
  syncMethod: AgentEnvSettings["skillSyncMethod"];
  markerContent: string;
  createSymlink?: typeof symlink;
}) => {
  let deployedAs: "copy" | "symlink" = input.syncMethod === "copy" ? "copy" : "symlink";
  await replacePathAtomically(input.targetDir, async (stagingPath) => {
    if (input.syncMethod !== "copy") {
      try {
        await (input.createSymlink ?? symlink)(input.sourceDir, stagingPath, "dir");
        return;
      } catch (error) {
        if (input.syncMethod === "symlink" || !isUnsupportedSkillLinkError(error)) {
          throw error;
        }
        deployedAs = "copy";
      }
    }
    await copySkillEntries(input.sourceDir, stagingPath);
    await writeAtomic(markerPathFor(stagingPath), input.markerContent);
  });

  if (deployedAs === "symlink") {
    await writeAtomic(markerPathForFile(input.targetDir), input.markerContent);
  } else {
    await rm(markerPathForFile(input.targetDir), { force: true });
  }
  return deployedAs;
};

const assertContainedChild = (targetPath: string, allowedRoot: string) => {
  const root = resolve(allowedRoot);
  const target = resolve(targetPath);
  const child = relative(root, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
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
