import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
import type {
  McpLibraryEntry,
  PlannedFileChange,
  ProfileDetail,
  TargetActivationPreview,
  TargetState
} from "../../shared/types";
import { createUnifiedDiff } from "../diff";
import { pathExists, readTextIfExists } from "../fileUtils";
import { jsonMcpEnvironment, materializeJsonMcpRefs } from "../mcpRefs";
import { findSecretWarnings } from "../secretWarnings";
import type { AgentTargetAdapter } from "./types";
import {
  captureJsonMcpServers,
  isJsonSubset,
  sameJsonValue,
  sanitizeCapturedJson
} from "./capture";
import { createProfileFileDriver } from "./shared/profileFiles";
import { createDirectoryAssetDriver } from "./shared/assetDeployment";

const DEFAULT_STATE: TargetState = {
  managedConfigKeys: [],
  managedMcpNames: []
};

const profileFiles = createProfileFileDriver({
  instructionsFile: "CLAUDE.md",
  configFile: "claude-code.json"
});

const materializeMcpRefs = (
  profile: ProfileDetail,
  mcpLibrary: McpLibraryEntry[]
) => materializeJsonMcpRefs(profile, mcpLibrary, {
  property: "mcpServers",
  serializeServer: (server) => {
    const env = jsonMcpEnvironment(server, (sourceName) => `\${${sourceName}}`);
    return server.transport === "stdio"
      ? {
          type: "stdio",
          command: server.command,
          args: server.args ?? [],
          ...(env ? { env } : {})
        }
      : { type: server.transport, url: server.url };
  }
});

const assets = createDirectoryAssetDriver({
  targetName: "Claude Code",
  markerTargetId: ({ profile }) => profile.manifest.targetId
});

const METADATA_CONFIG_KEYS = new Set(["$schema"]);

const formattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n"
};

const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const cloneJson = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const addChange = (
  changes: PlannedFileChange[],
  path: string,
  before: string,
  after: string
) => {
  if (before === after) {
    return;
  }

  changes.push({
    path,
    before,
    after,
    diff: createUnifiedDiff(path, before, after)
  });
};

const parseJsoncObject = (
  content: string,
  label: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
  if (content.trim().length === 0) {
    return { ok: true, value: {} };
  }

  const errors: ParseError[] = [];
  const parsed = parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const message = errors
      .map((error) => printParseErrorCode(error.error))
      .join(", ");
    return { ok: false, message: `${label}: ${message}` };
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: `${label}: expected a JSON object` };
  }
  return { ok: true, value: parsed };
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

const parseProfileConfig = (profileConfig: Record<string, unknown>) => ({
  settings:
    "settings" in profileConfig || "mcpServers" in profileConfig
      ? isRecord(profileConfig.settings)
        ? profileConfig.settings
        : ({} as Record<string, unknown>)
      : profileConfig,
  mcpServers: isRecord(profileConfig.mcpServers)
    ? profileConfig.mcpServers
    : ({} as Record<string, unknown>)
});

const applySettingsOverlay = (
  liveContent: string,
  liveSettings: Record<string, unknown>,
  profileSettings: Record<string, unknown>,
  state: TargetState
) => {
  let nextContent = liveContent.trim().length === 0 ? "{}\n" : liveContent;
  const profileConfigKeys = Object.keys(profileSettings).filter(
    (key) => !METADATA_CONFIG_KEYS.has(key)
  );
  const profileMetadataKeys = Object.keys(profileSettings).filter((key) =>
    METADATA_CONFIG_KEYS.has(key)
  );

  for (const key of state.managedConfigKeys) {
    if (!METADATA_CONFIG_KEYS.has(key) && !profileConfigKeys.includes(key)) {
      nextContent = setJsoncProperty(nextContent, [key], undefined);
    }
  }

  if (profileConfigKeys.length > 0) {
    for (const key of profileMetadataKeys) {
      nextContent = setJsoncProperty(nextContent, [key], profileSettings[key]);
    }
  }

  for (const key of profileConfigKeys) {
    nextContent = setJsoncProperty(nextContent, [key], profileSettings[key]);
  }

  return {
    nextContent,
    managedConfigKeys: profileConfigKeys
  };
};

const applyMcpOverlay = (
  liveContent: string,
  liveConfig: Record<string, unknown>,
  profileMcp: Record<string, unknown>,
  state: TargetState
) => {
  let nextContent = liveContent.trim().length === 0 ? "{}\n" : liveContent;
  const nextMcp = isRecord(liveConfig.mcpServers)
    ? cloneJson(liveConfig.mcpServers)
    : ({} as Record<string, unknown>);

  for (const name of state.managedMcpNames) {
    nextContent = setJsoncProperty(nextContent, ["mcpServers", name], undefined);
    delete nextMcp[name];
  }
  for (const [name, server] of Object.entries(profileMcp)) {
    nextContent = setJsoncProperty(nextContent, ["mcpServers", name], server);
    nextMcp[name] = server;
  }

  if (Object.keys(nextMcp).length === 0) {
    nextContent = setJsoncProperty(nextContent, ["mcpServers"], undefined);
  }

  return {
    nextContent,
    managedMcpNames: Object.keys(profileMcp).sort((a, b) => a.localeCompare(b))
  };
};

const findOverlayConflicts = (
  liveSettings: Record<string, unknown>,
  liveMcpConfig: Record<string, unknown>,
  profileSettings: Record<string, unknown>,
  profileMcp: Record<string, unknown>,
  state: TargetState,
  allowMatchingUnmanaged = false
) => {
  const errors: string[] = [];
  const managedConfigKeys = new Set(state.managedConfigKeys);
  const liveMcp = isRecord(liveMcpConfig.mcpServers) ? liveMcpConfig.mcpServers : {};
  const managedMcpNames = new Set(state.managedMcpNames);

  for (const key of Object.keys(profileSettings).filter(
    (name) => !METADATA_CONFIG_KEYS.has(name)
  )) {
    if (
      key in liveSettings &&
      !managedConfigKeys.has(key) &&
      !(allowMatchingUnmanaged && sameJsonValue(liveSettings[key], profileSettings[key]))
    ) {
      errors.push(`Config key ${key} already exists outside AgentEnv management`);
    }
  }

  for (const name of Object.keys(profileMcp)) {
    if (
      name in liveMcp &&
      !managedMcpNames.has(name) &&
      !(allowMatchingUnmanaged && sameJsonValue(liveMcp[name], profileMcp[name]))
    ) {
      errors.push(`MCP server ${name} already exists outside AgentEnv management`);
    }
  }

  return errors;
};

export const createClaudeCodeTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "claude-code",
    name: "Claude Code",
    description: "Manage global Claude Code memory, settings, user MCP, agents, and skills.",
    iconKey: "claude",
    displayOrder: 2,
    instructionsLabel: "CLAUDE.md",
    configLabel: "settings + user MCP JSONC",
    configLanguage: "jsonc",
    mcpConfigKey: "mcpServers",
    realWritesEnabled: true,
    executableName: "claude",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      agentFormat: "claude-code",
      disabledSkillPaths: false
    }
  },
  createTargetPaths: ({ homeDir }) => {
    const claudeDir = join(homeDir, ".claude");
    const skillsDir = join(claudeDir, "skills");
    return {
      targetId: "claude-code",
      configDir: claudeDir,
      instructionsPath: join(claudeDir, "CLAUDE.md"),
      configPath: join(claudeDir, "settings.json"),
      mcpConfigPath: join(homeDir, ".claude.json"),
      agentsDir: join(claudeDir, "agents"),
      skillsDir,
      skillLocations: [{ path: skillsDir, role: "preferred-runtime", shared: false }],
      skillScanDirs: [skillsDir]
    };
  },
  createDefaultProfile: (id) => ({
    id,
    manifest: {
      id,
      targetId: "claude-code",
      name: "Claude Code Daily Coding",
      description: "Default Claude Code environment",
      version: 1,
      managed: { instructions: true, config: true, assets: true }
    },
    instructions:
      "# Claude Code Guidance\n\n- Keep changes scoped and reversible.\n- Preview environment changes before applying them.\n",
    configText: `${JSON.stringify(
      {
        settings: {
          $schema: "https://json.schemastore.org/claude-code-settings.json"
        },
        mcpServers: {}
      },
      null,
      2
    )}\n`,
    assetPolicy: { ownedDirs: [], ownedFiles: [], skillRefs: [], mcpRefs: [], disabledSkillPaths: [] }
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
    const liveMcp = isRecord(mcpConfig.value.mcpServers) ? mcpConfig.value.mcpServers : {};
    const capturedMcp = captureJsonMcpServers(liveMcp, "shell-env");
    const sanitized = sanitizeCapturedJson(settings.value, "claude.settings");
    return {
      instructions,
      configText: `${JSON.stringify({ settings: sanitized.value, mcpServers: {} }, null, 2)}\n`,
      mcpServers: capturedMcp.servers,
      disabledSkillPaths: [],
      warnings: capturedMcp.excluded.map((name) => `MCP server ${name} was excluded because it contains unsupported or literal environment values`),
      excluded: sanitized.excluded.concat(capturedMcp.excluded.map((name) => `.claude.json.mcpServers.${name}`))
    };
  },
  ...profileFiles,
  materializeMcpRefs,
  createPreview: async ({ profile, targetPaths, state, allowMatchingUnmanagedConfig }): Promise<TargetActivationPreview> => {
    const activeState = state ?? DEFAULT_STATE;
    const warnings = findSecretWarnings(profile.instructions).concat(
      findSecretWarnings(profile.configText)
    );
    const errors: string[] = [];
    const changes: PlannedFileChange[] = [];
    const [liveInstructions, liveSettingsText, liveMcpText] = await Promise.all([
      readTextIfExists(targetPaths.instructionsPath),
      readTextIfExists(targetPaths.configPath),
      readTextIfExists(targetPaths.mcpConfigPath ?? "")
    ]);

    addChange(
      changes,
      targetPaths.instructionsPath,
      liveInstructions,
      profile.instructions
    );

    const profileConfig = profile.manifest.managed.config
      ? parseJsoncObject(profile.configText, "Invalid profile Claude Code config")
      : { ok: true as const, value: {} };
    let targetState: TargetState = activeState;

    if (!profileConfig.ok) {
      errors.push(profileConfig.message);
    }

    const { settings, mcpServers } = profileConfig.ok
      ? parseProfileConfig(profileConfig.value)
      : { settings: {}, mcpServers: {} };
    const profileSettingKeys = Object.keys(settings).filter(
      (key) => !METADATA_CONFIG_KEYS.has(key)
    );
    const shouldInspectSettings =
      profile.manifest.managed.config &&
      profileSettingKeys.length > 0;
    const shouldManageMcp =
      profile.manifest.managed.config &&
      (Object.keys(mcpServers).length > 0 || activeState.managedMcpNames.length > 0);
    const liveSettings = shouldInspectSettings
      ? parseJsoncObject(liveSettingsText, "Invalid live settings.json")
      : { ok: true as const, value: {} };
    const liveMcp = shouldManageMcp
      ? parseJsoncObject(liveMcpText, "Invalid live .claude.json")
      : { ok: true as const, value: {} };
    if (!liveSettings.ok) {
      errors.push(liveSettings.message);
    }
    if (!liveMcp.ok) {
      errors.push(liveMcp.message);
    }

    let effectiveSettings = settings;
    if (
      profileConfig.ok &&
      liveSettings.ok &&
      allowMatchingUnmanagedConfig &&
      !activeState.managedConfigKeys.includes("env") &&
      "env" in settings &&
      "env" in liveSettings.value &&
      isJsonSubset(settings.env, liveSettings.value.env) &&
      !sameJsonValue(settings.env, liveSettings.value.env)
    ) {
      effectiveSettings = Object.fromEntries(
        Object.entries(settings).filter(([key]) => key !== "env")
      );
      warnings.push(
        "Claude Code env contains Agent-owned values and will be preserved"
      );
    }

    const effectiveSettingKeys = Object.keys(effectiveSettings).filter(
      (key) => !METADATA_CONFIG_KEYS.has(key)
    );
    const shouldManageSettings =
      profile.manifest.managed.config &&
      effectiveSettingKeys.length > 0;

    if (profileConfig.ok && liveSettings.ok && liveMcp.ok) {
      errors.push(
        ...findOverlayConflicts(
          liveSettings.value,
          liveMcp.value,
          effectiveSettings,
          mcpServers,
          activeState,
          allowMatchingUnmanagedConfig
        )
      );
      if (errors.length === 0) {
        const plannedSettings = shouldManageSettings
          ? applySettingsOverlay(
              liveSettingsText,
              liveSettings.value,
              effectiveSettings,
              activeState
            )
          : { nextContent: liveSettingsText, managedConfigKeys: [] };
        const plannedMcp = shouldManageMcp
          ? applyMcpOverlay(liveMcpText, liveMcp.value, mcpServers, activeState)
          : { nextContent: liveMcpText, managedMcpNames: [] };
        targetState = {
          managedConfigKeys: plannedSettings.managedConfigKeys,
          managedMcpNames: plannedMcp.managedMcpNames
        };
        if (shouldManageSettings) {
          addChange(
            changes,
            targetPaths.configPath,
            liveSettingsText,
            plannedSettings.nextContent
          );
        }
        if (shouldManageMcp) {
          addChange(
            changes,
            targetPaths.mcpConfigPath ?? "",
            liveMcpText,
            plannedMcp.nextContent
          );
        }
      }
    }

    return {
      warnings,
      errors,
      changes,
      liveFingerprints: {
        [targetPaths.instructionsPath]: hashText(liveInstructions),
        ...(shouldManageSettings ? { [targetPaths.configPath]: hashText(liveSettingsText) } : {}),
        ...(shouldManageMcp
          ? { [targetPaths.mcpConfigPath ?? ""]: hashText(liveMcpText) }
          : {})
      },
      targetState
    };
  },
  ...assets
});
