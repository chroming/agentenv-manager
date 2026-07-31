import type { AgentEnvSettings } from "../../shared/types";
import type { AgentEnvPaths } from "../paths";
import { pathsEqual } from "../platformPaths";
import type { TargetPathInput } from "./types";

export const targetPathInputFor = (
  paths: Pick<AgentEnvPaths, "homeDir" | "fakeHomeRoot">,
  settings: Pick<AgentEnvSettings, "targetConfigRoots">,
  targetId: string
): TargetPathInput => ({
  homeDir: paths.homeDir,
  fakeHomeRoot: paths.fakeHomeRoot,
  rootDirOverride: settings.targetConfigRoots?.[targetId],
  platform: process.platform,
  environment: (() => {
    const processHome =
      process.platform === "win32"
        ? process.env.USERPROFILE ?? process.env.HOME
        : process.env.HOME ?? process.env.USERPROFILE;
    return processHome && pathsEqual(processHome, paths.homeDir)
      ? process.env
      : undefined;
  })()
});
