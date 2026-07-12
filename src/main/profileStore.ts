import { cp, lstat, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  ProfileManifestSchema,
  SafeIdSchema
} from "../shared/schemas";
import type {
  ProfileDetail,
  ProfileSummary,
  CreateProfileInput,
  SaveProfileInput
} from "../shared/types";
import { createPaths, type PathOverrides } from "./paths";
import { createProfileContentHash } from "./profileFingerprint";
import { targetProfile } from "./profileTargeting";
import { createTargetRegistry, type TargetRegistry } from "./targets/registry";
import { pathEntryExists, replacePathAtomically, writeAtomic } from "./fileUtils";

export interface ProfileStore {
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
  createProfile(input: CreateProfileInput): Promise<ProfileDetail>;
  duplicateProfile(id: string): Promise<ProfileDetail>;
  deleteProfile(id: string): Promise<void>;
}

const readJson = async (path: string): Promise<unknown> => {
  const content = await readFile(path, "utf8");
  return JSON.parse(content);
};

const slugProfileName = (name: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return SafeIdSchema.safeParse(slug).success ? slug : "profile";
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
    const profileStats = await lstat(profileDir);
    if (!profileStats.isDirectory() || profileStats.isSymbolicLink()) {
      throw new Error(`Profile storage must be a real directory: ${parsedId.data}`);
    }
    const manifest = ProfileManifestSchema.parse(
      await readJson(join(profileDir, "profile.json"))
    );
    const profile = await targetRegistry
      .get(manifest.targetId)
      .readProfileFiles(profileDir, manifest);
    const targetContentHashes = Object.fromEntries(
      targetRegistry.listAdapters().map((adapter) => {
        const targeted = targetProfile(profile, adapter).profile;
        return [adapter.descriptor.id, createProfileContentHash(targeted)];
      })
    );
    return {
      ...profile,
      contentHash: targetContentHashes[manifest.targetId],
      targetContentHashes
    };
  };

  const listProfiles = async (): Promise<ProfileSummary[]> => {
    let entries: string[];
    try {
      entries = (await readdir(paths.profilesDir)).filter(
        (entry) => !entry.includes(".agentenv-")
      );
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
          description: profile.manifest.description,
          iconKey: profile.manifest.iconKey,
          contentHash: profile.contentHash,
          targetContentHashes: profile.targetContentHashes
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

    if (await pathEntryExists(profileDir)) {
      const currentStats = await lstat(profileDir);
      if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) {
        throw new Error(`Profile storage must be a real directory: ${manifest.id}`);
      }
    }

    await replacePathAtomically(profileDir, async (stagingDir) => {
      if (await pathEntryExists(profileDir)) {
        await cp(profileDir, stagingDir, { recursive: true, dereference: false });
      } else {
        await mkdir(stagingDir, { recursive: true });
      }
      const stagedProfile = { ...profile, profileDir: stagingDir };
      await writeAtomic(
        join(stagingDir, "profile.json"),
        `${JSON.stringify(manifest, null, 2)}\n`
      );
      await adapter.writeProfileFiles(stagingDir, stagedProfile);
      await adapter.readProfileFiles(stagingDir, manifest);
    });

    return readProfile(manifest.id);
  };

  const createProfile = async (input: CreateProfileInput): Promise<ProfileDetail> => {
    const targetId = SafeIdSchema.parse(input.targetId);
    const adapter = targetRegistry.get(targetId);
    const idBase = input.name ? slugProfileName(input.name) : targetId;
    const id = `${idBase}-${Date.now()}`;
    const profile = adapter.createDefaultProfile(id);
    return saveProfile({
      ...profile,
      manifest: {
        ...profile.manifest,
        name: input.name?.trim() || profile.manifest.name,
        description: input.description?.trim() ?? profile.manifest.description
      }
    });
  };

  const duplicateProfile = async (id: string): Promise<ProfileDetail> => {
    const parsedId = SafeIdSchema.parse(id);
    const profile = await readProfile(parsedId);
    const duplicateId = `${parsedId}-copy-${Date.now()}`;
    const sourceDir = join(paths.profilesDir, parsedId);
    const targetDir = join(paths.profilesDir, duplicateId);
    const manifest = {
      ...profile.manifest,
      id: duplicateId,
      name: `${profile.manifest.name} Copy`
    };

    await replacePathAtomically(targetDir, async (stagingDir) => {
      await cp(sourceDir, stagingDir, { recursive: true, dereference: false });
      await writeAtomic(
        join(stagingDir, "profile.json"),
        `${JSON.stringify(manifest, null, 2)}\n`
      );
    });

    return readProfile(duplicateId);
  };

  const deleteProfile = async (id: string): Promise<void> => {
    const parsedId = SafeIdSchema.parse(id);
    const profileDir = join(paths.profilesDir, parsedId);
    if (!(await pathEntryExists(profileDir))) {
      return;
    }
    const trashDir = join(paths.appDataRoot, "trash", "profiles");
    await mkdir(trashDir, { recursive: true, mode: 0o700 });
    await rename(profileDir, join(trashDir, `${parsedId}-${Date.now()}`));
  };

  return { listProfiles, readProfile, saveProfile, createProfile, duplicateProfile, deleteProfile };
};
