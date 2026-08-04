import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileDetail } from "../../../src/shared/types";
import type { AgentTargetIntegration } from "../../../src/main/targets/contract";
import { defineTargetIntegration } from "../../../src/main/targets/defineTargetIntegration";

const readText = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
};

export const fixtureAgentIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "fixture-agent",
    name: "Fixture Agent",
    description: "Contract-test target.",
    iconKey: "generic",
    displayOrder: 99,
    instructionsLabel: "AGENT.md",
    configLabel: "fixture.json",
    configLanguage: "jsonc",
    mcpConfigKey: "mcp",
    realWritesEnabled: true,
    executableName: "fixture-agent",
    executableCandidates: ["fixture-agent"],
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio"],
      disabledSkillPaths: false,
      mcpActivation: true
    }
  },
  discovery: {
    detectInstallation: async (input) => {
      const path = await input.findExecutable("fixture-agent");
      return {
        found: Boolean(path),
        evidence: path ? [{ kind: "command", label: "fixture-agent command", path }] : []
      };
    }
  },
  paths: {
    createTargetPaths: ({ homeDir }) => {
      const configDir = join(homeDir, ".fixture-agent");
      return {
        targetId: "fixture-agent",
        configDir,
        instructionsPath: join(configDir, "AGENT.md"),
        configPath: join(configDir, "fixture.json"),
        skillsDir: join(configDir, "skills")
      };
    }
  },
  profile: {
    createDefaultProfile: (id) => ({
      id,
      manifest: {
        id,
        preferredTargetId: "fixture-agent",
        name: "Fixture Profile",
        description: "Fixture profile",
        version: 2
      },
      instructions: "",
      resources: { skills: [], mcpByTarget: {} }
    }),
    captureProfile: async (targetPaths) => ({
      instructions: await readText(targetPaths.instructionsPath),
      mcpConnections: [],
      warnings: [],
      excluded: []
    })
  },
  preview: {
    createPreview: async () => ({
      changes: [],
      issues: [],
      liveFingerprints: {},
      targetState: { managedMcpNames: [] }
    })
  },
  skills: {
    readNativeState: async () => ({ disabledRuntimeNames: [], issues: [] }),
    inspectRuntime: async (targetPaths) => ({
      targetId: targetPaths.targetId,
      observations: [],
      issues: []
    })
  },
  assets: {
    validateAssets: async () => [],
    getAssetBackupPaths: async () => [],
    applyAssets: async () => undefined
  }
};

export const createFixtureAgentAdapter = () => defineTargetIntegration(fixtureAgentIntegration);

export const createFixtureProfile = (
  profileDir: string,
  overrides: Partial<ProfileDetail> = {}
): ProfileDetail => ({
  ...fixtureAgentIntegration.profile.createDefaultProfile("fixture-profile"),
  profileDir,
  ...overrides
});
