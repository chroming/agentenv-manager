import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  parse,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
import type {
  PlannedFileChange,
  SkillRuntimeIssue,
  TargetActivationPreview,
  TargetPaths,
  TargetSkillLocation,
  TargetState
} from "../../shared/types";
import { profileManagesResource } from "../../shared/profileResources";
import { createApplyIssue } from "../applyIssues";
import { createClaudeConversationCapability } from "./conversations/claudeConversations";
import { createClaudeEvaluationCapability } from "./evaluations/claudeEvaluation";
import { createUnifiedDiff } from "../diff";
import { pathExists, readTextIfExists } from "../fileUtils";
import { findSecretWarnings } from "../secretWarnings";
import { captureNativeJsonMcpConnections } from "./capture";
import { createInstallationDriver } from "./installationDiscovery";
import { createDirectoryAssetDriver } from "./shared/assetDeployment";
import { createFilesystemSkillDriver } from "./shared/skillRuntime";
import type { AgentTargetAdapter } from "./types";

const DEFAULT_STATE: TargetState = {
  formatVersion: 3,
  managedMcpNames: []
};

const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const parseJsoncObject = (
  content: string,
  label: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
  if (content.trim().length === 0) return { ok: true, value: {} };
  const errors: ParseError[] = [];
  const parsed = parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return {
      ok: false,
      message: `${label}: ${errors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`
    };
  }
  return isRecord(parsed)
    ? { ok: true, value: parsed }
    : { ok: false, message: `${label}: expected a JSON object` };
};

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

interface ClaudePluginInstall {
  scope?: string;
  installPath?: string;
  installedAt?: string;
  lastUpdated?: string;
}

const selectedClaudePluginInstall = (
  installs: ClaudePluginInstall[]
): ClaudePluginInstall | undefined => {
  const candidates = installs.some((install) => install.scope === "user")
    ? installs.filter((install) => install.scope === "user")
    : installs;
  return [...candidates].sort((left, right) => {
    const leftUpdated = left.lastUpdated ?? left.installedAt ?? "";
    const rightUpdated = right.lastUpdated ?? right.installedAt ?? "";
    return rightUpdated.localeCompare(leftUpdated) ||
      (right.installPath ?? "").localeCompare(left.installPath ?? "");
  })[0];
};

const discoverClaudePluginSkillLocations = async (
  targetPaths: TargetPaths
): Promise<{ locations: TargetSkillLocation[]; issues: SkillRuntimeIssue[] }> => {
  const issues: SkillRuntimeIssue[] = [];
  const issue = (message: string): SkillRuntimeIssue => ({
    code: "unreadable-native-state",
    severity: "warning",
    message
  });
  let settingsText: string;
  try {
    settingsText = await readTextIfExists(targetPaths.configPath);
  } catch (error) {
    return {
      locations: [],
      issues: [issue(
        `Claude Code plugin discovery could not read settings.json: ${error instanceof Error ? error.message : String(error)}`
      )]
    };
  }
  const settings = parseJsoncObject(settingsText, "Invalid live settings.json");
  if (!settings.ok) return { locations: [], issues: [issue(settings.message)] };
  if (!isRecord(settings.value.enabledPlugins)) return { locations: [], issues };

  const installedPath = join(targetPaths.configDir, "plugins", "installed_plugins.json");
  let installedText: string;
  try {
    installedText = await readTextIfExists(installedPath);
  } catch (error) {
    return {
      locations: [],
      issues: [issue(
        `Claude Code plugin discovery could not read installed_plugins.json: ${error instanceof Error ? error.message : String(error)}`
      )]
    };
  }
  const installed = parseJsoncObject(installedText, "Invalid Claude Code installed_plugins.json");
  if (!installed.ok) return { locations: [], issues: [issue(installed.message)] };
  if (!isRecord(installed.value.plugins)) return { locations: [], issues };

  const roots = new Map<string, TargetSkillLocation>();
  const enabledPluginIds = Object.entries(settings.value.enabledPlugins)
    .filter(([, enabled]) => enabled === true)
    .map(([pluginId]) => pluginId)
    .sort();
  for (const pluginId of enabledPluginIds) {
    const rawInstalls = installed.value.plugins[pluginId];
    if (!Array.isArray(rawInstalls)) continue;
    const install = selectedClaudePluginInstall(
      rawInstalls.filter(isRecord).map((item) => ({
        scope: typeof item.scope === "string" ? item.scope : undefined,
        installPath: typeof item.installPath === "string" ? item.installPath : undefined,
        installedAt: typeof item.installedAt === "string" ? item.installedAt : undefined,
        lastUpdated: typeof item.lastUpdated === "string" ? item.lastUpdated : undefined
      }))
    );
    if (!install?.installPath) continue;
    for (const path of [
      join(install.installPath, "skills"),
      join(install.installPath, ".claude", "skills")
    ]) {
      try {
        if (!(await pathExists(path))) continue;
      } catch (error) {
        issues.push(issue(
          `Claude Code plugin Skill location is unreadable: ${path}: ${error instanceof Error ? error.message : String(error)}`
        ));
        continue;
      }
      roots.set(path, {
        path,
        role: "discovery-only",
        shared: false,
        scope: "user",
        scanDepth: "recursive",
        management: "observed",
        externalContainerMarkers: [{
          relativePath: ".claude-plugin/plugin.json",
          manager: "claude-plugin",
          displayName: "Claude Code plugin",
          importable: false
        }]
      });
    }
  }
  return { locations: [...roots.values()], issues };
};

const assets = createDirectoryAssetDriver({ targetName: "Claude Code" });
const skills = createFilesystemSkillDriver({
  targetId: "claude-code",
  discoverLocations: discoverClaudePluginSkillLocations
});

export const createClaudeCodeTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "claude-code",
    name: "Claude Code",
    description: "Manage Claude Code instructions and Skills.",
    iconKey: "claude",
    displayOrder: 2,
    instructionsLabel: "CLAUDE.md",
    configLabel: "settings.json",
    configLanguage: "jsonc",
    mcpConfigKey: "mcpServers",
    realWritesEnabled: true,
    executableName: "claude",
    executableCandidates: ["claude"],
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      agentFormat: "claude-code",
      disabledSkillPaths: false,
      mcpActivation: false,
      evaluation: true
    }
  },
  detectInstallation: createInstallationDriver({
    commands: ["claude"],
    macApplications: [{ bundleName: "Claude.app", label: "Claude app" }]
  }).detectInstallation,
  createTargetPaths: ({ homeDir, rootDirOverride }) => {
    const claudeDir = rootDirOverride ?? join(homeDir, ".claude");
    const skillsDir = join(claudeDir, "skills");
    return {
      targetId: "claude-code",
      configDir: claudeDir,
      instructionsPath: join(claudeDir, "CLAUDE.md"),
      configPath: join(claudeDir, "settings.json"),
      mcpConfigPath: join(homeDir, ".claude.json"),
      skillsDir,
      skillLocations: [{
        path: skillsDir,
        role: "preferred-runtime",
        shared: false,
        scope: "user",
        scanDepth: "direct",
        management: "managed",
        externalContainerMarkers: [{
          relativePath: ".claude-plugin/plugin.json",
          manager: "claude-plugin",
          displayName: "Claude Code plugin",
          importable: false
        }]
      }],
      skillScanDirs: [skillsDir]
    };
  },
  skills,
  conversations: createClaudeConversationCapability(),
  evaluations: createClaudeEvaluationCapability(),
  createDefaultProfile: (id) => ({
    id,
    manifest: {
      id,
      name: "Claude Code Daily Coding",
      description: "Default coding environment",
      preferredTargetId: "claude-code",
      version: 2
    },
    instructions:
      "# Agent Guidance\n\n- Keep changes scoped and reversible.\n- Preview environment changes before applying them.\n",
    resources: { skills: [], mcpByTarget: {} }
  }),
  captureProfile: async (targetPaths) => {
    const [instructions, settingsText, mcpText] = await Promise.all([
      readTextIfExists(targetPaths.instructionsPath),
      readTextIfExists(targetPaths.configPath),
      readTextIfExists(targetPaths.mcpConfigPath ?? "")
    ]);
    const settings = parseJsoncObject(settingsText, "Invalid live settings.json");
    const mcpConfig = parseJsoncObject(mcpText, "Invalid live .claude.json");
    if (!settings.ok) throw new Error(settings.message);
    if (!mcpConfig.ok) throw new Error(mcpConfig.message);
    const liveMcp = isRecord(mcpConfig.value.mcpServers)
      ? mcpConfig.value.mcpServers
      : {};
    const mcpConnections = captureNativeJsonMcpConnections(liveMcp, {
      targetId: "claude-code",
      sourcePath: targetPaths.mcpConfigPath ?? targetPaths.configPath,
      controllable: false
    });
    const excluded = [
      ...Object.keys(settings.value).map((key) => `settings.json.${key}`),
      ...(Object.keys(liveMcp).length > 0 ? [".claude.json.mcpServers"] : [])
    ];
    return {
      instructions,
      mcpConnections,
      warnings: excluded.length > 0
        ? ["Claude Code settings and MCP definitions remain Agent-owned"]
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
          resourceKind: "instructions",
          message
        })
    );
    const changes: PlannedFileChange[] = [];
    const liveInstructions = managesInstructions
      ? await readTextIfExists(targetPaths.instructionsPath)
      : "";
    if (managesInstructions) {
      addChange(changes, targetPaths.instructionsPath, liveInstructions, profile.instructions);
    }
    if (profile.resources.mcpByTarget["claude-code"]?.mode === "manage") {
      issues.push(createApplyIssue({
        code: "unsupported-mcp-management",
        resourceKind: "mcp",
        message: "Claude Code MCP activation is Agent-controlled. Set this Profile to Ignore MCPs for Claude Code."
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
  },
  ...assets
});
