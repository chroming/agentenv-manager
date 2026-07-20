import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  parse,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
import type {
  PlannedFileChange,
  TargetActivationPreview,
  TargetState
} from "../../shared/types";
import { profileManagesResource } from "../../shared/profileResources";
import { createUnifiedDiff } from "../diff";
import { readTextIfExists } from "../fileUtils";
import { findSecretWarnings } from "../secretWarnings";
import { captureNativeJsonMcpConnections } from "./capture";
import { createCommandInstallationDriver } from "./installationDiscovery";
import { createDirectoryAssetDriver } from "./shared/assetDeployment";
import { createFilesystemSkillDriver } from "./shared/skillRuntime";
import type { AgentTargetAdapter } from "./types";

const DEFAULT_STATE: TargetState = {
  formatVersion: 2,
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

const assets = createDirectoryAssetDriver({ targetName: "Claude Code" });
const skills = createFilesystemSkillDriver({ targetId: "claude-code" });

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
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      agentFormat: "claude-code",
      disabledSkillPaths: false,
      mcpActivation: false
    }
  },
  detectInstallation: createCommandInstallationDriver("claude").detectInstallation,
  createTargetPaths: ({ homeDir }) => {
    const claudeDir = join(homeDir, ".claude");
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
    const warnings = managesInstructions ? findSecretWarnings(profile.instructions) : [];
    const errors: string[] = [];
    const changes: PlannedFileChange[] = [];
    const liveInstructions = managesInstructions
      ? await readTextIfExists(targetPaths.instructionsPath)
      : "";
    if (managesInstructions) {
      addChange(changes, targetPaths.instructionsPath, liveInstructions, profile.instructions);
    }
    if (profile.resources.mcpByTarget["claude-code"]?.mode === "manage") {
      errors.push(
        "Claude Code MCP activation is Agent-controlled. Set this Profile to Ignore MCPs for Claude Code."
      );
    }
    return {
      warnings,
      errors,
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
  },
  ...assets
});
