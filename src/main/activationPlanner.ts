import { createHash, randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import type { AgentEnvPaths } from "./paths";
import type {
  ActivationPreview,
  PlannedFileChange,
  ProfileDetail
} from "../shared/types";
import { createUnifiedDiff } from "./diff";
import { replaceManagedSection } from "./managedSections";
import { findSecretWarnings } from "./secretWarnings";
import { findUnmanagedMcpConflicts, validateToml } from "./tomlConfig";

export interface CreateActivationPreviewInput {
  paths: AgentEnvPaths;
  profile: ProfileDetail;
}

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

export const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const readTextIfExists = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }
    throw error;
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

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
  if (profile.skillsPolicy.disabledSkillPaths.length === 0) {
    return "";
  }

  return profile.skillsPolicy.disabledSkillPaths
    .map(
      (path) => `[[skills.config]]\npath = ${JSON.stringify(path)}\nenabled = false`
    )
    .join("\n\n");
};

const invalidMessage = (label: string, message: string) =>
  `${label}: ${message}`;

export const createActivationPreview = async ({
  paths,
  profile
}: CreateActivationPreviewInput): Promise<ActivationPreview> => {
  const createdAt = new Date().toISOString();
  const warnings = findSecretWarnings(profile.agentsMd).concat(
    findSecretWarnings(profile.mcpToml)
  );
  const errors: string[] = [];
  const changes: PlannedFileChange[] = [];

  const [liveAgents, liveConfig] = await Promise.all([
    readTextIfExists(paths.globalAgentsPath),
    readTextIfExists(paths.codexConfigPath)
  ]);

  if (await pathExists(paths.globalAgentsOverridePath)) {
    warnings.push(
      `${paths.globalAgentsOverridePath} exists and may override AGENTS.md`
    );
  }

  addChange(changes, paths.globalAgentsPath, liveAgents, profile.agentsMd);

  const liveValidation = validateToml(liveConfig);
  if (!liveValidation.ok) {
    errors.push(invalidMessage("Invalid live config.toml", liveValidation.message));
  }

  const profileMcpValidation = validateToml(profile.mcpToml);
  if (!profileMcpValidation.ok) {
    errors.push(
      invalidMessage("Invalid profile MCP TOML", profileMcpValidation.message)
    );
  }

  if (liveValidation.ok && profileMcpValidation.ok) {
    const conflicts = findUnmanagedMcpConflicts(liveConfig, profile.mcpToml);
    errors.push(
      ...conflicts.map(
        (name) =>
          `MCP server ${name} already exists outside AgentEnv-managed section`
      )
    );

    if (conflicts.length === 0) {
      const skillsToml = buildSkillsConfigToml(profile);
      const nextConfigWithMcp = replaceManagedSection(
        liveConfig,
        "mcp",
        profile.mcpToml
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
        addChange(changes, paths.codexConfigPath, liveConfig, nextConfig);
      }
    }
  }

  return {
    id: randomUUID(),
    profileId: profile.id,
    createdAt,
    warnings,
    errors,
    changes,
    liveFingerprints: {
      [paths.globalAgentsPath]: hashText(liveAgents),
      [paths.codexConfigPath]: hashText(liveConfig)
    }
  };
};
