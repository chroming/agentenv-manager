import { cp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEnvSettings } from "../shared/types";
import { replacePathAtomically, writeAtomic } from "./fileUtils";
import { markerPathFor, markerPathForFile } from "./ownershipMarkers";

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

export const removeSkillDeployment = async (targetDir: string) => {
  await rm(targetDir, { recursive: true, force: true });
  await rm(markerPathForFile(targetDir), { force: true });
};
