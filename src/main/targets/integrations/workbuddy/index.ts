import { join } from "node:path";
import type {
  TargetActivationPreview,
  TargetState
} from "../../../../shared/types";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createInstallationDriver } from "../../installationDiscovery";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import { createFilesystemSkillDriver } from "../../shared/skillRuntime";

const DEFAULT_STATE: TargetState = {
  formatVersion: 3,
  managedMcpNames: []
};

const skills = createFilesystemSkillDriver({ targetId: "workbuddy" });
const assets = createDirectoryAssetDriver({ targetName: "WorkBuddy" });

export const workBuddyIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "workbuddy",
    name: "WorkBuddy",
    description: "Manage WorkBuddy user Skills without changing WorkBuddy settings or data.",
    displayOrder: 6,
    instructionsLabel: "Agent controlled",
    configLabel: "Agent controlled",
    configLanguage: "json",
    realWritesEnabled: true,
    executableCandidates: [],
    capabilities: {
      instructions: false,
      skills: true,
      mcpTransports: [],
      disabledSkillPaths: false,
      nativeConfig: false,
      mcpActivation: false,
      evaluation: false,
      evaluationUnavailableReason:
        "WorkBuddy does not expose a verified isolated one-shot runtime for Profile comparison."
    }
  },
  discovery: createInstallationDriver({
    commands: [],
    macApplications: [{
      bundleName: "WorkBuddy.app",
      bundleIdentifier: "com.tencent.workbuddy.mac",
      label: "WorkBuddy.app"
    }]
  }),
  paths: {
    createTargetPaths: ({ homeDir, rootDirOverride }) => {
      const configDir = rootDirOverride ?? join(homeDir, ".workbuddy");
      const skillsDir = join(configDir, "skills");
      return {
        targetId: "workbuddy",
        configDir,
        // WorkBuddy has no documented static Instructions file or AgentEnv-owned
        // native config. Capability-aware callers do not inspect these placeholders.
        instructionsPath: configDir,
        configPath: join(configDir, "settings.json"),
        skillsDir,
        skillLocations: [{
          path: skillsDir,
          role: "preferred-runtime",
          shared: false,
          scope: "user",
          scanDepth: "direct",
          management: "managed"
        }],
        skillScanDirs: [skillsDir]
      };
    }
  },
  skills,
  profile: {
    createDefaultProfile: (id) => ({
      id,
      manifest: {
        id,
        name: "WorkBuddy Profile",
        description: "Reusable WorkBuddy Skills",
        iconKey: "workbuddy",
        preferredTargetId: "workbuddy",
        version: 2
      },
      instructions: "",
      resources: {
        skills: [],
        managementByTarget: {
          workbuddy: { instructions: "ignore", skills: "manage" }
        },
        mcpByTarget: {
          workbuddy: { mode: "ignore", selections: [] }
        }
      }
    }),
    captureProfile: async () => ({
      instructions: "",
      mcpConnections: [],
      warnings: [],
      excluded: []
    })
  },
  preview: {
    createPreview: async ({ state = DEFAULT_STATE }): Promise<TargetActivationPreview> => ({
      issues: [],
      changes: [],
      liveFingerprints: {},
      targetState: {
        ...state,
        formatVersion: 3,
        managedMcpNames: []
      }
    })
  },
  assets
};

export const createWorkBuddyTargetAdapter = () =>
  defineTargetIntegration(workBuddyIntegration);
