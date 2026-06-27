import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ProfileManifestSchema,
  SafeIdSchema,
  SkillsPolicySchema
} from "../shared/schemas";
import type { ProfileDetail, ProfileSummary } from "../shared/types";
import { createPaths, type PathOverrides } from "./paths";

export interface ProfileStore {
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
}

const readJson = async (path: string): Promise<unknown> => {
  const content = await readFile(path, "utf8");
  return JSON.parse(content);
};

export const createProfileStore = (overrides: PathOverrides): ProfileStore => {
  const paths = createPaths(overrides);

  const readProfile = async (id: string): Promise<ProfileDetail> => {
    const parsedId = SafeIdSchema.safeParse(id);
    if (!parsedId.success) {
      throw new Error("Invalid profile id");
    }

    const profileDir = join(paths.profilesDir, parsedId.data);
    const manifest = ProfileManifestSchema.parse(
      await readJson(join(profileDir, "profile.json"))
    );
    const skillsPolicy = SkillsPolicySchema.parse(
      await readJson(join(profileDir, "skills.json"))
    );
    const [agentsMd, mcpToml] = await Promise.all([
      readFile(join(profileDir, "AGENTS.md"), "utf8"),
      readFile(join(profileDir, "mcp.toml"), "utf8")
    ]);

    return {
      id: manifest.id,
      manifest,
      agentsMd,
      mcpToml,
      skillsPolicy
    };
  };

  const listProfiles = async (): Promise<ProfileSummary[]> => {
    let entries: string[];
    try {
      entries = await readdir(paths.profilesDir);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const summaries = await Promise.all(
      entries.map(async (entry) => {
        const profile = await readProfile(entry);
        return {
          id: profile.manifest.id,
          name: profile.manifest.name,
          description: profile.manifest.description
        };
      })
    );

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  };

  return { listProfiles, readProfile };
};
