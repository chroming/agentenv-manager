import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { pathExists, readTextIfExists } from "../fileUtils";
import { replaceManagedSection } from "../managedSections";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir,
  markerPathFor
} from "../ownershipMarkers";
import { findSecretWarnings } from "../secretWarnings";
import { findUnmanagedMcpConflicts, validateToml } from "../tomlConfig";
import type { AgentTargetAdapter, TargetAssetInput } from "./types";

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

const validateAssets = async ({ profile, targetPaths }: TargetAssetInput) => {
  const errors: string[] = [];
  if (!targetPaths.skillsDir && profile.assetPolicy.ownedDirs.length > 0) {
    return ["Codex target does not expose a skills directory"];
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
      (await pathExists(targetDir)) &&
      !(await isAgentEnvOwnedDir(targetDir, {
        targetId: targetPaths.targetId,
        kind: "skill"
      }))
    ) {
      errors.push(`Skill target already exists and is not AgentEnv-owned: ${targetDir}`);
    }
  }

  return errors;
};

const removeStaleOwnedSkills = async ({ profile, targetPaths }: TargetAssetInput) => {
  if (!targetPaths.skillsDir || !(await pathExists(targetPaths.skillsDir))) {
    return;
  }

  const desired = new Set(
    profile.assetPolicy.ownedDirs
      .filter((ownedDir) => ownedDir.kind === "skill")
      .map((ownedDir) => ownedDir.targetName)
  );
  const entries = await readdir(targetPaths.skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || desired.has(entry.name)) {
      continue;
    }

    const targetDir = join(targetPaths.skillsDir, entry.name);
    if (
      await isAgentEnvOwnedDir(targetDir, {
        targetId: targetPaths.targetId,
        kind: "skill"
      })
    ) {
      await rm(targetDir, { recursive: true, force: true });
    }
  }
};

const getAssetBackupPaths = async ({ profile, targetPaths }: TargetAssetInput) => {
  const paths = new Set<string>();
  const desired = new Set(
    profile.assetPolicy.ownedDirs
      .filter((ownedDir) => ownedDir.kind === "skill")
      .map((ownedDir) => ownedDir.targetName)
  );

  if (targetPaths.skillsDir) {
    for (const ownedDir of profile.assetPolicy.ownedDirs) {
      if (ownedDir.kind === "skill") {
        paths.add(join(targetPaths.skillsDir, ownedDir.targetName));
      }
    }
  }

  if (targetPaths.skillsDir && (await pathExists(targetPaths.skillsDir))) {
    const entries = await readdir(targetPaths.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || desired.has(entry.name)) {
        continue;
      }

      const targetDir = join(targetPaths.skillsDir, entry.name);
      if (
        await isAgentEnvOwnedDir(targetDir, {
          targetId: targetPaths.targetId,
          kind: "skill"
        })
      ) {
        paths.add(targetDir);
      }
    }
  }

  return [...paths];
};

const applyAssets = async ({ profile, targetPaths }: TargetAssetInput) => {
  await removeStaleOwnedSkills({ profile, targetPaths });

  for (const ownedDir of profile.assetPolicy.ownedDirs) {
    const sourceDir = join(profile.profileDir ?? "", ownedDir.source);
    const targetDir = join(targetPaths.skillsDir ?? "", ownedDir.targetName);

    if (
      await isAgentEnvOwnedDir(targetDir, {
        targetId: targetPaths.targetId,
        kind: "skill"
      })
    ) {
      await rm(targetDir, { recursive: true, force: true });
    }

    await mkdir(targetPaths.skillsDir ?? "", { recursive: true });
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

export const createCodexTargetAdapter = (): AgentTargetAdapter => ({
  descriptor: {
    id: "codex",
    name: "Codex",
    description: "Manage global Codex instructions, TOML config sections, and skills.",
    instructionsLabel: "AGENTS.md",
    configLabel: "config.toml managed fragment",
    configLanguage: "toml",
    realWritesEnabled: false,
    executableName: "codex"
  },
  createTargetPaths: ({ homeDir, fakeHomeRoot }) => {
    const root = fakeHomeRoot ?? homeDir;
    const codexHome = join(root, ".codex");
    return {
      targetId: "codex",
      configDir: codexHome,
      instructionsPath: join(codexHome, "AGENTS.md"),
      instructionsOverridePath: join(codexHome, "AGENTS.override.md"),
      configPath: join(codexHome, "config.toml"),
      skillsDir: join(root, ".agents", "skills")
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
    assetPolicy: { ownedDirs: [], disabledSkillPaths: [] }
  }),
  readProfileFiles: async (profileDir, manifest) => {
    const [instructions, configText, assetPolicy] = await Promise.all([
      readFile(join(profileDir, "AGENTS.md"), "utf8"),
      readConfigText(profileDir),
      readAssetPolicy(profileDir)
    ]);
    return {
      id: manifest.id,
      profileDir,
      manifest,
      instructions,
      configText,
      assetPolicy
    };
  },
  writeProfileFiles: async (profileDir, profile) => {
    await mkdir(profileDir, { recursive: true });
    await Promise.all([
      writeFile(join(profileDir, "AGENTS.md"), profile.instructions, "utf8"),
      writeFile(join(profileDir, "config.toml"), profile.configText, "utf8"),
      writeFile(
        join(profileDir, "assets.json"),
        `${JSON.stringify(AssetPolicySchema.parse(profile.assetPolicy), null, 2)}\n`,
        "utf8"
      )
    ]);
  },
  createPreview: async ({ profile, targetPaths }): Promise<TargetActivationPreview> => {
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

    const liveValidation = validateToml(liveConfig);
    if (!liveValidation.ok) {
      errors.push(invalidMessage("Invalid live config.toml", liveValidation.message));
    }

    const profileMcpValidation = validateToml(profile.configText);
    if (!profileMcpValidation.ok) {
      errors.push(
        invalidMessage("Invalid profile MCP TOML", profileMcpValidation.message)
      );
    }

    if (liveValidation.ok && profileMcpValidation.ok && profile.manifest.managed.config) {
      const conflicts = findUnmanagedMcpConflicts(liveConfig, profile.configText);
      errors.push(
        ...conflicts.map(
          (name) =>
            `MCP server ${name} already exists outside AgentEnv-managed section`
        )
      );

      if (conflicts.length === 0) {
        const skillsToml = profile.manifest.managed.assets
          ? buildSkillsConfigToml(profile)
          : "";
        const nextConfigWithMcp = replaceManagedSection(
          liveConfig,
          "mcp",
          profile.configText
        );
        const nextConfig = replaceManagedSection(
          nextConfigWithMcp,
          "skills",
          skillsToml
        );
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
        [targetPaths.configPath]: hashText(liveConfig)
      },
      targetState: createdState
    };
  },
  validateAssets,
  getAssetBackupPaths,
  applyAssets
});
