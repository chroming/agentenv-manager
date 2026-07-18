import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as TOML from "@iarna/toml";
import {
  AssetPolicySchema,
  LegacySkillsPolicySchema
} from "../../shared/schemas";
import type {
  PlannedFileChange,
  ProfileDetail,
  TargetActivationPreview,
  TargetPaths,
  TargetState
} from "../../shared/types";
import { createUnifiedDiff } from "../diff";
import {
  pathEntryExists,
  pathExists,
  readTextIfExists,
  replacePathAtomically,
  writeAtomic
} from "../fileUtils";
import { hashComparableResource } from "../resourceHash";
import { replaceManagedSection, stripManagedSection } from "../managedSections";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir,
  isAgentEnvOwnedFile,
  markerPathFor,
  markerPathForFile
} from "../ownershipMarkers";
import { findSecretWarnings } from "../secretWarnings";
import { materializeTomlMcpRefs } from "../mcpRefs";
import { removeSkillDeployment } from "../skillDeployment";
import { findUnmanagedMcpConflicts, validateToml } from "../tomlConfig";
import {
  addSkillRefBackupPaths,
  applySkillRefs,
  skillTargetNames,
  validateSkillRefs
} from "./skillRefs";
import type { AgentTargetAdapter, TargetAssetInput } from "./types";
import { createProfileFileDriver } from "./shared/profileFiles";

const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

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

const buildSkillsConfigToml = (profile: ProfileDetail): string => {
  if (profile.assetPolicy.disabledSkillPaths.length === 0) {
    return "";
  }

  return profile.assetPolicy.disabledSkillPaths
    .map(
      (path) => `[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false`
    )
    .join("\n\n");
};

const invalidMessage = (label: string, message: string) => `${label}: ${message}`;
const isOwnedSkillDir = async (targetDir: string, targetPaths: TargetPaths) =>
  isAgentEnvOwnedDir(targetDir, { targetId: targetPaths.targetId, kind: "skill" });

const validateAssets = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  const errors: string[] = [];
  const ownedFiles = profile.assetPolicy.ownedFiles ?? [];

  if (!targetPaths.skillsDir && profile.assetPolicy.ownedDirs.length > 0) {
    return ["Codex target does not expose a skills directory"];
  }
  if (!profile.profileDir && (profile.assetPolicy.ownedDirs.length > 0 || ownedFiles.length > 0)) {
    return ["Profile directory is required to copy owned assets"];
  }

  for (const ownedDir of profile.assetPolicy.ownedDirs) {
    if (ownedDir.kind !== "skill") {
      errors.push(`Codex does not support owned ${ownedDir.kind} directories`);
      continue;
    }

    const sourceDir = join(profile.profileDir ?? "", ownedDir.source);
    const targetDir = join(targetPaths.skillsDir ?? "", ownedDir.targetName);
    if (!(await pathExists(sourceDir))) {
      errors.push(`Owned skill source does not exist: ${sourceDir}`);
    }
    if (
      !input.isolateSkillRoot &&
      (await pathExists(targetDir)) &&
      !(await isOwnedSkillDir(targetDir, targetPaths))
    ) {
      errors.push(`Skill target already exists and is not AgentEnv-owned: ${targetDir}`);
    }
  }

  for (const ownedFile of ownedFiles) {
    if (ownedFile.kind !== "agent") {
      errors.push(`Codex does not support owned ${ownedFile.kind} files`);
      continue;
    }
    if (!targetPaths.agentsDir) {
      errors.push("Codex target does not expose an agents directory");
      continue;
    }

    const sourceFile = join(profile.profileDir ?? "", ownedFile.source);
    const targetFile = join(targetPaths.agentsDir, ownedFile.targetName);
    if (!(await pathExists(sourceFile))) {
      errors.push(`Owned agent source does not exist: ${sourceFile}`);
    }
    const targetExists = await pathExists(targetFile);
    const owned = targetExists && await isAgentEnvOwnedFile(targetFile, {
      targetId: targetPaths.targetId,
      kind: "agent"
    });
    const matching =
      targetExists && (await pathExists(sourceFile)) && input.allowMatchingUnmanagedAssets &&
      (await hashComparableResource(sourceFile)) === (await hashComparableResource(targetFile));
    if (targetExists && !owned && !matching) {
      errors.push(`Agent target already exists and is not AgentEnv-owned: ${targetFile}`);
    }
  }

  errors.push(...(await validateSkillRefs(input)));

  return errors;
};

const removeStaleOwnedSkills = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  if (!targetPaths.skillsDir || !(await pathExists(targetPaths.skillsDir))) {
    return;
  }

  const desired = new Set(
    profile.assetPolicy.ownedDirs
      .filter((ownedDir) => ownedDir.kind === "skill")
      .map((ownedDir) => ownedDir.targetName)
  );
  for (const skillName of skillTargetNames(input)) {
    desired.add(skillName);
  }
  const entries = await readdir(targetPaths.skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || desired.has(entry.name)) {
      continue;
    }

    const targetDir = join(targetPaths.skillsDir, entry.name);
    if (
      await isOwnedSkillDir(targetDir, targetPaths)
    ) {
      await removeSkillDeployment(targetDir);
    }
  }
};

const legacyOwnedSkillDirs = async (targetPaths: TargetPaths) => {
  const matches: string[] = [];
  for (const location of targetPaths.skillLocations ?? []) {
    if (location.role !== "compatibility-runtime" || !(await pathExists(location.path))) continue;
    for (const entry of await readdir(location.path, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const targetDir = join(location.path, entry.name);
      if (await isOwnedSkillDir(targetDir, targetPaths)) matches.push(targetDir);
    }
  }
  return matches;
};

const removeStaleOwnedAgentFiles = async ({ profile, targetPaths }: TargetAssetInput) => {
  if (!targetPaths.agentsDir || !(await pathExists(targetPaths.agentsDir))) {
    return;
  }

  const desired = new Set(
    (profile.assetPolicy.ownedFiles ?? [])
      .filter((ownedFile) => ownedFile.kind === "agent")
      .map((ownedFile) => ownedFile.targetName)
  );
  const entries = await readdir(targetPaths.agentsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith(".agentenv-owner.json") || desired.has(entry.name)) {
      continue;
    }

    const targetFile = join(targetPaths.agentsDir, entry.name);
    if (await isAgentEnvOwnedFile(targetFile, {
      targetId: targetPaths.targetId,
      kind: "agent"
    })) {
      await rm(targetFile, { force: true });
      await rm(markerPathForFile(targetFile), { force: true });
    }
  }
};

const getAssetBackupPaths = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  const paths = new Set<string>();
  const desired = new Set(
    profile.assetPolicy.ownedDirs
      .filter((ownedDir) => ownedDir.kind === "skill")
      .map((ownedDir) => ownedDir.targetName)
  );

  if (targetPaths.skillsDir) {
    for (const ownedDir of profile.assetPolicy.ownedDirs) {
      if (ownedDir.kind === "skill" && !input.isolateSkillRoot) {
        paths.add(join(targetPaths.skillsDir, ownedDir.targetName));
      }
    }
  }
  addSkillRefBackupPaths(paths, targetPaths, input);
  if (!input.isolateSkillRoot) {
    for (const legacyPath of await legacyOwnedSkillDirs(targetPaths)) {
      paths.add(legacyPath);
    }
  }
  if (targetPaths.agentsDir) {
    for (const ownedFile of profile.assetPolicy.ownedFiles ?? []) {
      if (ownedFile.kind === "agent") {
        const targetFile = join(targetPaths.agentsDir, ownedFile.targetName);
        paths.add(targetFile);
        paths.add(markerPathForFile(targetFile));
      }
    }
  }

  if (
    !input.isolateSkillRoot &&
    targetPaths.skillsDir &&
    (await pathExists(targetPaths.skillsDir))
  ) {
    const entries = await readdir(targetPaths.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || desired.has(entry.name)) {
        continue;
      }

      const targetDir = join(targetPaths.skillsDir, entry.name);
      if (
        await isOwnedSkillDir(targetDir, targetPaths)
      ) {
        paths.add(targetDir);
        paths.add(markerPathForFile(targetDir));
      }
    }
  }

  if (targetPaths.agentsDir && (await pathExists(targetPaths.agentsDir))) {
    const desired = new Set(
      (profile.assetPolicy.ownedFiles ?? [])
        .filter((ownedFile) => ownedFile.kind === "agent")
        .map((ownedFile) => ownedFile.targetName)
    );
    const entries = await readdir(targetPaths.agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith(".agentenv-owner.json") || desired.has(entry.name)) {
        continue;
      }

      const targetFile = join(targetPaths.agentsDir, entry.name);
      if (
        await isAgentEnvOwnedFile(targetFile, {
          targetId: targetPaths.targetId,
          kind: "agent"
        })
      ) {
        paths.add(targetFile);
        paths.add(markerPathForFile(targetFile));
      }
    }
  }

  return [...paths];
};

const applyAssets = async (input: TargetAssetInput) => {
  const { profile, targetPaths } = input;
  await removeStaleOwnedSkills(input);
  await removeStaleOwnedAgentFiles(input);

  for (const ownedDir of profile.assetPolicy.ownedDirs) {
    const sourceDir = join(profile.profileDir ?? "", ownedDir.source);
    const targetDir = join(targetPaths.skillsDir ?? "", ownedDir.targetName);

    const owned = await isOwnedSkillDir(targetDir, targetPaths);
    if ((await pathEntryExists(targetDir)) && !owned) {
      throw new Error(
        `Skill target changed after preview and is not AgentEnv-owned: ${targetDir}`
      );
    }

    await mkdir(targetPaths.skillsDir ?? "", { recursive: true });
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

  for (const ownedFile of profile.assetPolicy.ownedFiles ?? []) {
    if (ownedFile.kind !== "agent" || !targetPaths.agentsDir) {
      continue;
    }
    const sourceFile = join(profile.profileDir ?? "", ownedFile.source);
    const targetFile = join(targetPaths.agentsDir, ownedFile.targetName);

    const owned = await isAgentEnvOwnedFile(targetFile, {
      targetId: targetPaths.targetId,
      kind: "agent"
    });
    const matching =
      input.allowMatchingUnmanagedAssets &&
      await pathExists(sourceFile) &&
      await pathExists(targetFile) &&
      (await hashComparableResource(sourceFile)) === (await hashComparableResource(targetFile));
    if ((await pathEntryExists(targetFile)) && !owned && !matching) {
      throw new Error(
        `Agent target changed after preview and is not AgentEnv-owned: ${targetFile}`
      );
    }

    await mkdir(dirname(targetFile), { recursive: true });
    await replacePathAtomically(targetFile, (stagingPath) => cp(sourceFile, stagingPath));
    await writeAtomic(
      markerPathForFile(targetFile),
      createOwnerMarkerContent({
        profileId: profile.id,
        targetId: targetPaths.targetId,
        kind: ownedFile.kind,
        source: ownedFile.source
      })
    );
  }
  await applySkillRefs(input);
  if (!input.isolateSkillRoot) {
    for (const legacyPath of await legacyOwnedSkillDirs(targetPaths)) {
      await removeSkillDeployment(legacyPath);
    }
  }
};

const readAssetPolicy = async (profileDir: string) => {
  const assetPath = join(profileDir, "assets.json");
  if (await pathExists(assetPath)) {
    return AssetPolicySchema.parse(JSON.parse(await readFile(assetPath, "utf8")));
  }

  return LegacySkillsPolicySchema.parse(
    JSON.parse(await readFile(join(profileDir, "skills.json"), "utf8"))
  );
};

const readConfigText = async (profileDir: string) => {
  const configPath = join(profileDir, "config.toml");
  if (await pathExists(configPath)) {
    return readFile(configPath, "utf8");
  }
  return readFile(join(profileDir, "mcp.toml"), "utf8");
};

const profileFiles = createProfileFileDriver({
  instructionsFile: "AGENTS.md",
  configFile: "config.toml",
  readConfigText,
  readAssetPolicy
});

export const createCodexTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "codex",
    name: "Codex",
    description: "Manage global Codex instructions, TOML config sections, and skills.",
    iconKey: "codex",
    displayOrder: 1,
    instructionsLabel: "AGENTS.md",
    configLabel: "config.toml managed fragment",
    configLanguage: "toml",
    mcpConfigKey: "mcp_servers",
    realWritesEnabled: true,
    executableName: "codex",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      agentFormat: "codex",
      disabledSkillPaths: true
    }
  },
  createTargetPaths: ({ homeDir }) => {
    const codexHome = join(homeDir, ".codex");
    const skillsDir = join(codexHome, "skills");
    const sharedSkillsDir = join(homeDir, ".agents", "skills");
    return {
      targetId: "codex",
      configDir: codexHome,
      instructionsPath: join(codexHome, "AGENTS.md"),
      instructionsOverridePath: join(codexHome, "AGENTS.override.md"),
      configPath: join(codexHome, "config.toml"),
      agentsDir: join(codexHome, "agents"),
      skillsDir,
      skillLocations: [
        { path: skillsDir, role: "preferred-runtime", shared: false },
        { path: sharedSkillsDir, role: "compatibility-runtime", shared: true }
      ],
      skillScanDirs: [skillsDir, sharedSkillsDir]
    };
  },
  createDefaultProfile: (id) => ({
    id,
    manifest: {
      id,
      targetId: "codex",
      name: "Codex Daily Coding",
      description: "Default Codex environment",
      version: 1,
      managed: { instructions: true, config: true, assets: true }
    },
    instructions:
      "# Global Codex Guidance\n\n- Keep changes scoped and reversible.\n- Preview environment changes before applying them.\n",
    configText: "",
    assetPolicy: { ownedDirs: [], ownedFiles: [], skillRefs: [], mcpRefs: [], disabledSkillPaths: [] }
  }),
  captureProfile: async (targetPaths) => {
    const [instructions, configText] = await Promise.all([
      readTextIfExists(targetPaths.instructionsPath),
      readTextIfExists(targetPaths.configPath)
    ]);
    const parsed = TOML.parse(configText || "") as Record<string, unknown>;
    const rawServers =
      parsed.mcp_servers && typeof parsed.mcp_servers === "object" && !Array.isArray(parsed.mcp_servers)
        ? (parsed.mcp_servers as Record<string, unknown>)
        : {};
    const mcpServers = [];
    const excluded: string[] = [];
    for (const [name, raw] of Object.entries(rawServers)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        excluded.push(`mcp_servers.${name}`);
        continue;
      }
      const server = raw as Record<string, unknown>;
      const command = typeof server.command === "string" ? server.command : undefined;
      const url = typeof server.url === "string" ? server.url : undefined;
      const args = Array.isArray(server.args)
        ? server.args.filter((item): item is string => typeof item === "string")
        : [];
      const envVars = Array.isArray(server.env_vars)
        ? server.env_vars.filter((item): item is string => typeof item === "string")
        : [];
      if ((!command && !url) || server.env || server.http_headers || server.env_http_headers) {
        excluded.push(`mcp_servers.${name}`);
        continue;
      }
      mcpServers.push({
        id: name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp-server",
        name,
        transport: command ? "stdio" as const : "http" as const,
        ...(command ? { command, args, env: Object.fromEntries(envVars.map((item) => [item, item])) } : { url, args: [], env: {} })
      });
    }
    const skills =
      parsed.skills && typeof parsed.skills === "object" && !Array.isArray(parsed.skills)
        ? (parsed.skills as Record<string, unknown>)
        : {};
    const disabledSkillPaths = Array.isArray(skills.config)
      ? skills.config.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          return item.enabled === false && typeof item.path === "string" ? [item.path] : [];
        })
      : [];
    const managedKeys = new Set(["mcp_servers", "skills"]);
    const nativeKeys = Object.keys(parsed).filter((key) => !managedKeys.has(key));
    return {
      instructions,
      configText: "",
      mcpServers,
      disabledSkillPaths,
      warnings: [
        ...excluded.map((path) => `${path} was excluded because it contains unsupported or literal credential fields`),
        ...(nativeKeys.length > 0 ? [`Codex native settings remain Target-owned: ${nativeKeys.join(", ")}`] : [])
      ],
      excluded: excluded.concat(nativeKeys.map((key) => `config.toml.${key}`))
    };
  },
  ...profileFiles,
  materializeMcpRefs: materializeTomlMcpRefs,
  createPreview: async ({ profile, targetPaths, allowMatchingUnmanagedConfig }): Promise<TargetActivationPreview> => {
    const createdState: TargetState = {
      managedConfigKeys: [],
      managedMcpNames: []
    };
    const warnings = findSecretWarnings(profile.instructions).concat(
      findSecretWarnings(profile.configText)
    );
    const errors: string[] = [];
    const changes: PlannedFileChange[] = [];

    const [liveInstructions, liveConfig] = await Promise.all([
      readTextIfExists(targetPaths.instructionsPath),
      readTextIfExists(targetPaths.configPath)
    ]);

    if (
      targetPaths.instructionsOverridePath &&
      (await pathExists(targetPaths.instructionsOverridePath))
    ) {
      warnings.push(
        `${targetPaths.instructionsOverridePath} exists and may override AGENTS.md`
      );
    }

    if (profile.manifest.managed.instructions) {
      addChange(
        changes,
        targetPaths.instructionsPath,
        liveInstructions,
        profile.instructions
      );
    }

    const skillsToml = profile.manifest.managed.assets
      ? buildSkillsConfigToml(profile)
      : "";
    const hasManagedMcpSection = liveConfig.includes("AgentEnv Manager: mcp");
    const hasManagedSkillsSection = liveConfig.includes("AgentEnv Manager: skills");
    const shouldManageMcp =
      profile.manifest.managed.config &&
      (profile.configText.trim().length > 0 || hasManagedMcpSection);
    const shouldManageSkills =
      profile.manifest.managed.assets &&
      (skillsToml.trim().length > 0 || hasManagedSkillsSection);
    const shouldManageConfig = shouldManageMcp || shouldManageSkills;
    const liveValidation = shouldManageConfig ? validateToml(liveConfig) : { ok: true as const };
    if (!liveValidation.ok) {
      errors.push(invalidMessage("Invalid live config.toml", liveValidation.message));
    }

    const profileMcpValidation = shouldManageMcp
      ? validateToml(profile.configText)
      : { ok: true as const };
    if (!profileMcpValidation.ok) {
      errors.push(invalidMessage("Invalid profile MCP TOML", profileMcpValidation.message));
    }

    if (shouldManageConfig && liveValidation.ok && profileMcpValidation.ok) {
      const conflicts = shouldManageMcp
        ? findUnmanagedMcpConflicts(liveConfig, profile.configText, allowMatchingUnmanagedConfig)
        : [];
      errors.push(
        ...conflicts.map(
          (name) =>
            `MCP server ${name} already exists outside AgentEnv-managed section`
        )
      );

      if (conflicts.length === 0) {
        const nextConfigWithMcp = shouldManageMcp
          ? profile.configText.trim().length > 0
            ? replaceManagedSection(liveConfig, "mcp", profile.configText)
            : stripManagedSection(liveConfig, "mcp")
          : liveConfig;
        const nextConfig = shouldManageSkills
          ? skillsToml.trim().length > 0
            ? replaceManagedSection(nextConfigWithMcp, "skills", skillsToml)
            : stripManagedSection(nextConfigWithMcp, "skills")
          : nextConfigWithMcp;
        const finalValidation = validateToml(nextConfig);

        if (!finalValidation.ok) {
          errors.push(
            invalidMessage("Invalid planned config.toml", finalValidation.message)
          );
        } else {
          addChange(changes, targetPaths.configPath, liveConfig, nextConfig);
        }
      }
    }

    return {
      warnings,
      errors,
      changes,
      liveFingerprints: {
        [targetPaths.instructionsPath]: hashText(liveInstructions),
        ...(shouldManageConfig ? { [targetPaths.configPath]: hashText(liveConfig) } : {})
      },
      targetState: createdState
    };
  },
  validateAssets,
  getAssetBackupPaths,
  applyAssets
});
