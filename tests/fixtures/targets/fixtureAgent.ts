import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    instructionsLabel: "AGENT.md",
    configLabel: "fixture.json",
    configLanguage: "jsonc",
    realWritesEnabled: true,
    executableName: "fixture-agent",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio"],
      disabledSkillPaths: false
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
        targetId: "fixture-agent",
        name: "Fixture Profile",
        description: "Fixture profile",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      },
      instructions: "",
      configText: "{}\n",
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    }),
    captureProfile: async (targetPaths) => ({
      instructions: await readText(targetPaths.instructionsPath),
      configText: await readText(targetPaths.configPath),
      mcpServers: [],
      disabledSkillPaths: [],
      warnings: [],
      excluded: []
    }),
    readProfileFiles: async (profileDir, manifest) => ({
      id: manifest.id,
      profileDir,
      manifest,
      instructions: await readText(join(profileDir, "AGENT.md")),
      configText: await readText(join(profileDir, "fixture.json")),
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    }),
    writeProfileFiles: async (profileDir, profile) => {
      await mkdir(profileDir, { recursive: true });
      await writeFile(
        join(profileDir, "AGENT.md"),
        profile.instructions,
        "utf8"
      );
      await writeFile(
        join(profileDir, "fixture.json"),
        profile.configText,
        "utf8"
      );
    }
  },
  config: {
    createPreview: async () => ({
      changes: [],
      warnings: [],
      errors: [],
      liveFingerprints: {},
      targetState: { managedConfigKeys: [], managedMcpNames: [] }
    })
  },
  assets: {
    validateAssets: async () => [],
    getAssetBackupPaths: async () => [],
    applyAssets: async () => undefined
  }
};

export const createFixtureAgentAdapter = () =>
  defineTargetIntegration(fixtureAgentIntegration);

export const createFixtureProfile = (
  profileDir: string,
  overrides: Partial<ProfileDetail> = {}
): ProfileDetail => ({
  ...fixtureAgentIntegration.profile.createDefaultProfile("fixture-profile"),
  profileDir,
  ...overrides
});
