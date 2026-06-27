import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentEnvPaths {
  appDataRoot: string;
  profilesDir: string;
  backupsDir: string;
  activationHistoryPath: string;
  codexHome: string;
  globalAgentsPath: string;
  globalAgentsOverridePath: string;
  codexConfigPath: string;
  userSkillsDir: string;
}

export type PathOverrides = Partial<AgentEnvPaths> & { appDataRoot: string };

export const createPaths = (overrides: PathOverrides): AgentEnvPaths => {
  const home = homedir();
  const codexHome = overrides.codexHome ?? join(home, ".codex");
  const userSkillsDir = overrides.userSkillsDir ?? join(home, ".agents", "skills");

  return {
    appDataRoot: overrides.appDataRoot,
    profilesDir: overrides.profilesDir ?? join(overrides.appDataRoot, "profiles"),
    backupsDir: overrides.backupsDir ?? join(overrides.appDataRoot, "backups"),
    activationHistoryPath:
      overrides.activationHistoryPath ??
      join(overrides.appDataRoot, "activation-history.jsonl"),
    codexHome,
    globalAgentsPath: overrides.globalAgentsPath ?? join(codexHome, "AGENTS.md"),
    globalAgentsOverridePath:
      overrides.globalAgentsOverridePath ?? join(codexHome, "AGENTS.override.md"),
    codexConfigPath: overrides.codexConfigPath ?? join(codexHome, "config.toml"),
    userSkillsDir
  };
};
