import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AgentEnvPaths {
  appDataRoot: string;
  profilesDir: string;
  backupsDir: string;
  targetStatesDir: string;
  activationHistoryPath: string;
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

  return {
    appDataRoot: overrides.appDataRoot,
    profilesDir: overrides.profilesDir ?? join(overrides.appDataRoot, "profiles"),
    backupsDir: overrides.backupsDir ?? join(overrides.appDataRoot, "backups"),
    targetStatesDir:
      overrides.targetStatesDir ?? join(overrides.appDataRoot, "target-states"),
    activationHistoryPath:
      overrides.activationHistoryPath ??
      join(overrides.appDataRoot, "activation-history.jsonl"),
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
