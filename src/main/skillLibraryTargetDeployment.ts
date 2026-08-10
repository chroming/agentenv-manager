import { join } from "node:path";
import type { AgentEnvSettings, TargetPaths } from "../shared/types";
import { SafeIdSchema } from "../shared/schemas";
import { pathExists } from "./fileUtils";
import { deploySkillDirectory } from "./skillDeployment";

interface TargetDeploymentInput {
  targetPaths: TargetPaths;
  targetName: string;
  libraryId: string;
  targetDir?: string;
}

export const createSkillLibraryTargetDeployer = (options: {
  libraryDir(): Promise<string>;
  readSettings(): Promise<AgentEnvSettings>;
}) => async ({ targetPaths, targetName, libraryId, targetDir }: TargetDeploymentInput): Promise<void> => {
  if (!targetPaths.skillsDir) throw new Error("Agent does not expose a Skills directory");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(targetName)) {
    throw new Error(`Invalid target skill name: ${targetName}`);
  }
  const safeLibraryId = SafeIdSchema.parse(libraryId);
  const sourceDir = join(await options.libraryDir(), safeLibraryId);
  if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
    throw new Error(`Library skill does not exist: ${safeLibraryId}`);
  }
  const settings = await options.readSettings();
  await deploySkillDirectory({
    sourceDir,
    targetDir: targetDir ?? join(targetPaths.skillsDir, targetName),
    syncMethod: settings.skillSyncMethod
  });
};
