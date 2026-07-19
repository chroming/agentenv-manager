import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
import { parseSkillFrontmatter } from "../skillFrontmatter";
import { removeSkillDeployment } from "../skillDeployment";
import { setMcpServerEnabled, validateToml } from "../tomlConfig";
import {
  addSkillRefBackupPaths,
  applySkillRefs,
  skillTargetNames,
  validateSkillRefs
} from "./skillRefs";
import type { AgentTargetAdapter, TargetAssetInput } from "./types";
import { createProfileFileDriver } from "./shared/profileFiles";
import { createFilesystemSkillDriver } from "./shared/skillRuntime";
import { createCommandInstallationDriver } from "./installationDiscovery";

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
      !(await isOwnedSkillDir(targetDir, targetPaths)) &&
      input.replaceablePaths?.has(targetDir) !== true
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
    const replaceable = input.replaceablePaths?.has(targetFile) === true;
    if (targetExists && !owned && !matching && !replaceable) {
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
    const replaceable = input.replaceablePaths?.has(targetDir) === true;
    if ((await pathEntryExists(targetDir)) && !owned && !replaceable) {
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
    const replaceable = input.replaceablePaths?.has(targetFile) === true;
    if ((await pathEntryExists(targetFile)) && !owned && !matching && !replaceable) {
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

const readCodexDisabledSkillNames = async (targetPaths: TargetPaths) => {
  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(
      stripManagedSection(await readTextIfExists(targetPaths.configPath), "skills")
    ) as Record<string, unknown>;
  } catch {
    return new Set<string>();
  }
  const skillsConfig =
    parsed.skills && typeof parsed.skills === "object" && !Array.isArray(parsed.skills)
      ? (parsed.skills as Record<string, unknown>).config
      : undefined;
  if (!Array.isArray(skillsConfig)) return new Set<string>();

  const disabledEntries: Array<{ name?: string; path?: string }> = [];
  for (const entry of skillsConfig) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    if (item.enabled !== false) continue;
    if (typeof item.name === "string" && item.name.trim()) {
      disabledEntries.push({ name: item.name.trim() });
    } else if (typeof item.path === "string") {
      disabledEntries.push({ path: item.path });
    }
  }
  const disabledNames = await Promise.all(
    disabledEntries.map(async (entry) => {
      if (entry.name) return entry.name;
      const path = entry.path ?? "";
      const manifestPath = path.endsWith("SKILL.md") ? path : join(path, "SKILL.md");
      const frontmatter = parseSkillFrontmatter(await readTextIfExists(manifestPath));
      return frontmatter.name || basename(path.endsWith("SKILL.md") ? dirname(path) : path);
    })
  );
  return new Set(disabledNames.filter(Boolean));
};

const skills = createFilesystemSkillDriver({
  targetId: "codex",
  readDisabledRuntimeNames: readCodexDisabledSkillNames
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
      disabledSkillPaths: true,
      mcpActivation: true
    }
  },
  detectInstallation: createCommandInstallationDriver("codex").detectInstallation,
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
        {
          path: skillsDir,
          role: "preferred-runtime",
          shared: false,
          scope: "user",
          scanDepth: "direct",
          management: "managed"
        },
        {
          path: sharedSkillsDir,
          role: "compatibility-runtime",
          shared: true,
          scope: "shared",
          scanDepth: "recursive",
          management: "legacy"
        }
      ],
      skillScanDirs: [skillsDir, sharedSkillsDir]
    };
  },
  skills,
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
    const mcpConnections = Object.entries(rawServers)
      .filter(([, raw]) =>
        Boolean(raw && typeof raw === "object" && !Array.isArray(raw))
      )
      .map(([name, raw]) => {
        const server = raw as Record<string, unknown>;
        const type =
          typeof server.type === "string"
            ? server.type.toLowerCase()
            : undefined;
        return {
          targetId: "codex",
          name,
          scope: "user" as const,
          transport:
            typeof server.command === "string"
              ? ("stdio" as const)
              : type === "sse"
                ? ("sse" as const)
                : typeof server.url === "string"
                  ? ("http" as const)
                  : undefined,
          enabled: server.enabled !== false,
          controllable: true,
          sourcePath: targetPaths.configPath
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const skills =
      parsed.skills && typeof parsed.skills === "object" && !Array.isArray(parsed.skills)
        ? (parsed.skills as Record<string, unknown>)
        : {};
    const disabledSkillEntries = Array.isArray(skills.config)
      ? skills.config.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          return item.enabled === false ? [item] : [];
        })
      : [];
    const disabledSkillPaths = disabledSkillEntries.flatMap((item) =>
      typeof item.path === "string" ? [item.path] : []
    );
    const disabledSkillNames = disabledSkillEntries.flatMap((item) =>
      typeof item.name === "string" && item.name.trim() ? [item.name.trim()] : []
    );
    const managedKeys = new Set(["mcp_servers", "skills"]);
    const nativeKeys = Object.keys(parsed).filter((key) => !managedKeys.has(key));
    return {
      instructions,
      configText: "",
      mcpServers: [],
      mcpConnections,
      disabledSkillPaths,
      warnings: [
        ...(nativeKeys.length > 0
          ? [
              `Codex native settings remain Target-owned: ${nativeKeys.join(", ")}`
            ]
          : []),
        ...(disabledSkillNames.length > 0
          ? [
              `Codex native disabled Skills remain Target-owned: ${disabledSkillNames.join(", ")}`
            ]
          : [])
      ],
      excluded: [
        ...nativeKeys.map((key) => `config.toml.${key}`),
        ...disabledSkillNames.map((name) => `config.toml.skills.config.${name}`)
      ]
    };
  },
  ...profileFiles,
  materializeMcpRefs: (profile) => profile,
  createPreview: async ({
    profile,
    targetPaths,
    state
  }): Promise<TargetActivationPreview> => {
    const activeState = state ?? { managedConfigKeys: [], managedMcpNames: [] };
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
    const hasManagedSkillsSection = liveConfig.includes(
      "AgentEnv Manager: skills"
    );
    const selectedMcpStates = new Map(
      (profile.assetPolicy.mcpSelections ?? [])
        .filter((selection) => selection.targetId === "codex")
        .map(
          (selection) => [selection.name, selection.enabled !== false] as const
        )
    );
    const shouldManageMcp =
      profile.manifest.managed.config &&
      (selectedMcpStates.size > 0 || activeState.managedMcpNames.length > 0);
    const shouldManageSkills =
      profile.manifest.managed.assets &&
      (skillsToml.trim().length > 0 || hasManagedSkillsSection);
    const shouldManageConfig = shouldManageMcp || shouldManageSkills;
    const liveValidation = shouldManageConfig ? validateToml(liveConfig) : { ok: true as const };
    if (!liveValidation.ok) {
      errors.push(invalidMessage("Invalid live config.toml", liveValidation.message));
    }

    let managedMcpNames: string[] = [];
    if (shouldManageConfig && liveValidation.ok) {
      let nextConfigWithMcp = liveConfig;
      if (shouldManageMcp) {
        const controlledNames = new Set<string>();
        for (const [name, enabled] of selectedMcpStates) {
          const result = setMcpServerEnabled(nextConfigWithMcp, name, enabled);
          if (!result.found) {
            warnings.push(
              `MCP server ${name} is not configured in Codex; set it up in Codex before applying this selection`
            );
            continue;
          }
          nextConfigWithMcp = result.content;
          controlledNames.add(name);
        }
        managedMcpNames = [...controlledNames].sort((left, right) =>
          left.localeCompare(right)
        );
      }
      {
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
      targetState: {
        managedConfigKeys: activeState.managedConfigKeys,
        managedMcpNames
      }
    };
  },
  validateAssets,
  getAssetBackupPaths,
  applyAssets
});
