import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
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
  TargetState
} from "../../../../shared/types";
import { profileManagesResource } from "../../../../shared/profileResources";
import { createApplyIssue } from "../../../applyIssues";
import { createUnifiedDiff } from "../../../diff";
import { readTextIfExists } from "../../../fileUtils";
import { findSecretWarnings } from "../../../secretWarnings";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import { createFilesystemSkillDriver } from "../../shared/skillRuntime";

const DEFAULT_STATE: TargetState = {
  formatVersion: 2,
  managedMcpNames: []
};

const COMMAND_ALIASES = ["traecli", "trae-cli", "trae-agent"] as const;
const YAML_MCP_KEY = "mcp_servers";
const JSON_MCP_KEY = "mcpServers";

const formattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n"
};

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

interface ParsedMcpSource {
  connections: NativeMcpConnection[];
  byName: Map<string, { enabled: boolean; raw: Record<string, unknown>; node?: YAMLMap }>;
  excluded: string[];
}

type ParseResult =
  | { ok: true; value: ParsedMcpSource }
  | { ok: false; message: string };

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
      message: `${label}: ${errors.map((error) => printParseErrorCode(error.error)).join(", ")}`
    };
  }
  return isRecord(parsed)
    ? { ok: true, value: parsed }
    : { ok: false, message: `${label}: expected a JSON object` };
};

const parseJsonMcpSource = (
  content: string,
  sourcePath: string,
  controllable: boolean
): ParseResult => {
  const parsed = parseJsoncObject(content, `Invalid Trae CLI MCP config ${sourcePath}`);
  if (!parsed.ok) return parsed;
  const rawServers = parsed.value[JSON_MCP_KEY];
  if (rawServers !== undefined && !isRecord(rawServers)) {
    return {
      ok: false,
      message: `Invalid Trae CLI MCP config ${sourcePath}: ${JSON_MCP_KEY} must be an object`
    };
  }
  const byName = new Map<string, { enabled: boolean; raw: Record<string, unknown> }>();
  for (const [name, raw] of Object.entries(isRecord(rawServers) ? rawServers : {})) {
    if (!isRecord(raw)) {
      return {
        ok: false,
        message: `Invalid Trae CLI MCP config ${sourcePath}: ${name} must be an object`
      };
    }
    byName.set(name, { enabled: raw.disabled !== true, raw });
  }
  const connections = [...byName.entries()].map(([name, server]) => ({
    targetId: "trae-cli",
    name,
    scope: "user" as const,
    transport: nativeMcpTransport(server.raw),
    enabled: server.enabled,
    controllable,
    sourcePath
  }));
  return {
    ok: true,
    value: {
      connections,
      byName,
      excluded: Object.keys(parsed.value)
        .filter((key) => key !== JSON_MCP_KEY)
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
  sourcePath: string,
  controllable: boolean
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
  const serverNodes = document.contents.get(YAML_MCP_KEY, true);
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
      message: `Invalid Trae CLI config ${sourcePath}: ${YAML_MCP_KEY} must be a sequence`
    };
  }

  const byName = new Map<
    string,
    { enabled: boolean; raw: Record<string, unknown>; node: YAMLMap }
  >();
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
    byName.set(name, { enabled: raw.disabled !== true, raw, node });
  }

  const connections = [...byName.entries()].map(([name, server]) => ({
    targetId: "trae-cli",
    name,
    scope: "user" as const,
    transport: nativeMcpTransport(server.raw),
    enabled: server.enabled,
    controllable,
    sourcePath
  }));
  return {
    ok: true,
    value: {
      connections,
      byName,
      excluded: document.contents.items
        .map((pair) => isScalar(pair.key) ? String(pair.key.value) : "")
        .filter((key) => key && key !== YAML_MCP_KEY)
        .map((key) => `${sourcePath}.${key}`)
    }
  };
};

const setJsonDisabled = (
  content: string,
  name: string,
  disabled: boolean,
  server: Record<string, unknown>
) => {
  if (server.disabled === disabled || (!disabled && server.disabled === undefined)) {
    return content;
  }
  const source = content.trim().length === 0 ? "{}\n" : content;
  return applyEdits(
    source,
    modify(source, [JSON_MCP_KEY, name, "disabled"], disabled, {
      formattingOptions,
      getInsertionIndex: (properties) => properties.length
    })
  );
};

const setYamlDisabled = (
  content: string,
  name: string,
  disabled: boolean,
  server: { enabled: boolean; node: YAMLMap }
): { ok: true; content: string } | { ok: false; message: string } => {
  const disabledNode = server.node.get("disabled", true);
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

  const sourceToken = server.node.srcToken;
  const insertionOffset = server.node.range?.[2];
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

const mergeMcpConnections = (
  sources: ParsedMcpSource[]
): NativeMcpConnection[] => {
  const grouped = new Map<string, NativeMcpConnection[]>();
  for (const connection of sources.flatMap((source) => source.connections)) {
    grouped.set(connection.name, [...(grouped.get(connection.name) ?? []), connection]);
  }
  return [...grouped.entries()]
    .map(([name, connections]) => connections.length === 1
      ? connections[0]
      : {
          ...connections[0],
          name,
          controllable: false,
          sourcePath: connections.map((connection) => connection.sourcePath).join(" · "),
          detail: "duplicate-user-sources"
        })
    .sort((left, right) => left.name.localeCompare(right.name));
};

const assets = createDirectoryAssetDriver({ targetName: "Trae CLI" });
const skills = createFilesystemSkillDriver({ targetId: "trae-cli" });

export const traeCliIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "trae-cli",
    name: "Trae CLI",
    description: "Manage Trae CLI instructions, Skills, and MCP activation.",
    iconKey: "trae",
    displayOrder: 4,
    instructionsLabel: "AGENTS.md",
    configLabel: "trae_cli.yaml",
    configLanguage: "yaml",
    mcpConfigKey: YAML_MCP_KEY,
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
      const configDir = rootDirOverride ?? join(homeDir, ".trae");
      const primarySkillsDir = join(configDir, "skills");
      const cocoSkillsDir = join(homeDir, ".coco", "skills");
      const cnSkillsDir = join(homeDir, ".trae-cn", "skills");
      return {
        targetId: "trae-cli",
        configDir,
        instructionsPath: join(configDir, "AGENTS.md"),
        configPath: join(configDir, "trae_cli.yaml"),
        mcpConfigPath: join(configDir, "mcp.json"),
        skillsDir: primarySkillsDir,
        skillLocations: [
          {
            path: primarySkillsDir,
            role: "preferred-runtime",
            shared: false,
            scope: "user",
            scanDepth: "direct",
            management: "managed"
          },
          {
            path: cocoSkillsDir,
            role: "alternate-runtime",
            shared: false,
            scope: "user",
            scanDepth: "direct",
            management: "observed"
          },
          {
            path: cnSkillsDir,
            role: "alternate-runtime",
            shared: false,
            scope: "user",
            scanDepth: "direct",
            management: "observed"
          }
        ],
        skillScanDirs: [primarySkillsDir, cocoSkillsDir, cnSkillsDir]
      };
    }
  },
  skills,
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
      const legacyYamlPath = join(targetPaths.configDir, "traecli.yaml");
      const instructionAliases = [
        join(targetPaths.configDir, "..", ".coco", "AGENTS.md"),
        join(targetPaths.configDir, "..", ".trae-cn", "AGENTS.md"),
        join(targetPaths.configDir, "..", ".agents", "AGENTS.md")
      ];
      const [instructions, yamlText, jsonText, legacyYamlText, ...aliasInstructions] =
        await Promise.all([
          readTextIfExists(targetPaths.instructionsPath),
          readTextIfExists(targetPaths.configPath),
          readTextIfExists(targetPaths.mcpConfigPath ?? ""),
          readTextIfExists(legacyYamlPath),
          ...instructionAliases.map((path) => readTextIfExists(path))
        ]);
      const yaml = parseYamlMcpSource(yamlText, targetPaths.configPath, true);
      const json = parseJsonMcpSource(
        jsonText,
        targetPaths.mcpConfigPath ?? targetPaths.configPath,
        true
      );
      const legacyYaml = parseYamlMcpSource(legacyYamlText, legacyYamlPath, false);
      if (!yaml.ok) throw new Error(yaml.message);
      if (!json.ok) throw new Error(json.message);
      if (!legacyYaml.ok) throw new Error(legacyYaml.message);
      const aliasesInUse = instructionAliases.filter((_, index) =>
        aliasInstructions[index]?.trim()
      );
      const sources = [yaml.value, json.value, legacyYaml.value];
      const excluded = [
        ...sources.flatMap((source) => source.excluded),
        ...aliasesInUse
      ];
      const warnings = [
        ...(aliasesInUse.length > 0
          ? ["Additional Trae CLI user instructions remain Agent-owned"]
          : []),
        ...(legacyYaml.value.connections.length > 0
          ? ["MCPs in traecli.yaml are visible but remain Agent-controlled"]
          : []),
        ...(excluded.length > 0
          ? ["Trae CLI native settings outside selected MCP switches remain Agent-owned"]
          : [])
      ];
      return {
        instructions,
        mcpConnections: mergeMcpConnections(sources),
        warnings: [...new Set(warnings)],
        excluded: [...new Set(excluded)]
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
      const instructionAliases = [
        join(targetPaths.configDir, "..", ".coco", "AGENTS.md"),
        join(targetPaths.configDir, "..", ".trae-cn", "AGENTS.md"),
        join(targetPaths.configDir, "..", ".agents", "AGENTS.md")
      ];
      const legacyYamlPath = join(targetPaths.configDir, "traecli.yaml");
      const [liveInstructions, ...aliasInstructions] = managesInstructions
        ? await Promise.all([
            readTextIfExists(targetPaths.instructionsPath),
            ...instructionAliases.map((path) => readTextIfExists(path))
          ])
        : [""];
      if (managesInstructions && aliasInstructions.some((content) => content.trim())) {
        issues.push(createApplyIssue({
          code: "instruction-alias",
          disposition: "notice",
          resolution: "preserve",
          resourceKind: "instructions",
          message: "Trae CLI also has user instruction aliases outside AgentEnv management; they may add guidance."
        }));
      }
      if (managesInstructions) {
        addChange(
          changes,
          targetPaths.instructionsPath,
          liveInstructions,
          profile.instructions
        );
      }

      const policy = profile.resources.mcpByTarget["trae-cli"] ?? {
        mode: "ignore" as const,
        selections: []
      };
      let managedMcpNames: string[] = [];
      let yamlText = "";
      let jsonText = "";
      let legacyYamlText = "";
      if (policy.mode === "manage" && policy.selections.length > 0) {
        [yamlText, jsonText, legacyYamlText] = await Promise.all([
          readTextIfExists(targetPaths.configPath),
          readTextIfExists(targetPaths.mcpConfigPath ?? ""),
          readTextIfExists(legacyYamlPath)
        ]);
        const yaml = parseYamlMcpSource(yamlText, targetPaths.configPath, true);
        const json = parseJsonMcpSource(
          jsonText,
          targetPaths.mcpConfigPath ?? targetPaths.configPath,
          true
        );
        const legacyYaml = parseYamlMcpSource(legacyYamlText, legacyYamlPath, false);
        if (!yaml.ok) {
          issues.push(createApplyIssue({
            code: "invalid-native-config",
            disposition: "block",
            resolution: "external-action",
            resourceKind: "configuration",
            path: targetPaths.configPath,
            message: yaml.message
          }));
        }
        if (!json.ok) {
          issues.push(createApplyIssue({
            code: "invalid-native-config",
            disposition: "block",
            resolution: "external-action",
            resourceKind: "configuration",
            path: targetPaths.mcpConfigPath ?? targetPaths.configPath,
            message: json.message
          }));
        }
        if (!legacyYaml.ok) {
          issues.push(createApplyIssue({
            code: "invalid-native-config",
            disposition: "block",
            resolution: "external-action",
            resourceKind: "configuration",
            path: legacyYamlPath,
            message: legacyYaml.message
          }));
        }
        if (yaml.ok && json.ok && legacyYaml.ok) {
          let nextYaml = yamlText;
          let nextJson = jsonText;
          const controlled = new Set<string>();
          for (const selection of policy.selections) {
            const yamlServer = yaml.value.byName.get(selection.name);
            const jsonServer = json.value.byName.get(selection.name);
            const legacyYamlServer = legacyYaml.value.byName.get(selection.name);
            const occurrenceCount =
              Number(Boolean(yamlServer)) +
              Number(Boolean(jsonServer)) +
              Number(Boolean(legacyYamlServer));
            if (occurrenceCount > 1) {
              issues.push(createApplyIssue({
                code: "duplicate-native-mcp",
                disposition: "block",
                resolution: "external-action",
                resourceKind: "mcp",
                resourceId: selection.name,
                message: `MCP server ${selection.name} is defined in multiple Trae CLI user files. Keep one definition or use the Agent setting.`
              }));
              continue;
            }
            if (legacyYamlServer) {
              issues.push(createApplyIssue({
                code: "agent-owned-native-mcp",
                disposition: "block",
                resolution: "external-action",
                resourceKind: "mcp",
                resourceId: selection.name,
                path: legacyYamlPath,
                message: `MCP server ${selection.name} is defined in Agent-owned traecli.yaml. Move it to trae_cli.yaml or mcp.json, or use the Agent setting.`
              }));
              continue;
            }
            if (occurrenceCount === 0) {
              if (selection.enabled) {
                issues.push(createApplyIssue({
                  code: "missing-native-mcp",
                  disposition: "block",
                  resolution: "edit-profile",
                  resourceKind: "mcp",
                  resourceId: selection.name,
                  message: `MCP server ${selection.name} is not configured in Trae CLI. Turn it off in this Profile or configure it in Trae CLI.`
                }));
              }
              continue;
            }
            if (yamlServer) {
              const currentYaml = parseYamlMcpSource(nextYaml, targetPaths.configPath, true);
              const currentServer = currentYaml.ok
                ? currentYaml.value.byName.get(selection.name)
                : undefined;
              if (!currentYaml.ok || !currentServer?.node) {
                issues.push(createApplyIssue({
                  code: "unsafe-native-mcp-update",
                  disposition: "block",
                  resolution: "external-action",
                  resourceKind: "mcp",
                  resourceId: selection.name,
                  path: targetPaths.configPath,
                  message: currentYaml.ok
                    ? `Cannot safely update Trae CLI MCP server ${selection.name}`
                    : currentYaml.message
                }));
                continue;
              }
              const updated = setYamlDisabled(
                nextYaml,
                selection.name,
                !selection.enabled,
                currentServer as { enabled: boolean; node: YAMLMap }
              );
              if (!updated.ok) {
                issues.push(createApplyIssue({
                  code: "unsafe-native-mcp-update",
                  disposition: "block",
                  resolution: "external-action",
                  resourceKind: "mcp",
                  resourceId: selection.name,
                  path: targetPaths.configPath,
                  message: updated.message
                }));
                continue;
              }
              nextYaml = updated.content;
            } else if (jsonServer) {
              nextJson = setJsonDisabled(
                nextJson,
                selection.name,
                !selection.enabled,
                jsonServer.raw
              );
            }
            controlled.add(selection.name);
          }
          if (!issues.some((issue) => issue.disposition === "block")) {
            managedMcpNames = [...controlled].sort();
            addChange(changes, targetPaths.configPath, yamlText, nextYaml);
            addChange(
              changes,
              targetPaths.mcpConfigPath ?? targetPaths.configPath,
              jsonText,
              nextJson
            );
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
            ? {
                [targetPaths.configPath]: hashText(yamlText),
                [targetPaths.mcpConfigPath ?? targetPaths.configPath]: hashText(jsonText),
                [legacyYamlPath]: hashText(legacyYamlText)
              }
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
