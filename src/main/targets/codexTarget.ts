import { createHash } from "node:crypto";
import { join } from "node:path";
import * as TOML from "@iarna/toml";
import type {
  PlannedFileChange,
  TargetActivationPreview,
  TargetState
} from "../../shared/types";
import { profileManagesResource } from "../../shared/profileResources";
import { createApplyIssue } from "../applyIssues";
import { createUnifiedDiff } from "../diff";
import { pathExists, readTextIfExists } from "../fileUtils";
import { findSecretWarnings } from "../secretWarnings";
import { setMcpServerEnabled, validateToml } from "../tomlConfig";
import { createInstallationDriver } from "./installationDiscovery";
import { createDirectoryAssetDriver } from "./shared/assetDeployment";
import { createFilesystemSkillDriver } from "./shared/skillRuntime";
import type { AgentTargetAdapter } from "./types";

const DEFAULT_STATE: TargetState = {
  formatVersion: 2,
  managedMcpNames: []
};

const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const addChange = (
  changes: PlannedFileChange[],
  path: string,
  before: string,
  after: string
) => {
  if (before === after) return;
  changes.push({
    path,
    before,
    after,
    diff: createUnifiedDiff(path, before, after)
  });
};

const assets = createDirectoryAssetDriver({ targetName: "Codex" });
const skills = createFilesystemSkillDriver({ targetId: "codex" });

export const createCodexTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "codex",
    name: "Codex",
    description: "Manage Codex instructions, Skills, and MCP activation.",
    iconKey: "codex",
    displayOrder: 1,
    instructionsLabel: "AGENTS.md",
    configLabel: "config.toml",
    configLanguage: "toml",
    mcpConfigKey: "mcp_servers",
    realWritesEnabled: true,
    executableName: "codex",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      agentFormat: "codex",
      disabledSkillPaths: false,
      mcpActivation: true
    }
  },
  detectInstallation: createInstallationDriver({
    commands: ["codex"],
    macApplications: [{ bundleName: "Codex.app", label: "Codex app" }]
  }).detectInstallation,
  createTargetPaths: ({ homeDir, rootDirOverride }) => {
    const codexHome = rootDirOverride ?? join(homeDir, ".codex");
    const skillsDir = join(codexHome, "skills");
    const sharedSkillsDir = join(homeDir, ".agents", "skills");
    return {
      targetId: "codex",
      configDir: codexHome,
      instructionsPath: join(codexHome, "AGENTS.md"),
      instructionsOverridePath: join(codexHome, "AGENTS.override.md"),
      configPath: join(codexHome, "config.toml"),
      skillsDir,
      skillLocations: [
        {
          path: skillsDir,
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
          scanDepth: "recursive",
          management: "legacy"
        }
      ],
      skillScanDirs: [skillsDir, sharedSkillsDir]
    };
  },
  skills,
  createDefaultProfile: (id) => ({
    id,
    manifest: {
      id,
      name: "Codex Daily Coding",
      description: "Default coding environment",
      preferredTargetId: "codex",
      version: 2
    },
    instructions:
      "# Agent Guidance\n\n- Keep changes scoped and reversible.\n- Preview environment changes before applying them.\n",
    resources: { skills: [], mcpByTarget: {} }
  }),
  captureProfile: async (targetPaths) => {
    const [instructions, configText] = await Promise.all([
      readTextIfExists(targetPaths.instructionsPath),
      readTextIfExists(targetPaths.configPath)
    ]);
    let parsed: Record<string, unknown>;
    try {
      parsed = TOML.parse(configText || "") as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Invalid live config.toml: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const rawServers =
      parsed.mcp_servers &&
      typeof parsed.mcp_servers === "object" &&
      !Array.isArray(parsed.mcp_servers)
        ? (parsed.mcp_servers as Record<string, unknown>)
        : {};
    const mcpConnections = Object.entries(rawServers)
      .filter(([, raw]) => Boolean(raw && typeof raw === "object" && !Array.isArray(raw)))
      .map(([name, raw]) => {
        const server = raw as Record<string, unknown>;
        const type = typeof server.type === "string" ? server.type.toLowerCase() : undefined;
        return {
          targetId: "codex",
          name,
          scope: "user" as const,
          transport:
            typeof server.command === "string"
              ? ("stdio" as const)
              : type === "sse"
                ? ("sse" as const)
                : typeof server.url === "string"
                  ? ("http" as const)
                  : undefined,
          enabled: server.enabled !== false,
          controllable: true,
          sourcePath: targetPaths.configPath
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const excluded = Object.keys(parsed)
      .filter((key) => key !== "mcp_servers")
      .map((key) => `config.toml.${key}`);
    return {
      instructions,
      mcpConnections,
      warnings: excluded.length > 0
        ? ["Codex native settings remain Agent-owned"]
        : [],
      excluded
    };
  },
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
    if (
      managesInstructions &&
      targetPaths.instructionsOverridePath &&
      await pathExists(targetPaths.instructionsOverridePath)
    ) {
      issues.push(createApplyIssue({
        code: "instruction-alias",
        disposition: "notice",
        resolution: "preserve",
        resourceKind: "instructions",
        path: targetPaths.instructionsOverridePath,
        message: `${targetPaths.instructionsOverridePath} exists and may override AGENTS.md`
      }));
    }
    if (managesInstructions) {
      addChange(changes, targetPaths.instructionsPath, liveInstructions, profile.instructions);
    }

    const policy = profile.resources.mcpByTarget.codex ?? {
      mode: "ignore" as const,
      selections: []
    };
    let managedMcpNames: string[] = [];
    let liveConfig = "";
    if (policy.mode === "manage" && policy.selections.length > 0) {
      liveConfig = await readTextIfExists(targetPaths.configPath);
      const validation = validateToml(liveConfig);
      if (!validation.ok) {
        issues.push(createApplyIssue({
          code: "invalid-native-config",
          disposition: "block",
          resolution: "external-action",
          resourceKind: "configuration",
          path: targetPaths.configPath,
          message: `Invalid live config.toml: ${validation.message}`
        }));
      } else {
        let nextConfig = liveConfig;
        const controlled = new Set<string>();
        for (const selection of policy.selections) {
          const result = setMcpServerEnabled(
            nextConfig,
            selection.name,
            selection.enabled
          );
          if (!result.found) {
            if (selection.enabled) {
              issues.push(createApplyIssue({
                code: "missing-native-mcp",
                disposition: "block",
                resolution: "edit-profile",
                resourceKind: "mcp",
                resourceId: selection.name,
                path: targetPaths.configPath,
                message: `MCP server ${selection.name} is not configured in Codex. Turn it off in this Profile or configure it in Codex.`
              }));
            }
            continue;
          }
          nextConfig = result.content;
          controlled.add(selection.name);
        }
        if (!issues.some((issue) => issue.disposition === "block")) {
          managedMcpNames = [...controlled].sort();
          addChange(changes, targetPaths.configPath, liveConfig, nextConfig);
        }
      }
    }

    return {
      issues,
      changes,
      liveFingerprints: {
        ...(managesInstructions
          ? { [targetPaths.instructionsPath]: hashText(liveInstructions) }
          : {}),
        ...(policy.mode === "manage" && policy.selections.length > 0
          ? { [targetPaths.configPath]: hashText(liveConfig) }
          : {})
      },
      targetState: {
        ...state,
        formatVersion: 2,
        managedMcpNames
      }
    };
  },
  ...assets
});
