export const featureTestGroups = {
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
