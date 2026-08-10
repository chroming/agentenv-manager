import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AgentEnvPaths {
  appDataRoot: string;
  repositoryCacheDir: string;
  conversationIndexPath: string;
  conversationHandoffDir: string;
  skillSourceObservationsDir: string;
  captureReceiptsDir: string;
  workspaceSyncCacheDir: string;
  workspaceSyncStatePath: string;
  workspaceSyncJournalPath: string;
  evaluationCacheDir: string;
  evaluationResultPath: string;
  projectsPath: string;
  uiStatePath: string;
  skillSourcesPath: string;
  unmanagedSkillLocationsPath: string;
  skillCollectionDecisionsPath: string;
  profilesDir: string;
  profileRecoveryDir: string;
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
    conversationIndexPath:
      overrides.conversationIndexPath ??
      join(cacheRoot, "conversations.sqlite"),
    conversationHandoffDir:
      overrides.conversationHandoffDir ??
      join(cacheRoot, "conversation-handoffs"),
    skillSourceObservationsDir:
      overrides.skillSourceObservationsDir ??
      join(cacheRoot, "skill-source-observations"),
    captureReceiptsDir:
      overrides.captureReceiptsDir ?? join(cacheRoot, "capture-receipts"),
    workspaceSyncCacheDir:
      overrides.workspaceSyncCacheDir ?? join(cacheRoot, "workspace-sync"),
    workspaceSyncStatePath:
      overrides.workspaceSyncStatePath ?? join(overrides.appDataRoot, "workspace-sync.json"),
    workspaceSyncJournalPath:
      overrides.workspaceSyncJournalPath ?? join(overrides.appDataRoot, "workspace-sync-transaction.json"),
    evaluationCacheDir:
      overrides.evaluationCacheDir ?? join(cacheRoot, "evaluations"),
    evaluationResultPath:
      overrides.evaluationResultPath ?? join(overrides.appDataRoot, "evaluations", "latest.json"),
    projectsPath:
      overrides.projectsPath ?? join(overrides.appDataRoot, "projects.json"),
    uiStatePath:
      overrides.uiStatePath ?? join(overrides.appDataRoot, "ui-state.json"),
    skillSourcesPath:
      overrides.skillSourcesPath ?? join(overrides.appDataRoot, "skill-sources.json"),
    unmanagedSkillLocationsPath:
      overrides.unmanagedSkillLocationsPath ??
      join(overrides.appDataRoot, "unmanaged-skill-locations.json"),
    skillCollectionDecisionsPath:
      overrides.skillCollectionDecisionsPath ??
      join(overrides.appDataRoot, "skill-collection-decisions.json"),
    profilesDir: overrides.profilesDir ?? join(overrides.appDataRoot, "profiles"),
    profileRecoveryDir:
      overrides.profileRecoveryDir ?? join(overrides.appDataRoot, "profile-recovery"),
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
