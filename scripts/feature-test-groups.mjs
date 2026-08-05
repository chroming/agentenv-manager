export const featureTestGroups = {
  "project-environments": {
    unit: [
      "tests/shared/schemas.test.ts",
      "tests/main/projects/projectStore.test.ts",
      "tests/main/projects/projectCapability.test.ts",
      "tests/main/projects/projectEnvironmentService.test.ts",
      "tests/main/projects/projectMutationService.test.ts",
      "tests/main/projects/projectLaunchService.test.ts",
      "tests/main/targetIntegrationContract.test.ts",
      "tests/renderer/ProjectsWorkspace.test.tsx",
      "tests/renderer/ProjectResourceEditorDialog.test.tsx",
      "tests/renderer/ProjectEnvironmentPreviewDialog.test.tsx",
      "tests/renderer/ConversationWorkspace.test.tsx"
    ],
    electron: {
      file: "tests/e2e/projects.e2e.test.ts",
      pattern: "persists a Project and restores edited bytes without deleting the folder"
    },
    audits: [
      "audit:modules",
      "audit:styles",
      "audit:targets",
      "audit:translations",
      "audit:features"
    ]
  },
  "agent-discovery": {
    unit: [
      "tests/main/settingsStore.test.ts",
      "tests/main/targetDiscovery.test.ts",
      "tests/renderer/agentSetup.test.ts",
      "tests/renderer/AgentSettingsSection.test.tsx",
      "tests/renderer/App.test.tsx"
    ],
    electron: {
      file: "tests/e2e/electronUiProfileSwitching.e2e.test.ts",
      pattern: [
        "offers detected Agents without changing their files until the user enables one",
        "persists enabled Agents and excludes disabled Agents from operations"
      ].join("|")
    },
    audits: [
      "audit:modules",
      "audit:styles",
      "audit:targets",
      "audit:translations",
      "audit:features"
    ]
  }
};
