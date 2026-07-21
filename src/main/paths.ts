import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AgentEnvPaths {
  appDataRoot: string;
  repositoryCacheDir: string;
  skillSourceObservationsDir: string;
  captureReceiptsDir: string;
  profilesDir: string;
  backupsDir: string;
  targetStatesDir: string;
  activationHistoryPath: string;
  skillsLibraryDir: string;
  homeDir: string;
  fakeHomeRoot: string;
  codexHome: string;
  globalAgentsPath: string;
  globalAgentsOverridePath: string;
  codexConfigPath: string;
  userSkillsDir: string;
}

export type PathOverrides = Partial<AgentEnvPaths> & { appDataRoot: string };

export const createPaths = (overrides: PathOverrides): AgentEnvPaths => {
  const home = overrides.homeDir ?? homedir();
  const fakeHomeRoot =
    overrides.fakeHomeRoot ??
    (overrides.codexHome ? dirname(overrides.codexHome) : join(overrides.appDataRoot, "fake-home"));
  const codexHome = overrides.codexHome ?? join(home, ".codex");
  const userSkillsDir = overrides.userSkillsDir ?? join(home, ".agents", "skills");
  const cacheRoot = overrides.repositoryCacheDir
    ? dirname(overrides.repositoryCacheDir)
    : join(dirname(overrides.appDataRoot), ".agentenv-manager-cache");

  return {
    appDataRoot: overrides.appDataRoot,
    repositoryCacheDir:
      overrides.repositoryCacheDir ??
      join(cacheRoot, "repositories"),
    skillSourceObservationsDir:
      overrides.skillSourceObservationsDir ??
      join(cacheRoot, "skill-source-observations"),
    captureReceiptsDir:
      overrides.captureReceiptsDir ?? join(cacheRoot, "capture-receipts"),
    profilesDir: overrides.profilesDir ?? join(overrides.appDataRoot, "profiles"),
    backupsDir: overrides.backupsDir ?? join(overrides.appDataRoot, "backups"),
    targetStatesDir:
      overrides.targetStatesDir ?? join(overrides.appDataRoot, "target-states"),
    activationHistoryPath:
      overrides.activationHistoryPath ??
      join(overrides.appDataRoot, "activation-history.jsonl"),
    skillsLibraryDir:
      overrides.skillsLibraryDir ?? join(overrides.appDataRoot, "skills-library"),
    homeDir: home,
    fakeHomeRoot,
    codexHome,
    globalAgentsPath: overrides.globalAgentsPath ?? join(codexHome, "AGENTS.md"),
    globalAgentsOverridePath:
      overrides.globalAgentsOverridePath ?? join(codexHome, "AGENTS.override.md"),
    codexConfigPath: overrides.codexConfigPath ?? join(codexHome, "config.toml"),
    userSkillsDir
  };
};
