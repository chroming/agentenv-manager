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
import {
  isMissingFileError,
  pathExists,
  readTextIfExists
} from "../fileUtils";
import { findSecretWarnings } from "../secretWarnings";
import type { AgentTargetAdapter } from "./types";
import {
  captureNativeJsonMcpConnections,
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

const applyJsoncOverlay = (
  liveContent: string,
  liveConfig: Record<string, unknown>,
  profileConfig: Record<string, unknown>,
  state: TargetState
) => {
  let nextContent = liveContent.trim().length === 0 ? "{}\n" : liveContent;
  const profileConfigKeys = Object.keys(profileConfig).filter(
    (key) => key !== "mcp" && !METADATA_CONFIG_KEYS.has(key)
  );
  const profileMetadataKeys = Object.keys(profileConfig).filter((key) =>
    METADATA_CONFIG_KEYS.has(key)
  );

  if (profileConfigKeys.length > 0) {
    for (const key of state.managedConfigKeys) {
      if (
        key !== "mcp" &&
        !METADATA_CONFIG_KEYS.has(key) &&
        !profileConfigKeys.includes(key)
      ) {
        nextContent = setJsoncProperty(nextContent, [key], undefined);
      }
    }

    for (const key of profileMetadataKeys) {
      nextContent = setJsoncProperty(nextContent, [key], profileConfig[key]);
    }
  }

  for (const key of profileConfigKeys) {
    nextContent = setJsoncProperty(nextContent, [key], profileConfig[key]);
  }

  return {
    nextContent,
    targetState: {
      managedConfigKeys: profileConfigKeys,
      managedMcpNames: []
    }
  };
};

const findOverlayConflicts = (
  liveConfig: Record<string, unknown>,
  profileConfig: Record<string, unknown>,
  state: TargetState,
  allowMatchingUnmanaged = false
) => {
  const errors: string[] = [];
  const managedConfigKeys = new Set(state.managedConfigKeys);

  for (const key of Object.keys(profileConfig).filter(
    (name) => name !== "mcp" && !METADATA_CONFIG_KEYS.has(name)
  )) {
    if (
      key in liveConfig &&
      !managedConfigKeys.has(key) &&
      !(allowMatchingUnmanaged && sameJsonValue(liveConfig[key], profileConfig[key]))
    ) {
      errors.push(`Config key ${key} already exists outside AgentEnv management`);
    }
  }

  return errors;
};

const readOpenCodeProfileConfig = async (profileDir: string) => {
  try {
    return await readFile(join(profileDir, "opencode.jsonc"), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return readFile(join(profileDir, "opencode.json"), "utf8");
    }
    throw error;
  }
};

const profileFiles = createProfileFileDriver({
  instructionsFile: "AGENTS.md",
  configFile: "opencode.jsonc",
  readConfigText: readOpenCodeProfileConfig
});

const assets = createDirectoryAssetDriver({ targetName: "OpenCode" });
const skills = createFilesystemSkillDriver({ targetId: "opencode" });

export const createOpenCodeTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "opencode",
    name: "OpenCode",
    description: "Manage global OpenCode instructions, JSONC config, agents, and skills.",
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
  detectInstallation: createCommandInstallationDriver("opencode").detectInstallation,
  createTargetPaths: ({ homeDir }) => {
    const configDir = join(homeDir, ".config", "opencode");
    const privateSkillsDir = join(configDir, "skills");
    const sharedSkillsDir = join(homeDir, ".agents", "skills");
    return {
      targetId: "opencode",
      configDir,
      instructionsPath: join(configDir, "AGENTS.md"),
      configPath: join(configDir, "opencode.jsonc"),
      agentsDir: join(configDir, "agents"),
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
  createDefaultProfile: (id) => ({
    id,
    manifest: {
      id,
      targetId: "opencode",
      name: "OpenCode Daily Coding",
      description: "Default OpenCode environment",
      version: 1,
      managed: { instructions: true, config: true, assets: true }
    },
    instructions:
      "# OpenCode Guidance\n\n- Keep changes scoped and reversible.\n- Preview environment changes before applying them.\n",
    configText: "{}\n",
    assetPolicy: { ownedDirs: [], ownedFiles: [], skillRefs: [], mcpRefs: [], disabledSkillPaths: [] }
  }),
  captureProfile: async (targetPaths) => {
    const [instructions, configText] = await Promise.all([
      readTextIfExists(targetPaths.instructionsPath),
      readTextIfExists(targetPaths.configPath)
    ]);
    const parsed = parseJsoncObject(configText, "Invalid live opencode.jsonc");
    if (!parsed.ok) throw new Error(parsed.message);
    const config = cloneJson(parsed.value);
    const mcpConnections = captureNativeJsonMcpConnections(config.mcp, {
      targetId: "opencode",
      sourcePath: targetPaths.configPath,
      controllable: true
    });
    delete config.mcp;
    const sanitized = sanitizeCapturedJson(config, "opencode");
    return {
      instructions,
      configText: `${JSON.stringify(sanitized.value, null, 2)}\n`,
      mcpServers: [],
      mcpConnections,
      disabledSkillPaths: [],
      warnings: [],
      excluded: sanitized.excluded
    };
  },
  ...profileFiles,
  materializeMcpRefs: (profile) => profile,
  hasMeaningfulNativeConfig: (configText) => {
    const parsed = parseJsoncObject(configText, "Invalid OpenCode Profile config");
    return !parsed.ok || Object.keys(parsed.value).some(
      (key) => key !== "mcp" && !METADATA_CONFIG_KEYS.has(key)
    );
  },
  createPreview: async ({ profile, targetPaths, state, allowMatchingUnmanagedConfig }): Promise<TargetActivationPreview> => {
    const activeState = state ?? DEFAULT_STATE;
    const warnings = findSecretWarnings(profile.instructions).concat(
      findSecretWarnings(profile.configText)
    );
    const errors: string[] = [];
    const changes: PlannedFileChange[] = [];
    const [liveInstructions, liveConfigText] = await Promise.all([
      readTextIfExists(targetPaths.instructionsPath),
      readTextIfExists(targetPaths.configPath)
    ]);

    addChange(
      changes,
      targetPaths.instructionsPath,
      liveInstructions,
      profile.instructions
    );

    const parsedProfileConfig = profile.manifest.managed.config
      ? parseJsoncObject(profile.configText, "Invalid profile opencode.jsonc")
      : { ok: true as const, value: {} };
    const profileConfig = parsedProfileConfig.ok
      ? {
          ...parsedProfileConfig,
          value: Object.fromEntries(
            Object.entries(parsedProfileConfig.value).filter(
              ([key]) => key !== "mcp"
            )
          )
        }
      : parsedProfileConfig;
    let targetState: TargetState = activeState;
    if (!profileConfig.ok) {
      errors.push(profileConfig.message);
    }

    const profileConfigKeys = profileConfig.ok
      ? Object.keys(profileConfig.value).filter(
          (key) => key !== "mcp" && !METADATA_CONFIG_KEYS.has(key)
        )
      : [];
    const selectedMcpStates = new Map(
      (profile.assetPolicy.mcpSelections ?? [])
        .filter((selection) => selection.targetId === "opencode")
        .map(
          (selection) => [selection.name, selection.enabled !== false] as const
        )
    );
    const shouldManageConfig =
      profile.manifest.managed.config &&
      (profileConfigKeys.length > 0 ||
        selectedMcpStates.size > 0 ||
        activeState.managedMcpNames.length > 0);
    const liveConfig = shouldManageConfig
      ? parseJsoncObject(liveConfigText, "Invalid live opencode.jsonc")
      : { ok: true as const, value: {} };
    if (!liveConfig.ok) {
      errors.push(liveConfig.message);
    }

    if (shouldManageConfig && liveConfig.ok && profileConfig.ok) {
      errors.push(
        ...findOverlayConflicts(
          liveConfig.value,
          profileConfig.value,
          { ...activeState, managedMcpNames: [] },
          allowMatchingUnmanagedConfig
        )
      );
      if (errors.length === 0) {
        const planned = applyJsoncOverlay(
          liveConfigText,
          liveConfig.value,
          profileConfig.value,
          { ...activeState, managedMcpNames: [] }
        );
        let nextContent = planned.nextContent;
        const liveMcp = isRecord(liveConfig.value.mcp)
          ? liveConfig.value.mcp
          : {};
        const controlledNames = new Set<string>();
        for (const [name, enabled] of selectedMcpStates) {
          if (!isRecord(liveMcp[name])) {
            warnings.push(
              `MCP server ${name} is not configured in OpenCode; set it up in OpenCode before applying this selection`
            );
            continue;
          }
          nextContent = setJsoncProperty(
            nextContent,
            ["mcp", name, "enabled"],
            enabled
          );
          controlledNames.add(name);
        }
        targetState = {
          managedConfigKeys: planned.targetState.managedConfigKeys,
          managedMcpNames: [...controlledNames].sort((left, right) =>
            left.localeCompare(right)
          )
        };
        addChange(changes, targetPaths.configPath, liveConfigText, nextContent);
      }
    } else if (!shouldManageConfig && profileConfig.ok) {
      targetState = DEFAULT_STATE;
    }

    return {
      warnings,
      errors,
      changes,
      liveFingerprints: {
        [targetPaths.instructionsPath]: hashText(liveInstructions),
        ...(shouldManageConfig ? { [targetPaths.configPath]: hashText(liveConfigText) } : {})
      },
      targetState
    };
  },
  ...assets
});
