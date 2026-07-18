import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
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
  TargetPaths,
  TargetState
} from "../../shared/types";
import { createUnifiedDiff } from "../diff";
import {
  isMissingFileError,
  pathEntryExists,
  pathExists,
  readTextIfExists,
  replacePathAtomically,
  writeAtomic
} from "../fileUtils";
import { hashComparableResource } from "../resourceHash";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir,
  markerPathFor,
  markerPathForFile
} from "../ownershipMarkers";
import { removeSkillDeployment } from "../skillDeployment";
import { jsonMcpEnvironment, materializeJsonMcpRefs } from "../mcpRefs";
import { findSecretWarnings } from "../secretWarnings";
import {
  addSkillRefBackupPaths,
  applySkillRefs,
  skillTargetNames,
  validateSkillRefs
} from "./skillRefs";
import type { AgentTargetAdapter, TargetAssetInput } from "./types";
import { captureJsonMcpServers, sameJsonValue, sanitizeCapturedJson } from "./capture";
import { createProfileFileDriver } from "./shared/profileFiles";

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
  const nextMcp = isRecord(liveConfig.mcp)
    ? cloneJson(liveConfig.mcp)
    : ({} as Record<string, unknown>);
  const profileMcp = isRecord(profileConfig.mcp)
    ? profileConfig.mcp
    : ({} as Record<string, unknown>);
  const profileConfigKeys = Object.keys(profileConfig).filter(
    (key) => key !== "mcp" && !METADATA_CONFIG_KEYS.has(key)
  );
  const profileMetadataKeys = Object.keys(profileConfig).filter((key) =>
    METADATA_CONFIG_KEYS.has(key)
  );

  for (const key of state.managedConfigKeys) {
    if (
      key !== "mcp" &&
      !METADATA_CONFIG_KEYS.has(key) &&
      !profileConfigKeys.includes(key)
    ) {
      nextContent = setJsoncProperty(nextContent, [key], undefined);
    }
  }

  if (profileConfigKeys.length > 0) {
    for (const key of profileMetadataKeys) {
      nextContent = setJsoncProperty(nextContent, [key], profileConfig[key]);
    }
  }

  for (const key of profileConfigKeys) {
    nextContent = setJsoncProperty(nextContent, [key], profileConfig[key]);
  }

  for (const name of state.managedMcpNames) {
    nextContent = setJsoncProperty(nextContent, ["mcp", name], undefined);
    delete nextMcp[name];
  }
  for (const [name, server] of Object.entries(profileMcp)) {
    nextContent = setJsoncProperty(nextContent, ["mcp", name], server);
    nextMcp[name] = server;
  }

  if (Object.keys(nextMcp).length === 0) {
    nextContent = setJsoncProperty(nextContent, ["mcp"], undefined);
  }

  return {
    nextContent,
    targetState: {
      managedConfigKeys: profileConfigKeys,
      managedMcpNames: Object.keys(profileMcp).sort((a, b) => a.localeCompare(b))
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
  const liveMcp = isRecord(liveConfig.mcp) ? liveConfig.mcp : {};
  const profileMcp = isRecord(profileConfig.mcp) ? profileConfig.mcp : {};
  const managedMcpNames = new Set(state.managedMcpNames);

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

const targetRootFor = (targetPaths: TargetPaths, kind: "agent" | "skill") =>
  kind === "agent" ? targetPaths.agentsDir : targetPaths.skillsDir;

const isOwnedTargetDir = async (
  targetDir: string,
  targetPaths: TargetPaths,
  kind: "agent" | "skill"
) => isAgentEnvOwnedDir(targetDir, { targetId: targetPaths.targetId, kind });

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

const validateAssets = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  const errors: string[] = [];
  const profileDir = profile.profileDir;
  if ((profile.assetPolicy.ownedFiles ?? []).length > 0) {
    errors.push("OpenCode target does not support owned file assets");
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
    const targetExists =
      !(input.isolateSkillRoot && ownedDir.kind === "skill") &&
      await pathExists(targetDir);
    const owned = targetExists && await isOwnedTargetDir(targetDir, targetPaths, ownedDir.kind);
    const matching =
      targetExists && sourceExists && input.allowMatchingUnmanagedAssets &&
      (await hashComparableResource(sourceDir)) === (await hashComparableResource(targetDir));
    if (targetExists && !owned && !matching) {
      errors.push(
        `${ownedDir.kind} target already exists and is not AgentEnv-owned: ${targetDir}`
      );
    }
  }

  errors.push(...(await validateSkillRefs(input)));

  return errors;
};

const removeStaleOwnedDirs = async (input: TargetAssetInput) => {
  const { targetPaths } = input;
  const desired = new Set(
    input.profile.assetPolicy.ownedDirs.map((ownedDir) => `${ownedDir.kind}:${ownedDir.targetName}`)
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
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const targetDir = join(root.path, entry.name);
      const key = `${root.kind}:${entry.name}`;
      if (
        !desired.has(key) &&
        (await isOwnedTargetDir(targetDir, targetPaths, root.kind))
      ) {
        if (root.kind === "skill") {
          await removeSkillDeployment(targetDir);
        } else {
          await rm(targetDir, { recursive: true, force: true });
        }
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
    if (!(input.isolateSkillRoot && ownedDir.kind === "skill")) {
      paths.add(targetDirFor(targetPaths, ownedDir.kind, ownedDir.targetName));
    }
  }
  addSkillRefBackupPaths(paths, targetPaths, input);

  for (const root of roots) {
    if (input.isolateSkillRoot && root.kind === "skill") {
      continue;
    }
    if (!root.path || !(await pathExists(root.path))) {
      continue;
    }

    const entries = await readdir(root.path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const targetDir = join(root.path, entry.name);
      const key = `${root.kind}:${entry.name}`;
      if (
        !desired.has(key) &&
        (await isOwnedTargetDir(targetDir, targetPaths, root.kind))
      ) {
        paths.add(targetDir);
        if (root.kind === "skill") paths.add(markerPathForFile(targetDir));
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

    const owned = await isOwnedTargetDir(targetDir, targetPaths, ownedDir.kind);
    const matching =
      input.allowMatchingUnmanagedAssets &&
      await pathExists(sourceDir) &&
      await pathExists(targetDir) &&
      (await hashComparableResource(sourceDir)) === (await hashComparableResource(targetDir));
    if ((await pathEntryExists(targetDir)) && !owned && !matching) {
      throw new Error(
        `${ownedDir.kind} target changed after preview and is not AgentEnv-owned: ${targetDir}`
      );
    }

    await mkdir(targetDirFor(targetPaths, ownedDir.kind, "."), { recursive: true });
    await replacePathAtomically(targetDir, async (stagingPath) => {
      await cp(sourceDir, stagingPath, { recursive: true });
      await writeAtomic(
        markerPathFor(stagingPath),
        createOwnerMarkerContent({
          profileId: profile.id,
          targetId: targetPaths.targetId,
          kind: ownedDir.kind,
          source: ownedDir.source
        })
      );
    });
  }
  await applySkillRefs(input);
};

const profileFiles = createProfileFileDriver({
  instructionsFile: "AGENTS.md",
  configFile: "opencode.jsonc",
  readConfigText: readOpenCodeProfileConfig
});

const materializeMcpRefs = (
  profile: ProfileDetail,
  mcpLibrary: McpLibraryEntry[]
) => materializeJsonMcpRefs(profile, mcpLibrary, {
  property: "mcp",
  serializeServer: (server) => {
    const environment = jsonMcpEnvironment(server, (sourceName) => `{env:${sourceName}}`);
    return server.transport === "stdio"
      ? {
          type: "local",
          command: [server.command, ...(server.args ?? [])].filter(Boolean),
          ...(environment ? { environment } : {})
        }
      : { type: "remote", url: server.url };
  }
});

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
      disabledSkillPaths: false
    }
  },
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
        { path: privateSkillsDir, role: "preferred-runtime", shared: false },
        { path: join(configDir, "skill"), role: "alternate-runtime", shared: false },
        { path: sharedSkillsDir, role: "compatibility-runtime", shared: true },
        { path: join(homeDir, ".claude", "skills"), role: "compatibility-runtime", shared: true }
      ],
      skillScanDirs: [
        privateSkillsDir,
        join(configDir, "skill"),
        sharedSkillsDir,
        join(homeDir, ".claude", "skills")
      ]
    };
  },
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
    const capturedMcp = captureJsonMcpServers(config.mcp, "braced-env");
    delete config.mcp;
    const sanitized = sanitizeCapturedJson(config, "opencode");
    return {
      instructions,
      configText: `${JSON.stringify(sanitized.value, null, 2)}\n`,
      mcpServers: capturedMcp.servers,
      disabledSkillPaths: [],
      warnings: capturedMcp.excluded.map((name) => `MCP server ${name} was excluded because it contains unsupported or literal environment values`),
      excluded: sanitized.excluded.concat(capturedMcp.excluded.map((name) => `mcp.${name}`))
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

    const profileConfig = profile.manifest.managed.config
      ? parseJsoncObject(profile.configText, "Invalid profile opencode.jsonc")
      : { ok: true as const, value: {} };
    let targetState: TargetState = activeState;
    if (!profileConfig.ok) {
      errors.push(profileConfig.message);
    }

    const profileConfigKeys = profileConfig.ok
      ? Object.keys(profileConfig.value).filter(
          (key) => key !== "mcp" && !METADATA_CONFIG_KEYS.has(key)
        )
      : [];
    const profileMcpNames =
      profileConfig.ok && isRecord(profileConfig.value.mcp)
        ? Object.keys(profileConfig.value.mcp)
        : [];
    const shouldManageConfig =
      profile.manifest.managed.config &&
      (profileConfigKeys.length > 0 ||
        profileMcpNames.length > 0 ||
        activeState.managedConfigKeys.length > 0 ||
        activeState.managedMcpNames.length > 0);
    const liveConfig = shouldManageConfig
      ? parseJsoncObject(liveConfigText, "Invalid live opencode.jsonc")
      : { ok: true as const, value: {} };
    if (!liveConfig.ok) {
      errors.push(liveConfig.message);
    }

    if (shouldManageConfig && liveConfig.ok && profileConfig.ok) {
      errors.push(...findOverlayConflicts(liveConfig.value, profileConfig.value, activeState, allowMatchingUnmanagedConfig));
      if (errors.length === 0) {
        const planned = applyJsoncOverlay(
          liveConfigText,
          liveConfig.value,
          profileConfig.value,
          activeState
        );
        targetState = planned.targetState;
        addChange(changes, targetPaths.configPath, liveConfigText, planned.nextContent);
      }
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
  validateAssets,
  getAssetBackupPaths,
  applyAssets
});
