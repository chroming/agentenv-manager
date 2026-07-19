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
  PlannedFileChange,
  ProfileDetail,
  TargetActivationPreview,
  TargetState
} from "../../shared/types";
import { createUnifiedDiff } from "../diff";
import { pathExists, readTextIfExists } from "../fileUtils";
import { findSecretWarnings } from "../secretWarnings";
import type { AgentTargetAdapter } from "./types";
import {
  captureNativeJsonMcpConnections,
  isJsonSubset,
  sameJsonValue,
  sanitizeCapturedJson
} from "./capture";
import { createProfileFileDriver } from "./shared/profileFiles";
import { createDirectoryAssetDriver } from "./shared/assetDeployment";
import { createFilesystemSkillDriver } from "./shared/skillRuntime";
import { createCommandInstallationDriver } from "./installationDiscovery";

const DEFAULT_STATE: TargetState = {
  managedConfigKeys: [],
  managedMcpNames: []
};

const profileFiles = createProfileFileDriver({
  instructionsFile: "CLAUDE.md",
  configFile: "claude-code.json"
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

const readClaudeDisabledSkillNames = async (
  targetPaths: ReturnType<AgentTargetAdapter["createTargetPaths"]>
) => {
  const settings = parseJsoncObject(
    await readTextIfExists(targetPaths.configPath),
    "Invalid Claude Code settings"
  );
  if (!settings.ok || !isRecord(settings.value.skillOverrides)) {
    return new Set<string>();
  }
  const disabled = Object.entries(settings.value.skillOverrides).flatMap(([name, value]) => {
    if (value === false || value === "off") return [name];
    if (isRecord(value) && value.enabled === false) return [name];
    return [];
  });
  return new Set(disabled);
};

const skills = createFilesystemSkillDriver({
  targetId: "claude-code",
  readDisabledRuntimeNames: readClaudeDisabledSkillNames
});

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

const findOverlayConflicts = (
  liveSettings: Record<string, unknown>,
  profileSettings: Record<string, unknown>,
  state: TargetState,
  allowMatchingUnmanaged = false
) => {
  const errors: string[] = [];
  const managedConfigKeys = new Set(state.managedConfigKeys);

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
      agentsDir: join(claudeDir, "agents"),
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
    const liveMcp = isRecord(mcpConfig.value.mcpServers)
      ? mcpConfig.value.mcpServers
      : {};
    const mcpConnections = captureNativeJsonMcpConnections(liveMcp, {
      targetId: "claude-code",
      sourcePath: targetPaths.mcpConfigPath ?? targetPaths.configPath,
      controllable: false
    });
    const sanitized = sanitizeCapturedJson(settings.value, "claude.settings");
    return {
      instructions,
      configText: `${JSON.stringify({ settings: sanitized.value, mcpServers: {} }, null, 2)}\n`,
      mcpServers: [],
      mcpConnections,
      disabledSkillPaths: [],
      warnings: [],
      excluded: sanitized.excluded
    };
  },
  ...profileFiles,
  materializeMcpRefs: (profile) => profile,
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

    const { settings } = profileConfig.ok
      ? parseProfileConfig(profileConfig.value)
      : { settings: {} };
    const profileSettingKeys = Object.keys(settings).filter(
      (key) => !METADATA_CONFIG_KEYS.has(key)
    );
    const shouldInspectSettings =
      profile.manifest.managed.config && profileSettingKeys.length > 0;
    const selectedMcpNames = new Set(
      (profile.assetPolicy.mcpSelections ?? [])
        .filter((selection) => selection.targetId === "claude-code")
        .map((selection) => selection.name)
    );
    const liveSettings = shouldInspectSettings
      ? parseJsoncObject(liveSettingsText, "Invalid live settings.json")
      : { ok: true as const, value: {} };
    const liveMcp = parseJsoncObject(liveMcpText, "Invalid live .claude.json");
    if (!liveSettings.ok) {
      errors.push(liveSettings.message);
    }
    if (!liveMcp.ok) {
      warnings.push(
        `${liveMcp.message}; MCP selections remain Claude Code-controlled`
      );
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

    if (profileConfig.ok && liveSettings.ok) {
      const liveMcpServers =
        liveMcp.ok && isRecord(liveMcp.value.mcpServers)
          ? liveMcp.value.mcpServers
          : {};
      for (const name of selectedMcpNames) {
        if (!(name in liveMcpServers)) {
          warnings.push(
            `MCP server ${name} is not configured in Claude Code; set it up in Claude Code`
          );
        }
      }
      errors.push(
        ...findOverlayConflicts(
          liveSettings.value,
          effectiveSettings,
          { ...activeState, managedMcpNames: [] },
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
        targetState = {
          managedConfigKeys: plannedSettings.managedConfigKeys,
          managedMcpNames: []
        };
        if (shouldManageSettings) {
          addChange(
            changes,
            targetPaths.configPath,
            liveSettingsText,
            plannedSettings.nextContent
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
        ...(shouldManageSettings
          ? { [targetPaths.configPath]: hashText(liveSettingsText) }
          : {})
      },
      targetState
    };
  },
  ...assets
});
