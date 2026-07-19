import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "../../fileUtils";
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

const isOwnedTargetSkill = (path: string, input: TargetAssetInput) =>
  isAgentEnvOwnedDir(path, {
    targetId: input.targetPaths.targetId,
    kind: "skill"
  });

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
  validateAssets: (input) => validateSkillRefs(input),
  getAssetBackupPaths: async (input) => {
    const paths = new Set<string>();
    addSkillRefBackupPaths(paths, input.targetPaths, input);
    for (const stalePath of await staleOwnedSkillPaths(input)) {
      paths.add(stalePath);
      paths.add(markerPathForFile(stalePath));
    }
    return [...paths];
  },
  applyAssets: async (input) => {
    for (const stalePath of await staleOwnedSkillPaths(input)) {
      await removeSkillDeployment(stalePath);
    }
    await applySkillRefs(input);
  }
});
