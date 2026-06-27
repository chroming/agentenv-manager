import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEnvPaths } from "./paths";

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const hasAnyProfiles = async (profilesDir: string): Promise<boolean> => {
  try {
    return (await readdir(profilesDir)).length > 0;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

export const seedDefaultProfiles = async (paths: AgentEnvPaths) => {
  if (await hasAnyProfiles(paths.profilesDir)) {
    return;
  }

  const profileDir = join(paths.profilesDir, "daily-coding");
  await mkdir(profileDir, { recursive: true });
  await Promise.all([
    writeFile(
      join(profileDir, "profile.json"),
      `${JSON.stringify(
        {
          id: "daily-coding",
          name: "Daily Coding",
          description: "Default Codex environment",
          version: 1,
          managed: { agents: true, mcp: true, skills: true }
        },
        null,
        2
      )}\n`,
      "utf8"
    ),
    writeFile(
      join(profileDir, "AGENTS.md"),
      "# Global Codex Guidance\n\n- Keep changes scoped and reversible.\n- Preview environment changes before applying them.\n",
      "utf8"
    ),
    writeFile(join(profileDir, "mcp.toml"), "", "utf8"),
    writeFile(
      join(profileDir, "skills.json"),
      `${JSON.stringify({ ownedSkillDirs: [], disabledSkillPaths: [] }, null, 2)}\n`,
      "utf8"
    )
  ]);
};
