import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import * as TOML from "@iarna/toml";
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type YAMLMap
} from "yaml";
import type {
  McpTransport,
  NativeMcpConnection,
  PlannedFileChange,
  TargetActivationPreview,
  TargetPaths,
  TargetState
} from "../../../../shared/types";
import { profileManagesResource } from "../../../../shared/profileResources";
import { createApplyIssue } from "../../../applyIssues";
import { createUnifiedDiff } from "../../../diff";
import { readTextIfExists } from "../../../fileUtils";
import { findSecretWarnings } from "../../../secretWarnings";
import { setMcpServerEnabled, validateToml } from "../../../tomlConfig";
import { createTraeCliConversationCapability } from "../../conversations/traeCliConversations";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import { createFilesystemSkillDriver } from "../../shared/skillRuntime";
import { resolveTraeLayout } from "./layout";

const DEFAULT_STATE: TargetState = {
  formatVersion: 2,
  managedMcpNames: []
};

const COMMAND_ALIASES = ["traecli", "trae-cli", "trae-agent"] as const;
const MCP_KEY = "mcp_servers";

const hashText = (content: string) =>
  createHash("sha256").update(content).digest("hex");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const nativeMcpTransport = (value: Record<string, unknown>): McpTransport | undefined => {
  const type = typeof value.type === "string" ? value.type.toLowerCase() : undefined;
  if (typeof value.command === "string" || Array.isArray(value.command)) return "stdio";
  if (typeof value.url === "string" || typeof value.serverUrl === "string") {
    return type === "sse" ? "sse" : "http";
  }
  return undefined;
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

interface ParsedMcpServer {
  enabled: boolean;
  raw: Record<string, unknown>;
  yamlNode?: YAMLMap;
}

interface ParsedMcpSource {
  connections: NativeMcpConnection[];
  byName: Map<string, ParsedMcpServer>;
  excluded: string[];
}

type ParseResult =
  | { ok: true; value: ParsedMcpSource }
  | { ok: false; message: string };

const connectionsFor = (
  byName: Map<string, ParsedMcpServer>,
  sourcePath: string
): NativeMcpConnection[] =>
  [...byName.entries()]
    .map(([name, server]) => ({
      targetId: "trae-cli",
      name,
      scope: "user" as const,
      transport: nativeMcpTransport(server.raw),
      enabled: server.enabled,
      controllable: true,
      sourcePath
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

const parseTomlMcpSource = (
  content: string,
  sourcePath: string
): ParseResult => {
  const validation = validateToml(content);
  if (!validation.ok) {
    return {
      ok: false,
      message: `Invalid Trae CLI config ${sourcePath}: ${validation.message}`
    };
  }
  const parsed = TOML.parse(content || "") as Record<string, unknown>;
  const rawServers = parsed[MCP_KEY];
  if (rawServers !== undefined && !isRecord(rawServers)) {
    return {
      ok: false,
      message: `Invalid Trae CLI config ${sourcePath}: ${MCP_KEY} must be a table`
    };
  }
  const byName = new Map<string, ParsedMcpServer>();
  for (const [name, raw] of Object.entries(isRecord(rawServers) ? rawServers : {})) {
    if (!isRecord(raw)) {
      return {
        ok: false,
        message: `Invalid Trae CLI config ${sourcePath}: ${name} must be a table`
      };
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
      return {
        ok: false,
        message: `Invalid Trae CLI config ${sourcePath}: ${name}.enabled must be boolean`
      };
    }
    byName.set(name, { enabled: raw.enabled !== false, raw });
  }
  return {
    ok: true,
    value: {
      connections: connectionsFor(byName, sourcePath),
      byName,
      excluded: Object.keys(parsed)
        .filter((key) => key !== MCP_KEY)
        .map((key) => `${sourcePath}.${key}`)
    }
  };
};

const yamlMapToRecord = (map: YAMLMap): Record<string, unknown> => {
  const value = map.toJSON();
  return isRecord(value) ? value : {};
};

const parseYamlMcpSource = (
  content: string,
  sourcePath: string
): ParseResult => {
  const document = parseDocument(content, {
    keepSourceTokens: true,
    prettyErrors: true,
    uniqueKeys: true
  });
  if (document.errors.length > 0) {
    return {
      ok: false,
      message: `Invalid Trae CLI config ${sourcePath}: ${document.errors
        .map((error) => error.message.split("\n")[0])
        .join(", ")}`
    };
  }
  if (document.contents === null) {
    return {
      ok: true,
      value: { connections: [], byName: new Map(), excluded: [] }
    };
  }
  if (!isMap(document.contents)) {
    return {
      ok: false,
      message: `Invalid Trae CLI config ${sourcePath}: expected a YAML mapping`
    };
  }
  const serverNodes = document.contents.get(MCP_KEY, true);
  if (serverNodes === undefined || serverNodes === null) {
    return {
      ok: true,
      value: {
        connections: [],
        byName: new Map(),
        excluded: document.contents.items
          .map((pair) => isScalar(pair.key) ? String(pair.key.value) : "")
          .filter(Boolean)
          .map((key) => `${sourcePath}.${key}`)
      }
    };
  }
  if (!isSeq(serverNodes)) {
    return {
      ok: false,
      message: `Invalid Trae CLI config ${sourcePath}: ${MCP_KEY} must be a sequence`
    };
  }

  const byName = new Map<string, ParsedMcpServer>();
  for (const node of serverNodes.items) {
    if (!isMap(node)) {
      return {
        ok: false,
        message: `Invalid Trae CLI config ${sourcePath}: each MCP server must be a mapping`
      };
    }
    const nameNode = node.get("name", true);
    const disabledNode = node.get("disabled", true);
    if (!isScalar(nameNode) || typeof nameNode.value !== "string" || !nameNode.value.trim()) {
      return {
        ok: false,
        message: `Invalid Trae CLI config ${sourcePath}: each MCP server needs a name`
      };
    }
    if (
      disabledNode !== undefined &&
      (!isScalar(disabledNode) || typeof disabledNode.value !== "boolean")
    ) {
      return {
        ok: false,
        message: `Invalid Trae CLI config ${sourcePath}: ${nameNode.value}.disabled must be boolean`
      };
    }
    const name = nameNode.value.trim();
    if (byName.has(name)) {
      return {
        ok: false,
        message: `Invalid Trae CLI config ${sourcePath}: duplicate MCP server ${name}`
      };
    }
    const raw = yamlMapToRecord(node);
    byName.set(name, {
      enabled: raw.disabled !== true,
      raw,
      yamlNode: node
    });
  }

  return {
    ok: true,
    value: {
      connections: connectionsFor(byName, sourcePath),
      byName,
      excluded: document.contents.items
        .map((pair) => isScalar(pair.key) ? String(pair.key.value) : "")
        .filter((key) => key && key !== MCP_KEY)
        .map((key) => `${sourcePath}.${key}`)
    }
  };
};

const parseNativeMcpSource = (
  content: string,
  sourcePath: string
): ParseResult =>
  extname(sourcePath).toLowerCase() === ".toml"
    ? parseTomlMcpSource(content, sourcePath)
    : parseYamlMcpSource(content, sourcePath);

const setYamlDisabled = (
  content: string,
  name: string,
  disabled: boolean,
  server: ParsedMcpServer
): { ok: true; content: string } | { ok: false; message: string } => {
  const node = server.yamlNode;
  if (!node) {
    return { ok: false, message: `Cannot safely update Trae CLI MCP server ${name}` };
  }
  const disabledNode = node.get("disabled", true);
  if (disabledNode !== undefined) {
    if (!isScalar(disabledNode) || typeof disabledNode.value !== "boolean" || !disabledNode.range) {
      return { ok: false, message: `Cannot safely update Trae CLI MCP server ${name}` };
    }
    if (disabledNode.value === disabled) return { ok: true, content };
    return {
      ok: true,
      content: `${content.slice(0, disabledNode.range[0])}${String(disabled)}${content.slice(disabledNode.range[1])}`
    };
  }
  if (!disabled) return { ok: true, content };

  const sourceToken = node.srcToken;
  const insertionOffset = node.range?.[2];
  if (
    !sourceToken ||
    sourceToken.type !== "block-map" ||
    typeof sourceToken.indent !== "number" ||
    insertionOffset === undefined
  ) {
    return {
      ok: false,
      message: `Cannot safely add disabled state to Trae CLI MCP server ${name}`
    };
  }
  const startsOnNewLine = insertionOffset === 0 || content[insertionOffset - 1] === "\n";
  const addition = `${startsOnNewLine ? "" : "\n"}${" ".repeat(sourceToken.indent)}disabled: true\n`;
  return {
    ok: true,
    content: `${content.slice(0, insertionOffset)}${addition}${content.slice(insertionOffset)}`
  };
};

const inactiveConfigPathFor = (targetPaths: TargetPaths) =>
  extname(targetPaths.configPath).toLowerCase() === ".toml"
    ? join(targetPaths.configDir, "traecli.yaml")
    : join(targetPaths.configDir, "traecli.toml");

const obsoleteConfigPathFor = (targetPaths: TargetPaths) =>
  join(targetPaths.configDir, "trae_cli.yaml");

const legacyInstructionsPathFor = (targetPaths: TargetPaths) =>
  join(targetPaths.configDir, "AGENTS.md");

const assets = createDirectoryAssetDriver({ targetName: "Trae CLI" });
const skills = createFilesystemSkillDriver({ targetId: "trae-cli" });

export const traeCliIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "trae-cli",
    name: "Trae CLI",
    description: "Manage Trae CLI instructions, Skills, and MCP activation.",
    iconKey: "trae",
    displayOrder: 4,
    instructionsLabel: "agentenv-manager.md",
    configLabel: "traecli.toml",
    configLanguage: "toml",
    mcpConfigKey: MCP_KEY,
    realWritesEnabled: true,
    executableName: "traecli",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      agentFormat: "trae-cli",
      disabledSkillPaths: false,
      mcpActivation: true
    }
  },
  discovery: {
    detectInstallation: async (input) => {
      for (const command of COMMAND_ALIASES) {
        const path = await input.findExecutable(command);
        if (path) {
          return {
            found: true,
            evidence: [{ kind: "command", label: `${command} command`, path }]
          };
        }
      }
      return { found: false, evidence: [] };
    }
  },
  paths: {
    createTargetPaths: ({ homeDir, rootDirOverride }) => {
      const layout = resolveTraeLayout({ homeDir, rootDirOverride });
      return {
        targetId: "trae-cli",
        configDir: layout.configRoot,
        runtimeDir: layout.runtimeRoot,
        instructionsPath: layout.instructionsPath,
        configPath: layout.configPath,
        skillsDir: layout.skillsDir,
        skillLocations: [{
          path: layout.skillsDir,
          role: "preferred-runtime",
          shared: false,
          scope: "user",
          scanDepth: "direct",
          management: "managed"
        }],
        skillScanDirs: [layout.skillsDir]
      };
    }
  },
  skills,
  conversations: createTraeCliConversationCapability(),
  profile: {
    createDefaultProfile: (id) => ({
      id,
      manifest: {
        id,
        name: "Trae CLI Daily Coding",
        description: "Default coding environment",
        preferredTargetId: "trae-cli",
        version: 2
      },
      instructions: "# Agent Guidance\n\n- Keep changes scoped and reversible.\n",
      resources: { skills: [], mcpByTarget: {} }
    }),
    captureProfile: async (targetPaths) => {
      const inactiveConfigPath = inactiveConfigPathFor(targetPaths);
      const obsoleteConfigPath = obsoleteConfigPathFor(targetPaths);
      const legacyInstructionsPath = legacyInstructionsPathFor(targetPaths);
      const [
        managedInstructions,
        legacyInstructions,
        configText,
        inactiveConfig,
        obsoleteConfig
      ] = await Promise.all([
        readTextIfExists(targetPaths.instructionsPath),
        readTextIfExists(legacyInstructionsPath),
        readTextIfExists(targetPaths.configPath),
        readTextIfExists(inactiveConfigPath),
        readTextIfExists(obsoleteConfigPath)
      ]);
      const parsed = parseNativeMcpSource(configText, targetPaths.configPath);
      if (!parsed.ok) throw new Error(parsed.message);
      const excluded = [
        ...parsed.value.excluded,
        ...(legacyInstructions.trim() ? [legacyInstructionsPath] : []),
        ...(inactiveConfig.trim() ? [inactiveConfigPath] : []),
        ...(obsoleteConfig.trim() ? [obsoleteConfigPath] : [])
      ];
      const warnings = [
        ...(legacyInstructions.trim()
          ? ["Legacy Trae CLI instructions remain Agent-owned"]
          : []),
        ...(inactiveConfig.trim()
          ? ["An inactive Trae CLI version config remains Agent-owned"]
          : []),
        ...(obsoleteConfig.trim()
          ? ["The obsolete trae_cli.yaml file remains Agent-owned"]
          : []),
        ...(parsed.value.excluded.length > 0
          ? ["Trae CLI native settings outside selected MCP switches remain Agent-owned"]
          : [])
      ];
      return {
        instructions: managedInstructions || legacyInstructions,
        mcpConnections: parsed.value.connections,
        warnings,
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
      const legacyInstructionsPath = legacyInstructionsPathFor(targetPaths);
      const [liveInstructions, legacyInstructions] = managesInstructions
        ? await Promise.all([
            readTextIfExists(targetPaths.instructionsPath),
            readTextIfExists(legacyInstructionsPath)
          ])
        : ["", ""];
      if (managesInstructions && legacyInstructions.trim()) {
        issues.push(createApplyIssue({
          code: "instruction-alias",
          resourceKind: "instructions",
          path: legacyInstructionsPath,
          message: "Legacy Trae CLI instructions remain Agent-owned and may add guidance."
        }));
      }
      if (managesInstructions) {
        addChange(
          changes,
          targetPaths.instructionsPath,
          liveInstructions,
          profile.instructions
        );
        if (liveInstructions !== profile.instructions) {
          issues.push(createApplyIssue({
            code: "runtime-reload-required",
            resourceKind: "instructions",
            path: targetPaths.instructionsPath,
            message: "Instruction changes load in new Trae CLI sessions."
          }));
        }
      }

      const policy = profile.resources.mcpByTarget["trae-cli"] ?? {
        mode: "ignore" as const,
        selections: []
      };
      let managedMcpNames: string[] = [];
      let configText = "";
      if (policy.mode === "manage" && policy.selections.length > 0) {
        configText = await readTextIfExists(targetPaths.configPath);
        const parsed = parseNativeMcpSource(configText, targetPaths.configPath);
        if (!parsed.ok) {
          issues.push(createApplyIssue({
            code: "invalid-native-config",
            resourceKind: "configuration",
            path: targetPaths.configPath,
            message: parsed.message
          }));
        } else {
          let nextConfig = configText;
          const controlled = new Set<string>();
          for (const selection of policy.selections) {
            const currentParsed = parseNativeMcpSource(nextConfig, targetPaths.configPath);
            if (!currentParsed.ok) {
              issues.push(createApplyIssue({
                code: "unsafe-native-mcp-update",
                resourceKind: "mcp",
                resourceId: selection.name,
                path: targetPaths.configPath,
                message: currentParsed.message
              }));
              continue;
            }
            const server = currentParsed.value.byName.get(selection.name);
            if (!server) {
              if (selection.enabled) {
                issues.push(createApplyIssue({
                  code: "missing-native-mcp",
                  resourceKind: "mcp",
                  resourceId: selection.name,
                  path: targetPaths.configPath,
                  message: `MCP server ${selection.name} is not configured in Trae CLI. Turn it off in this Profile or configure it in Trae CLI.`
                }));
              }
              continue;
            }
            if (extname(targetPaths.configPath).toLowerCase() === ".toml") {
              try {
                nextConfig = setMcpServerEnabled(
                  nextConfig,
                  selection.name,
                  selection.enabled
                ).content;
              } catch (error) {
                issues.push(createApplyIssue({
                  code: "unsafe-native-mcp-update",
                  resourceKind: "mcp",
                  resourceId: selection.name,
                  path: targetPaths.configPath,
                  message: error instanceof Error ? error.message : String(error)
                }));
                continue;
              }
            } else {
              const updated = setYamlDisabled(
                nextConfig,
                selection.name,
                !selection.enabled,
                server
              );
              if (!updated.ok) {
                issues.push(createApplyIssue({
                  code: "unsafe-native-mcp-update",
                  resourceKind: "mcp",
                  resourceId: selection.name,
                  path: targetPaths.configPath,
                  message: updated.message
                }));
                continue;
              }
              nextConfig = updated.content;
            }
            controlled.add(selection.name);
          }
          if (!issues.some((issue) => issue.disposition === "block")) {
            managedMcpNames = [...controlled].sort();
            addChange(changes, targetPaths.configPath, configText, nextConfig);
          }
        }
      }

      return {
        issues,
        changes,
        liveFingerprints: {
          ...(managesInstructions
            ? {
                [targetPaths.instructionsPath]: hashText(liveInstructions),
                ...(legacyInstructions.trim()
                  ? { [legacyInstructionsPath]: hashText(legacyInstructions) }
                  : {})
              }
            : {}),
          ...(policy.mode === "manage" && policy.selections.length > 0
            ? { [targetPaths.configPath]: hashText(configText) }
            : {})
        },
        targetState: {
          ...state,
          formatVersion: 2,
          managedMcpNames
        }
      };
    }
  },
  assets
};

export const createTraeCliTargetAdapter = () =>
  defineTargetIntegration(traeCliIntegration);
