import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ProfileManifestSchema,
  SafeIdSchema,
  SkillsPolicySchema
} from "../shared/schemas";
import type {
  ProfileDetail,
  ProfileSummary,
  SaveProfileInput
} from "../shared/types";
import { createPaths, type PathOverrides } from "./paths";

export interface ProfileStore {
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
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
      profileDir,
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

  const saveProfile = async (input: SaveProfileInput): Promise<ProfileDetail> => {
    const manifest = ProfileManifestSchema.parse(input.manifest);
    const skillsPolicy = SkillsPolicySchema.parse(input.skillsPolicy);
    const profileDir = join(paths.profilesDir, manifest.id);

    await mkdir(profileDir, { recursive: true });
    await Promise.all([
      writeFile(
        join(profileDir, "profile.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      ),
      writeFile(join(profileDir, "AGENTS.md"), input.agentsMd, "utf8"),
      writeFile(join(profileDir, "mcp.toml"), input.mcpToml, "utf8"),
      writeFile(
        join(profileDir, "skills.json"),
        `${JSON.stringify(skillsPolicy, null, 2)}\n`,
        "utf8"
      )
    ]);

    return readProfile(manifest.id);
  };

  return { listProfiles, readProfile, saveProfile };
};
