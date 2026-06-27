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
import { findSecretWarnings } from "../secretWarnings";
import type { AgentTargetAdapter, TargetAssetInput } from "./types";

const DEFAULT_STATE: TargetState = {
  managedConfigKeys: [],
  managedMcpNames: []
};

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
  const profileConfigKeys = Object.keys(profileConfig).filter((key) => key !== "mcp");

  for (const key of state.managedConfigKeys) {
    if (key !== "mcp" && !profileConfigKeys.includes(key)) {
      nextContent = setJsoncProperty(nextContent, [key], undefined);
    }
  }

  for (const key of profileConfigKeys) {
    nextContent = setJsoncProperty(nextContent, [key], profileConfig[key]);
  }

  for (const name of state.managedMcpNames) {
    delete nextMcp[name];
  }
  for (const [name, server] of Object.entries(profileMcp)) {
    nextMcp[name] = server;
  }

  nextContent = setJsoncProperty(
    nextContent,
    ["mcp"],
    Object.keys(nextMcp).length > 0 ? nextMcp : undefined
  );

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
  state: TargetState
) => {
  const errors: string[] = [];
  const managedConfigKeys = new Set(state.managedConfigKeys);
  const liveMcp = isRecord(liveConfig.mcp) ? liveConfig.mcp : {};
  const profileMcp = isRecord(profileConfig.mcp) ? profileConfig.mcp : {};
  const managedMcpNames = new Set(state.managedMcpNames);

  for (const key of Object.keys(profileConfig).filter((name) => name !== "mcp")) {
    if (key in liveConfig && !managedConfigKeys.has(key)) {
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

const markerPathFor = (targetDir: string) => join(targetDir, ".agentenv-owner.json");

const isAgentEnvOwnedDir = async (targetDir: string) =>
  (await pathExists(markerPathFor(targetDir)));

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

const validateAssets = async ({ profile, targetPaths }: TargetAssetInput) => {
  const errors: string[] = [];
  const profileDir = profile.profileDir;
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
    if ((await pathExists(targetDir)) && !(await isAgentEnvOwnedDir(targetDir))) {
      errors.push(
        `${ownedDir.kind} target already exists and is not AgentEnv-owned: ${targetDir}`
      );
    }
  }

  return errors;
};

const removeStaleOwnedDirs = async ({ profile, targetPaths }: TargetAssetInput) => {
  const desired = new Set(
    profile.assetPolicy.ownedDirs.map((ownedDir) => `${ownedDir.kind}:${ownedDir.targetName}`)
  );
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
      if (!desired.has(key) && (await isAgentEnvOwnedDir(targetDir))) {
        await rm(targetDir, { recursive: true, force: true });
      }
    }
  }
};

const applyAssets = async ({ profile, targetPaths }: TargetAssetInput) => {
  await removeStaleOwnedDirs({ profile, targetPaths });

  for (const ownedDir of profile.assetPolicy.ownedDirs) {
    const sourceDir = join(profile.profileDir ?? "", ownedDir.source);
    const targetDir = targetDirFor(targetPaths, ownedDir.kind, ownedDir.targetName);

    if (await isAgentEnvOwnedDir(targetDir)) {
      await rm(targetDir, { recursive: true, force: true });
    }

    await mkdir(targetDirFor(targetPaths, ownedDir.kind, "."), { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true });
    await writeFile(
      markerPathFor(targetDir),
      `${JSON.stringify(
        {
          profileId: profile.id,
          targetId: profile.manifest.targetId,
          kind: ownedDir.kind,
          source: ownedDir.source
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }
};

export const createOpenCodeTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "opencode",
    name: "OpenCode",
    description: "Manage global OpenCode instructions, JSONC config, agents, and skills.",
    instructionsLabel: "AGENTS.md",
    configLabel: "opencode.json",
    configLanguage: "jsonc",
    realWritesEnabled: true,
    executableName: "opencode"
  },
  createTargetPaths: ({ homeDir }) => {
    const configDir = join(homeDir, ".config", "opencode");
    return {
      targetId: "opencode",
      configDir,
      instructionsPath: join(configDir, "AGENTS.md"),
      configPath: join(configDir, "opencode.json"),
      agentsDir: join(configDir, "agents"),
      skillsDir: join(configDir, "skills")
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
    assetPolicy: { ownedDirs: [], disabledSkillPaths: [] }
  }),
  readProfileFiles: async (profileDir, manifest) => {
    const [instructions, configText, assetPolicyContent] = await Promise.all([
      readFile(join(profileDir, "AGENTS.md"), "utf8"),
      readFile(join(profileDir, "opencode.json"), "utf8"),
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
      writeFile(join(profileDir, "AGENTS.md"), profile.instructions, "utf8"),
      writeFile(join(profileDir, "opencode.json"), profile.configText, "utf8"),
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

    const liveConfig = parseJsoncObject(liveConfigText, "Invalid live opencode.json");
    const profileConfig = parseJsoncObject(
      profile.configText,
      "Invalid profile opencode.json"
    );
    let targetState: TargetState = activeState;
    if (!liveConfig.ok) {
      errors.push(liveConfig.message);
    }
    if (!profileConfig.ok) {
      errors.push(profileConfig.message);
    }

    if (liveConfig.ok && profileConfig.ok) {
      errors.push(...findOverlayConflicts(liveConfig.value, profileConfig.value, activeState));
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
        [targetPaths.configPath]: hashText(liveConfigText)
      },
      targetState
    };
  },
  validateAssets,
  applyAssets
});
