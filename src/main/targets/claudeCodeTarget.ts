import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
import { AssetPolicySchema } from "../../shared/schemas";
import type {
  PlannedFileChange,
  ProfileDetail,
  TargetActivationPreview,
  TargetPaths,
  TargetState
} from "../../shared/types";
import { createUnifiedDiff } from "../diff";
import { pathExists, readTextIfExists } from "../fileUtils";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir,
  markerPathFor
} from "../ownershipMarkers";
import { findSecretWarnings } from "../secretWarnings";
import {
  addSkillRefBackupPaths,
  applySkillRefs,
  skillTargetNames,
  validateSkillRefs
} from "./skillRefs";
import type { AgentTargetAdapter, TargetAssetInput } from "./types";

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

  for (const key of profileMetadataKeys) {
    nextContent = setJsoncProperty(nextContent, [key], profileSettings[key]);
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
    delete nextMcp[name];
  }
  for (const [name, server] of Object.entries(profileMcp)) {
    nextMcp[name] = server;
  }

  nextContent = setJsoncProperty(
    nextContent,
    ["mcpServers"],
    Object.keys(nextMcp).length > 0 ? nextMcp : undefined
  );

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
  state: TargetState
) => {
  const errors: string[] = [];
  const managedConfigKeys = new Set(state.managedConfigKeys);
  const liveMcp = isRecord(liveMcpConfig.mcpServers) ? liveMcpConfig.mcpServers : {};
  const managedMcpNames = new Set(state.managedMcpNames);

  for (const key of Object.keys(profileSettings).filter(
    (name) => !METADATA_CONFIG_KEYS.has(name)
  )) {
    if (key in liveSettings && !managedConfigKeys.has(key)) {
      errors.push(`Config key ${key} already exists outside AgentEnv management`);
    }
  }

  for (const name of Object.keys(profileMcp)) {
    if (name in liveMcp && !managedMcpNames.has(name)) {
      errors.push(`MCP server ${name} already exists outside AgentEnv management`);
    }
  }

  return errors;
};

const targetRootFor = (targetPaths: TargetPaths, kind: "agent" | "skill") =>
  kind === "agent" ? targetPaths.agentsDir : targetPaths.skillsDir;

const targetDirFor = (
  targetPaths: TargetPaths,
  kind: "agent" | "skill",
  targetName: string
) => {
  const root = targetRootFor(targetPaths, kind);
  if (!root) {
    throw new Error(`Target does not support ${kind} directories`);
  }
  return join(root, targetName);
};

const validateAssets = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  const errors: string[] = [];
  const profileDir = profile.profileDir;
  if ((profile.assetPolicy.ownedFiles ?? []).length > 0) {
    errors.push("Claude Code target does not support owned file assets");
  }
  if (!profileDir && profile.assetPolicy.ownedDirs.length > 0) {
    return ["Profile directory is required to copy owned assets"];
  }

  for (const ownedDir of profile.assetPolicy.ownedDirs) {
    const sourceDir = join(profileDir ?? "", ownedDir.source);
    const targetDir = targetDirFor(targetPaths, ownedDir.kind, ownedDir.targetName);
    const sourceExists = await pathExists(sourceDir);
    if (!sourceExists) {
      errors.push(`Owned ${ownedDir.kind} source does not exist: ${sourceDir}`);
    }
    if (
      (await pathExists(targetDir)) &&
      !(await isAgentEnvOwnedDir(targetDir, {
        targetId: targetPaths.targetId,
        kind: ownedDir.kind
      }))
    ) {
      errors.push(
        `${ownedDir.kind} target already exists and is not AgentEnv-owned: ${targetDir}`
      );
    }
  }

  errors.push(...(await validateSkillRefs(input)));

  return errors;
};

const removeStaleOwnedDirs = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  const desired = new Set(
    profile.assetPolicy.ownedDirs.map((ownedDir) => `${ownedDir.kind}:${ownedDir.targetName}`)
  );
  for (const skillName of skillTargetNames(input)) {
    desired.add(`skill:${skillName}`);
  }
  const roots: Array<{ kind: "agent" | "skill"; path?: string }> = [
    { kind: "agent", path: targetPaths.agentsDir },
    { kind: "skill", path: targetPaths.skillsDir }
  ];

  for (const root of roots) {
    if (!root.path || !(await pathExists(root.path))) {
      continue;
    }

    const entries = await readdir(root.path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const targetDir = join(root.path, entry.name);
      const key = `${root.kind}:${entry.name}`;
      if (
        !desired.has(key) &&
        (await isAgentEnvOwnedDir(targetDir, {
          targetId: targetPaths.targetId,
          kind: root.kind
        }))
      ) {
        await rm(targetDir, { recursive: true, force: true });
      }
    }
  }
};

const getAssetBackupPaths = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  const paths = new Set<string>();
  const desired = new Set(
    profile.assetPolicy.ownedDirs.map((ownedDir) => `${ownedDir.kind}:${ownedDir.targetName}`)
  );
  for (const skillName of skillTargetNames(input)) {
    desired.add(`skill:${skillName}`);
  }
  const roots: Array<{ kind: "agent" | "skill"; path?: string }> = [
    { kind: "agent", path: targetPaths.agentsDir },
    { kind: "skill", path: targetPaths.skillsDir }
  ];

  for (const ownedDir of profile.assetPolicy.ownedDirs) {
    paths.add(targetDirFor(targetPaths, ownedDir.kind, ownedDir.targetName));
  }
  addSkillRefBackupPaths(paths, targetPaths, input);

  for (const root of roots) {
    if (!root.path || !(await pathExists(root.path))) {
      continue;
    }

    const entries = await readdir(root.path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const targetDir = join(root.path, entry.name);
      const key = `${root.kind}:${entry.name}`;
      if (
        !desired.has(key) &&
        (await isAgentEnvOwnedDir(targetDir, {
          targetId: targetPaths.targetId,
          kind: root.kind
        }))
      ) {
        paths.add(targetDir);
      }
    }
  }

  return [...paths];
};

const applyAssets = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  await removeStaleOwnedDirs(input);

  for (const ownedDir of profile.assetPolicy.ownedDirs) {
    const sourceDir = join(profile.profileDir ?? "", ownedDir.source);
    const targetDir = targetDirFor(targetPaths, ownedDir.kind, ownedDir.targetName);

    if (
      await isAgentEnvOwnedDir(targetDir, {
        targetId: targetPaths.targetId,
        kind: ownedDir.kind
      })
    ) {
      await rm(targetDir, { recursive: true, force: true });
    }

    await mkdir(targetDirFor(targetPaths, ownedDir.kind, "."), { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true });
    await writeFile(
      markerPathFor(targetDir),
      createOwnerMarkerContent({
        profileId: profile.id,
        targetId: profile.manifest.targetId,
        kind: ownedDir.kind,
        source: ownedDir.source
      }),
      "utf8"
    );
  }
  await applySkillRefs(input);
};

export const createClaudeCodeTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "claude-code",
    name: "Claude Code",
    description: "Manage global Claude Code memory, settings, user MCP, agents, and skills.",
    instructionsLabel: "CLAUDE.md",
    configLabel: "settings + user MCP JSONC",
    configLanguage: "jsonc",
    realWritesEnabled: true,
    executableName: "claude"
  },
  createTargetPaths: ({ homeDir }) => {
    const claudeDir = join(homeDir, ".claude");
    return {
      targetId: "claude-code",
      configDir: claudeDir,
      instructionsPath: join(claudeDir, "CLAUDE.md"),
      configPath: join(claudeDir, "settings.json"),
      mcpConfigPath: join(homeDir, ".claude.json"),
      agentsDir: join(claudeDir, "agents"),
      skillsDir: join(claudeDir, "skills")
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
  readProfileFiles: async (profileDir, manifest) => {
    const [instructions, configText, assetPolicyContent] = await Promise.all([
      readFile(join(profileDir, "CLAUDE.md"), "utf8"),
      readFile(join(profileDir, "claude-code.json"), "utf8"),
      readFile(join(profileDir, "assets.json"), "utf8")
    ]);
    return {
      id: manifest.id,
      profileDir,
      manifest,
      instructions,
      configText,
      assetPolicy: AssetPolicySchema.parse(JSON.parse(assetPolicyContent))
    };
  },
  writeProfileFiles: async (profileDir, profile) => {
    await mkdir(profileDir, { recursive: true });
    await Promise.all([
      writeFile(join(profileDir, "CLAUDE.md"), profile.instructions, "utf8"),
      writeFile(join(profileDir, "claude-code.json"), profile.configText, "utf8"),
      writeFile(
        join(profileDir, "assets.json"),
        `${JSON.stringify(AssetPolicySchema.parse(profile.assetPolicy), null, 2)}\n`,
        "utf8"
      )
    ]);
  },
  createPreview: async ({ profile, targetPaths, state }): Promise<TargetActivationPreview> => {
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

    const liveSettings = parseJsoncObject(liveSettingsText, "Invalid live settings.json");
    const liveMcp = parseJsoncObject(liveMcpText, "Invalid live .claude.json");
    const profileConfig = parseJsoncObject(
      profile.configText,
      "Invalid profile Claude Code config"
    );
    let targetState: TargetState = activeState;

    if (!liveSettings.ok) {
      errors.push(liveSettings.message);
    }
    if (!liveMcp.ok) {
      errors.push(liveMcp.message);
    }
    if (!profileConfig.ok) {
      errors.push(profileConfig.message);
    }

    if (liveSettings.ok && liveMcp.ok && profileConfig.ok) {
      const { settings, mcpServers } = parseProfileConfig(profileConfig.value);
      errors.push(
        ...findOverlayConflicts(
          liveSettings.value,
          liveMcp.value,
          settings,
          mcpServers,
          activeState
        )
      );
      if (errors.length === 0) {
        const plannedSettings = applySettingsOverlay(
          liveSettingsText,
          liveSettings.value,
          settings,
          activeState
        );
        const plannedMcp = applyMcpOverlay(
          liveMcpText,
          liveMcp.value,
          mcpServers,
          activeState
        );
        targetState = {
          managedConfigKeys: plannedSettings.managedConfigKeys,
          managedMcpNames: plannedMcp.managedMcpNames
        };
        addChange(
          changes,
          targetPaths.configPath,
          liveSettingsText,
          plannedSettings.nextContent
        );
        addChange(
          changes,
          targetPaths.mcpConfigPath ?? "",
          liveMcpText,
          plannedMcp.nextContent
        );
      }
    }

    return {
      warnings,
      errors,
      changes,
      liveFingerprints: {
        [targetPaths.instructionsPath]: hashText(liveInstructions),
        [targetPaths.configPath]: hashText(liveSettingsText),
        [targetPaths.mcpConfigPath ?? ""]: hashText(liveMcpText)
      },
      targetState
    };
  },
  validateAssets,
  getAssetBackupPaths,
  applyAssets
});
