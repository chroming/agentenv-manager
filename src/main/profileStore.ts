import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ProfileManifestSchema,
  SafeIdSchema
} from "../shared/schemas";
import type {
  ProfileDetail,
  ProfileSummary,
  SaveProfileInput
} from "../shared/types";
import { createPaths, type PathOverrides } from "./paths";
import { createTargetRegistry, type TargetRegistry } from "./targets/registry";

export interface ProfileStore {
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
  createProfile(targetId: string): Promise<ProfileDetail>;
}

const readJson = async (path: string): Promise<unknown> => {
  const content = await readFile(path, "utf8");
  return JSON.parse(content);
};

export const createProfileStore = (
  overrides: PathOverrides,
  targetRegistry: TargetRegistry = createTargetRegistry()
): ProfileStore => {
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
    return targetRegistry.get(manifest.targetId).readProfileFiles(profileDir, manifest);
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
          targetId: profile.manifest.targetId,
          name: profile.manifest.name,
          description: profile.manifest.description
        };
      })
    );

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  };

  const saveProfile = async (input: SaveProfileInput): Promise<ProfileDetail> => {
    const manifest = ProfileManifestSchema.parse(input.manifest);
    const profileDir = join(paths.profilesDir, manifest.id);
    const adapter = targetRegistry.get(manifest.targetId);
    const profile: ProfileDetail = {
      id: manifest.id,
      profileDir,
      manifest,
      instructions: input.instructions,
      configText: input.configText,
      assetPolicy: input.assetPolicy
    };

    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "profile.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    await adapter.writeProfileFiles(profileDir, profile);

    return readProfile(manifest.id);
  };

  const createProfile = async (targetId: string): Promise<ProfileDetail> => {
    const adapter = targetRegistry.get(SafeIdSchema.parse(targetId));
    const id = `${targetId}-${Date.now()}`;
    return saveProfile(adapter.createDefaultProfile(id));
  };

  return { listProfiles, readProfile, saveProfile, createProfile };
};
