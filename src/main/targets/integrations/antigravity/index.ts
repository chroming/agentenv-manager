import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  PlannedFileChange,
  TargetActivationPreview,
  TargetState
} from "../../../../shared/types";
import { createUnifiedDiff } from "../../../diff";
import { readTextIfExists } from "../../../fileUtils";
import { findSecretWarnings } from "../../../secretWarnings";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createAntigravityInstallationDriver } from "../../installationDiscovery";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import { createProfileFileDriver } from "../../shared/profileFiles";
import { createFilesystemSkillDriver } from "../../shared/skillRuntime";
import { captureNativeJsonMcpConnections } from "../../capture";

const DEFAULT_STATE: TargetState = {
  managedConfigKeys: [],
  managedMcpNames: []
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const hashText = (content: string) =>
  createHash("sha256").update(content).digest("hex");

const parseJsonObject = (
  content: string,
  label: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
  try {
    const parsed = JSON.parse(content.trim() || "{}");
    return isRecord(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, message: `${label}: expected a JSON object` };
  } catch (error) {
    return {
      ok: false,
      message: `${label}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
};

const addChange = (
  changes: PlannedFileChange[],
  path: string,
  before: string,
  after: string
) => {
  if (before === after) return;
  changes.push({ path, before, after, diff: createUnifiedDiff(path, before, after) });
};

const profileFiles = createProfileFileDriver({
  instructionsFile: "GEMINI.md",
  configFile: "mcp_config.json"
});

const assets = createDirectoryAssetDriver({ targetName: "Antigravity" });
const skills = createFilesystemSkillDriver({ targetId: "antigravity" });

export const antigravityIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "antigravity",
    name: "Antigravity CLI",
    description: "Manage global Antigravity CLI rules, MCPs, and skills.",
    iconKey: "antigravity",
    displayOrder: 3,
    instructionsLabel: "GEMINI.md",
    configLabel: "mcp_config.json",
    configLanguage: "json",
    mcpConfigKey: "mcpServers",
    realWritesEnabled: true,
    executableName: "agy",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      disabledSkillPaths: false,
      nativeConfig: false,
      mcpEnvironmentReferences: false,
      mcpActivation: false
    }
  },
  discovery: createAntigravityInstallationDriver(),
  paths: {
    createTargetPaths: ({ homeDir }) => {
      const geminiDir = join(homeDir, ".gemini");
      const configDir = join(geminiDir, "config");
      const cliSkillsDir = join(geminiDir, "antigravity-cli", "skills");
      const sharedSkillsDir = join(geminiDir, "skills");
      const legacySkillsDir = join(configDir, "skills");
      return {
        targetId: "antigravity",
        configDir,
        instructionsPath: join(geminiDir, "GEMINI.md"),
        configPath: join(configDir, "mcp_config.json"),
        skillsDir: cliSkillsDir,
        skillLocations: [
          {
            path: cliSkillsDir,
            role: "preferred-runtime",
            shared: false,
            scope: "user",
            scanDepth: "direct",
            management: "managed"
          },
          {
            path: sharedSkillsDir,
            role: "compatibility-runtime",
            shared: true,
            scope: "shared",
            scanDepth: "direct",
            management: "observed"
          },
          {
            path: legacySkillsDir,
            role: "discovery-only",
            shared: false,
            scope: "user",
            scanDepth: "direct",
            management: "legacy"
          }
        ],
        skillScanDirs: [cliSkillsDir, sharedSkillsDir, legacySkillsDir]
      };
    }
  },
  skills,
  profile: {
    createDefaultProfile: (id) => ({
      id,
      manifest: {
        id,
        targetId: "antigravity",
        name: "Antigravity Profile",
        description: "Antigravity rules, MCPs, and skills",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      },
      instructions: "# Antigravity Guidance\n\n- Keep changes scoped and reversible.\n",
      configText: "{\n  \"mcpServers\": {}\n}\n",
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    }),
    captureProfile: async (targetPaths) => {
      const [instructions, configText] = await Promise.all([
        readTextIfExists(targetPaths.instructionsPath),
        readTextIfExists(targetPaths.configPath)
      ]);
      const parsed = parseJsonObject(configText, "Invalid live Antigravity MCP config");
      if (!parsed.ok) throw new Error(parsed.message);
      const mcpConnections = captureNativeJsonMcpConnections(
        parsed.value.mcpServers,
        {
          targetId: "antigravity",
          sourcePath: targetPaths.configPath,
          controllable: false
        }
      );
      const rootKeys = Object.keys(parsed.value).filter(
        (key) => key !== "mcpServers"
      );
      return {
        instructions,
        configText: '{\n  "mcpServers": {}\n}\n',
        mcpServers: [],
        mcpConnections,
        disabledSkillPaths: [],
        warnings: [],
        excluded: rootKeys.map((key) => `mcp_config.json.${key}`)
      };
    },
    ...profileFiles
  },
  config: {
    hasMeaningfulNativeConfig: (configText) => {
      const parsed = parseJsonObject(configText, "Invalid Antigravity Profile config");
      return !parsed.ok || Object.keys(parsed.value).some((key) => key !== "mcpServers");
    },
    createPreview: async ({
      profile,
      targetPaths,
      state = DEFAULT_STATE,
      allowMatchingUnmanagedConfig
    }): Promise<TargetActivationPreview> => {
      const warnings = findSecretWarnings(profile.instructions).concat(
        findSecretWarnings(profile.configText)
      );
      const errors: string[] = [];
      const changes: PlannedFileChange[] = [];
      const [liveInstructions, liveConfigText] = await Promise.all([
        readTextIfExists(targetPaths.instructionsPath),
        readTextIfExists(targetPaths.configPath)
      ]);
      if (profile.manifest.managed.instructions && [...profile.instructions].length > 12_000) {
        errors.push("Antigravity GEMINI.md exceeds the 12,000 character limit");
      }
      if (profile.manifest.managed.instructions) {
        addChange(changes, targetPaths.instructionsPath, liveInstructions, profile.instructions);
      }

      const liveConfig = parseJsonObject(
        liveConfigText,
        "Invalid live Antigravity MCP config"
      );
      if (!liveConfig.ok) {
        warnings.push(
          `${liveConfig.message}; MCP selections remain Antigravity-controlled`
        );
      }
      const liveServers =
        liveConfig.ok && isRecord(liveConfig.value.mcpServers)
          ? liveConfig.value.mcpServers
          : {};
      for (const selection of (profile.assetPolicy.mcpSelections ?? []).filter(
        (item) => item.targetId === "antigravity"
      )) {
        if (!(selection.name in liveServers)) {
          warnings.push(
            `MCP server ${selection.name} is not configured in Antigravity; set it up in Antigravity`
          );
        }
      }

      return {
        warnings,
        errors,
        changes,
        liveFingerprints: {
          ...(profile.manifest.managed.instructions
            ? { [targetPaths.instructionsPath]: hashText(liveInstructions) }
            : {})
        },
        targetState: {
          managedConfigKeys: [],
          managedMcpNames: []
        }
      };
    }
  },
  mcp: { materializeMcpRefs: (profile) => profile },
  assets
};

export const createAntigravityTargetAdapter = () =>
  defineTargetIntegration(antigravityIntegration);
