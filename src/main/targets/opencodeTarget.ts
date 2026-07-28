import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  applyEdits,
  modify,
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
import { createApplyIssue } from "../applyIssues";
import { createOpenCodeConversationCapability } from "./conversations/opencodeConversations";
import { createUnifiedDiff } from "../diff";
import { readTextIfExists } from "../fileUtils";
import { findSecretWarnings } from "../secretWarnings";
import { captureNativeJsonMcpConnections } from "./capture";
import { createInstallationDriver } from "./installationDiscovery";
import { createDirectoryAssetDriver } from "./shared/assetDeployment";
import { createFilesystemSkillDriver } from "./shared/skillRuntime";
import type { AgentTargetAdapter } from "./types";

const DEFAULT_STATE: TargetState = {
  formatVersion: 2,
  managedMcpNames: []
};

const formattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n"
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

const setJsoncProperty = (content: string, path: string[], value: unknown) => {
  const source = content.trim().length === 0 ? "{}\n" : content;
  return applyEdits(
    source,
    modify(source, path, value, {
      formattingOptions,
      getInsertionIndex: (properties) => properties.length
    })
  );
};

const openCodeMcpLayout = (value: Record<string, unknown>) => {
  const mcp = isRecord(value.mcp) ? value.mcp : {};
  if (isRecord(mcp.servers)) {
    return {
      servers: mcp.servers,
      propertyPathFor: (name: string) => ["mcp", "servers", name, "disabled"],
      propertyValueFor: (enabled: boolean) => !enabled
    };
  }
  return {
    servers: mcp,
    propertyPathFor: (name: string) => ["mcp", name, "enabled"],
    propertyValueFor: (enabled: boolean) => enabled
  };
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

const assets = createDirectoryAssetDriver({ targetName: "OpenCode" });
const skills = createFilesystemSkillDriver({ targetId: "opencode" });

export const createOpenCodeTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "opencode",
    name: "OpenCode",
    description: "Manage OpenCode instructions, Skills, and MCP activation.",
    iconKey: "opencode",
    displayOrder: 0,
    defaultProfileId: "opencode-daily-coding",
    instructionsLabel: "AGENTS.md",
    configLabel: "opencode.jsonc",
    configLanguage: "jsonc",
    mcpConfigKey: "mcp",
    realWritesEnabled: true,
    executableName: "opencode",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      agentFormat: "opencode",
      disabledSkillPaths: false,
      mcpActivation: true
    }
  },
  detectInstallation: createInstallationDriver({
    commands: ["opencode"],
    macApplications: [{ bundleName: "OpenCode.app", label: "OpenCode app" }]
  }).detectInstallation,
  createTargetPaths: ({ homeDir, rootDirOverride }) => {
    const configDir = rootDirOverride ?? join(homeDir, ".config", "opencode");
    const privateSkillsDir = join(configDir, "skills");
    const sharedSkillsDir = join(homeDir, ".agents", "skills");
    return {
      targetId: "opencode",
      configDir,
      instructionsPath: join(configDir, "AGENTS.md"),
      configPath: join(configDir, "opencode.jsonc"),
      skillsDir: privateSkillsDir,
      skillLocations: [
        {
          path: privateSkillsDir,
          role: "preferred-runtime",
          shared: false,
          scope: "user",
          scanDepth: "recursive",
          management: "managed"
        },
        {
          path: join(configDir, "skill"),
          role: "alternate-runtime",
          shared: false,
          scope: "user",
          scanDepth: "recursive",
          management: "observed"
        },
        {
          path: sharedSkillsDir,
          role: "compatibility-runtime",
          shared: true,
          scope: "shared",
          scanDepth: "recursive",
          management: "observed"
        },
        {
          path: join(homeDir, ".claude", "skills"),
          role: "compatibility-runtime",
          shared: true,
          scope: "shared",
          scanDepth: "recursive",
          management: "observed",
          externalContainerMarkers: [{
            relativePath: ".claude-plugin/plugin.json",
            manager: "claude-plugin",
            displayName: "Claude Code plugin",
            importable: false
          }]
        }
      ],
      skillScanDirs: [
        privateSkillsDir,
        join(configDir, "skill"),
        sharedSkillsDir,
        join(homeDir, ".claude", "skills")
      ]
    };
  },
  skills,
  conversations: createOpenCodeConversationCapability(),
  createDefaultProfile: (id) => ({
    id,
    manifest: {
      id,
      name: "OpenCode Daily Coding",
      description: "Default coding environment",
      preferredTargetId: "opencode",
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
    const parsed = parseJsoncObject(configText, "Invalid live opencode.jsonc");
    if (!parsed.ok) throw new Error(parsed.message);
    const mcpConnections = captureNativeJsonMcpConnections(
      openCodeMcpLayout(parsed.value).servers,
      {
      targetId: "opencode",
      sourcePath: targetPaths.configPath,
      controllable: true
      }
    );
    const excluded = Object.keys(parsed.value)
      .filter((key) => key !== "mcp")
      .map((key) => `opencode.jsonc.${key}`);
    return {
      instructions,
      mcpConnections,
      warnings: excluded.length > 0
        ? ["OpenCode native settings remain Agent-owned"]
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

    const policy = profile.resources.mcpByTarget.opencode ?? {
      mode: "ignore" as const,
      selections: []
    };
    let managedMcpNames: string[] = [];
    let liveConfigText = "";
    if (policy.mode === "manage" && policy.selections.length > 0) {
      liveConfigText = await readTextIfExists(targetPaths.configPath);
      const liveConfig = parseJsoncObject(liveConfigText, "Invalid live opencode.jsonc");
      if (!liveConfig.ok) {
        issues.push(createApplyIssue({
          code: "invalid-native-config",
          resourceKind: "configuration",
          path: targetPaths.configPath,
          message: liveConfig.message
        }));
      } else {
        const liveMcp = openCodeMcpLayout(liveConfig.value);
        let nextContent = liveConfigText;
        const controlled = new Set<string>();
        for (const selection of policy.selections) {
          const server = liveMcp.servers[selection.name];
          if (!isRecord(server)) {
            if (selection.enabled) {
              issues.push(createApplyIssue({
                code: "missing-native-mcp",
                resourceKind: "mcp",
                resourceId: selection.name,
                path: targetPaths.configPath,
                message: `MCP server ${selection.name} is not configured in OpenCode. Turn it off in this Profile or configure it in OpenCode.`
              }));
            }
            continue;
          }
          nextContent = setJsoncProperty(
            nextContent,
            liveMcp.propertyPathFor(selection.name),
            liveMcp.propertyValueFor(selection.enabled)
          );
          controlled.add(selection.name);
        }
        if (!issues.some((issue) => issue.disposition === "block")) {
          managedMcpNames = [...controlled].sort();
          addChange(changes, targetPaths.configPath, liveConfigText, nextContent);
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
          ? { [targetPaths.configPath]: hashText(liveConfigText) }
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
