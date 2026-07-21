import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  PlannedFileChange,
  TargetActivationPreview,
  TargetState
} from "../../../../shared/types";
import { profileManagesResource } from "../../../../shared/profileResources";
import { createApplyIssue } from "../../../applyIssues";
import { createUnifiedDiff } from "../../../diff";
import { readTextIfExists } from "../../../fileUtils";
import { findSecretWarnings } from "../../../secretWarnings";
import { captureNativeJsonMcpConnections } from "../../capture";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createAntigravityInstallationDriver } from "../../installationDiscovery";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import { createFilesystemSkillDriver } from "../../shared/skillRuntime";

const DEFAULT_STATE: TargetState = {
  formatVersion: 2,
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

const assets = createDirectoryAssetDriver({ targetName: "Antigravity" });
const skills = createFilesystemSkillDriver({ targetId: "antigravity" });

export const antigravityIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "antigravity",
    name: "Antigravity CLI",
    description: "Manage Antigravity instructions and Skills.",
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
        name: "Antigravity Profile",
        description: "Default coding environment",
        preferredTargetId: "antigravity",
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
      const excluded = Object.keys(parsed.value).map(
        (key) => `mcp_config.json.${key}`
      );
      return {
        instructions,
        mcpConnections,
        warnings: excluded.length > 0
          ? ["Antigravity MCP configuration remains Agent-owned"]
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
            disposition: "notice",
            resolution: "automatic",
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
          disposition: "block",
          resolution: "edit-profile",
          resourceKind: "instructions",
          path: targetPaths.instructionsPath,
          message: "Antigravity GEMINI.md exceeds the 12,000 character limit"
        }));
      }
      if (managesInstructions) {
        addChange(changes, targetPaths.instructionsPath, liveInstructions, profile.instructions);
      }
      if (profile.resources.mcpByTarget.antigravity?.mode === "manage") {
        issues.push(createApplyIssue({
          code: "unsupported-mcp-management",
          disposition: "block",
          resolution: "edit-profile",
          resourceKind: "mcp",
          message: "Antigravity MCP activation is Agent-controlled. Set this Profile to Ignore MCPs for Antigravity."
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
          formatVersion: 2,
          managedMcpNames: []
        }
      };
    }
  },
  assets
};

export const createAntigravityTargetAdapter = () =>
  defineTargetIntegration(antigravityIntegration);
