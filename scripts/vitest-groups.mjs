export const electronE2eTestFiles = [
  "tests/e2e/electronAppUpdates.e2e.test.ts",
  "tests/e2e/conversations.e2e.test.ts",
  "tests/e2e/desktopShell.e2e.test.ts",
  "tests/e2e/electronUiProfileSwitching.e2e.test.ts",
  "tests/e2e/profileEvaluation.e2e.test.ts",
  "tests/e2e/projects.e2e.test.ts",
  "tests/e2e/repositorySkillSource.e2e.test.ts",
  "tests/e2e/startupRecovery.e2e.test.ts",
  "tests/e2e/workspaceSync.e2e.test.ts"
];

export const heavyElectronE2eTestFile =
  "tests/e2e/electronUiProfileSwitching.e2e.test.ts";

export const exclusiveElectronE2eTestNames = [
  "Electron UI profile switching e2e keeps Library scale correct and responsive at supported viewports"
];

export const electronE2eExcludeGlob =
  "**/tests/e2e/{conversations,desktopShell,electronAppUpdates,electronUiProfileSwitching,profileEvaluation,projects,repositorySkillSource,startupRecovery,workspaceSync}.e2e.test.ts";
