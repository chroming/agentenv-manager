import type { AgentEnvSettings } from "../../shared/types";
import type { AgentEnvPaths } from "../paths";
import type { TargetPathInput } from "./types";

export const targetPathInputFor = (
  paths: Pick<AgentEnvPaths, "homeDir" | "fakeHomeRoot">,
  settings: Pick<AgentEnvSettings, "targetConfigRoots">,
  targetId: string
): TargetPathInput => ({
  homeDir: paths.homeDir,
  fakeHomeRoot: paths.fakeHomeRoot,
  rootDirOverride: settings.targetConfigRoots?.[targetId]
});
