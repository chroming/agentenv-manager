import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  PlannedFileChange,
  TargetActivationPreview,
  TargetState
} from "../../../../shared/types";
import { profileManagesResource } from "../../../../shared/profileResources";
import { createApplyIssue } from "../../../applyIssues";
import { createProjectCapability } from "../../../projects/projectCapability";
import { createAntigravityConversationCapability } from "../../conversations/antigravityConversations";
import { createUnifiedDiff } from "../../../diff";
import { readTextIfExists } from "../../../fileUtils";
import { findSecretWarnings } from "../../../secretWarnings";
import { captureNativeJsonMcpConnections } from "../../capture";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createInstallationDriver } from "../../installationDiscovery";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import { createFilesystemSkillDriver } from "../../shared/skillRuntime";

const DEFAULT_STATE: TargetState = {
  formatVersion: 3,
  managedMcpNames: []
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

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

const hashText = (content: string) =>
  createHash("sha256").update(content).digest("hex");

const addChange = (
  changes: PlannedFileChange[],
  path: string,
  before: string,
  after: string
) => {
  if (before === after) return;
  changes.push({ path, before, after, diff: createUnifiedDiff(path, before, after) });
};

const assets = createDirectoryAssetDriver({ targetName: "Antigravity Client" });
const skills = createFilesystemSkillDriver({ targetId: "antigravity-client" });

export const antigravityClientIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "antigravity-client",
    name: "Antigravity Client",
    description: "Manage Antigravity Desktop App instructions, Skills, and MCP configuration.",
    iconKey: "antigravity",
    displayOrder: 4,
    instructionsLabel: "GEMINI.md",
    configLabel: "mcp_config.json",
    configLanguage: "json",
    mcpConfigKey: "mcpServers",
    realWritesEnabled: true,
    executableName: "Antigravity",
    executableCandidates: ["Antigravity", "antigravity"],
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      disabledSkillPaths: false,
      mcpActivation: false,
      evaluation: false,
      evaluationUnavailableReason: "Antigravity Client is an interactive desktop application, so isolated one-shot comparison is unavailable."
    }
  },
  discovery: createInstallationDriver({
    commands: ["antigravity"],
    macApplications: [
      {
        bundleName: "Antigravity.app",
        bundleIdentifier: "com.google.antigravity",
        label: "Antigravity.app",
        bundledExecutable: {
          relativePath: "Contents/MacOS/Antigravity",
          label: "Antigravity executable"
        }
      }
    ]
  }),
  paths: {
    createTargetPaths: ({ homeDir, rootDirOverride }) => {
      const geminiDir = rootDirOverride ?? join(homeDir, ".gemini");
      const configDir = join(geminiDir, "antigravity");
      const clientSkillsDir = join(geminiDir, "skills");
      const cliSkillsDir = join(geminiDir, "antigravity-cli", "skills");
      const legacySkillsDir = join(geminiDir, "config", "skills");
      return {
        targetId: "antigravity-client",
        configDir,
        instructionsPath: join(geminiDir, "GEMINI.md"),
        configPath: join(configDir, "mcp_config.json"),
        skillsDir: clientSkillsDir,
        skillLocations: [
          {
            path: clientSkillsDir,
            role: "preferred-runtime",
            shared: false,
            scope: "user",
            scanDepth: "direct",
            management: "managed"
          },
          {
            path: cliSkillsDir,
            role: "compatibility-runtime",
            shared: false,
            scope: "user",
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
        skillScanDirs: [clientSkillsDir, cliSkillsDir, legacySkillsDir]
      };
    }
  },
  skills,
  projects: createProjectCapability({
    support: {
      instructions: { inspect: "supported", mutate: "supported" },
      skills: { inspect: "partial", mutate: "unsupported" },
      mcp: { inspect: "unsupported", mutate: "unsupported" },
      effectivePreview: "partial",
      cliLaunch: "supported"
    },
    instructionFiles: ["GEMINI.md", "AGENTS.md"],
    instructionCreateFile: "GEMINI.md",
    skillLocations: [
      { relativePath: ".agents/skills", scope: "shared", writable: false, priority: 100 },
      { relativePath: ".gemini/skills", scope: "agent-specific", writable: false, priority: 50 }
    ],
    mcpFiles: [],
    compareResourcePaths: ["GEMINI.md", ".gemini", ".agents"]
  }),
  profile: {
    createDefaultProfile: (id) => ({
      id,
      manifest: {
        id,
        name: "Antigravity Client Profile",
        description: "Default Antigravity Client environment",
        preferredTargetId: "antigravity-client",
        version: 2
      },
      instructions: "# Agent Guidance\n\n- Keep changes scoped and reversible.\n",
      resources: { skills: [], mcpByTarget: {} }
    }),
    captureProfile: async (targetPaths) => {
      const [instructions, configText] = await Promise.all([
        readTextIfExists(targetPaths.instructionsPath),
        readTextIfExists(targetPaths.configPath)
      ]);
      const parsed = parseJsonObject(configText, "Invalid live Antigravity Client MCP config");
      if (!parsed.ok) throw new Error(parsed.message);
      const mcpConnections = captureNativeJsonMcpConnections(
        parsed.value.mcpServers,
        {
          targetId: "antigravity-client",
          sourcePath: targetPaths.configPath,
          controllable: false
        }
      );
      const excluded = Object.keys(parsed.value).map(
        (key) => `mcp_config.json.${key}`
      );
      return {
        instructions,
        mcpConnections,
        warnings: excluded.length > 0
          ? ["Antigravity Client MCP configuration remains Agent-owned"]
          : [],
        excluded
      };
    }
  },
  preview: {
    createPreview: async ({
      profile,
      targetPaths,
      state = DEFAULT_STATE
    }): Promise<TargetActivationPreview> => {
      const managesInstructions = profileManagesResource(
        profile.resources,
        targetPaths.targetId,
        "instructions"
      );
      const issues = (managesInstructions ? findSecretWarnings(profile.instructions) : []).map(
        (message) =>
          createApplyIssue({
            code: "secret-warning",
            resourceKind: "instructions",
            message
          })
      );
      const changes: PlannedFileChange[] = [];
      const liveInstructions = managesInstructions
        ? await readTextIfExists(targetPaths.instructionsPath)
        : "";
      if (managesInstructions && [...profile.instructions].length > 12_000) {
        issues.push(createApplyIssue({
          code: "target-instruction-limit",
          resourceKind: "instructions",
          path: targetPaths.instructionsPath,
          message: "Antigravity GEMINI.md exceeds the 12,000 character limit"
        }));
      }
      if (managesInstructions) {
        addChange(changes, targetPaths.instructionsPath, liveInstructions, profile.instructions);
      }
      if (profile.resources.mcpByTarget["antigravity-client"]?.mode === "manage") {
        issues.push(createApplyIssue({
          code: "unsupported-mcp-management",
          resourceKind: "mcp",
          message: "Antigravity Client MCP activation is Agent-controlled. Set this Profile to Ignore MCPs for Antigravity Client."
        }));
      }
      return {
        issues,
        changes,
        liveFingerprints: {
          ...(managesInstructions
            ? { [targetPaths.instructionsPath]: hashText(liveInstructions) }
            : {})
        },
        targetState: {
          ...state,
          formatVersion: 3,
          managedMcpNames: []
        }
      };
    }
  },
  conversations: createAntigravityConversationCapability({
    targetId: "antigravity-client",
    targetName: "Antigravity Client",
    appDataSubdir: "antigravity",
    isDesktopApp: true
  }),
  assets
};

export const createAntigravityClientTargetAdapter = () =>
  defineTargetIntegration(antigravityClientIntegration);
