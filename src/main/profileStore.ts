import { lstat, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  ProfileManifestSchema,
  ProfileResourceModeSchema,
  ProfileResourcesSchema,
  ProfileSkillSchema,
  ResourceIconKeySchema,
  SafeIdSchema
} from "../shared/schemas";
import type {
  CreateProfileInput,
  ForkProfileSkillsInput,
  ProfileDetail,
  ProfileSummary,
  SaveProfileInput,
  UpdateProfileSkillsInput,
  UpdateProfileSkillsResult,
  UpdateProfileMetadataInput
} from "../shared/types";
import { setProfileResourceMode } from "../shared/profileResources";
import {
  pathEntryExists,
  replacePathAtomically,
  syncParentDirectory,
  writeAtomic
} from "./fileUtils";
import { createPaths, type PathOverrides } from "./paths";
import { createProfileContentHash } from "./profileFingerprint";
import { hashPathEntry } from "./filesystemIntegrity";
import { findSecretWarnings } from "./secretWarnings";
import { createTargetRegistry, type TargetRegistry } from "./targets/registry";

export interface ProfileStore {
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
  updateProfileSkills(input: UpdateProfileSkillsInput): Promise<UpdateProfileSkillsResult>;
  forkProfileSkills(input: ForkProfileSkillsInput): Promise<UpdateProfileSkillsResult>;
  updateProfileMetadata(input: UpdateProfileMetadataInput): Promise<ProfileDetail>;
  createProfile(input: CreateProfileInput): Promise<ProfileDetail>;
  duplicateProfile(id: string): Promise<ProfileDetail>;
  deleteProfile(id: string): Promise<void>;
}

const PROFILE_MANIFEST_FILE = "profile.json";
const PROFILE_INSTRUCTIONS_FILE = "INSTRUCTIONS.md";
const PROFILE_RESOURCES_FILE = "resources.json";

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"));

const parseProfileId = (id: string) => {
  const result = SafeIdSchema.safeParse(id);
  if (!result.success) {
    throw new Error(`Invalid profile id: ${id}`);
  }
  return result.data;
};

const slugProfileName = (name: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SafeIdSchema.safeParse(slug).success ? slug : "profile";
};

const createdAtFromProfile = (
  id: string,
  storedCreatedAt: string | undefined,
  stats: Awaited<ReturnType<typeof lstat>>
) => {
  if (storedCreatedAt) return storedCreatedAt;
  const idTimestamp = id.match(/-(\d{13})$/)?.[1];
  if (idTimestamp) {
    const parsed = new Date(Number(idTimestamp));
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  const filesystemTime = stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime;
  return filesystemTime.toISOString();
};

export const createProfileStore = (
  overrides: PathOverrides,
  targetRegistry: TargetRegistry = createTargetRegistry()
): ProfileStore => {
  const paths = createPaths(overrides);

  const readProfile = async (id: string): Promise<ProfileDetail> => {
    const safeId = parseProfileId(id);
    const profileDir = join(paths.profilesDir, safeId);
    const profileStats = await lstat(profileDir);
    if (!profileStats.isDirectory() || profileStats.isSymbolicLink()) {
      throw new Error(`Profile storage must be a real directory: ${safeId}`);
    }
    const [storedManifest, instructions, resources] = await Promise.all([
      readJson(join(profileDir, PROFILE_MANIFEST_FILE)).then((value) =>
        ProfileManifestSchema.parse(value)
      ),
      readFile(join(profileDir, PROFILE_INSTRUCTIONS_FILE), "utf8"),
      readJson(join(profileDir, PROFILE_RESOURCES_FILE)).then((value) =>
        ProfileResourcesSchema.parse(value)
      )
    ]);
    if (storedManifest.id !== safeId) {
      throw new Error(`Profile directory and manifest ids differ: ${safeId}`);
    }
    const manifest = {
      ...storedManifest,
      createdAt: createdAtFromProfile(
        storedManifest.id,
        storedManifest.createdAt,
        profileStats
      )
    };
    const base: ProfileDetail = {
      id: safeId,
      profileDir,
      manifest,
      instructions,
      resources
    };
    const targetContentHashes = Object.fromEntries(
      targetRegistry
        .list()
        .map((target) => [target.id, createProfileContentHash(base, target.id)])
    );
    const preferredTargetId = manifest.preferredTargetId;
    return {
      ...base,
      contentHash:
        (preferredTargetId && targetContentHashes[preferredTargetId]) ??
        createProfileContentHash(base),
      targetContentHashes
    };
  };

  const listProfiles = async (): Promise<ProfileSummary[]> => {
    let entries: string[];
    try {
      entries = (await readdir(paths.profilesDir, { withFileTypes: true }))
        .filter(
          (entry) =>
            !entry.name.startsWith(".") &&
            !entry.name.includes(".agentenv-") &&
            (entry.isDirectory() || entry.isSymbolicLink())
        )
        .map((entry) => entry.name);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const summaries = await Promise.all(
      entries.map(async (entry): Promise<ProfileSummary> => {
        try {
          const profile = await readProfile(entry);
          return {
            id: profile.id,
            preferredTargetId: profile.manifest.preferredTargetId,
            createdFromTargetId: profile.manifest.createdFromTargetId,
            name: profile.manifest.name,
            description: profile.manifest.description,
            createdAt: profile.manifest.createdAt,
            iconKey: profile.manifest.iconKey,
            contentHash: profile.contentHash,
            targetContentHashes: profile.targetContentHashes
          };
        } catch (error) {
          return {
            id: entry,
            name: entry,
            description: "This Profile could not be loaded",
            loadError: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );

    return summaries.sort((left, right) => {
      const validityDifference =
        Number(Boolean(left.loadError)) - Number(Boolean(right.loadError));
      if (validityDifference) return validityDifference;
      const createdAtDifference =
        Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "");
      return (
        createdAtDifference ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id)
      );
    });
  };

  const saveProfile = async (input: SaveProfileInput): Promise<ProfileDetail> => {
    const secretWarnings = findSecretWarnings(input.instructions);
    if (secretWarnings.length > 0) {
      const keys = [...new Set(secretWarnings.map((warning) => warning.split(": ").at(-1)))]
        .filter(Boolean)
        .join(", ");
      throw new Error(
        `Profile contains literal credentials (${keys}). Reference environment variables instead.`
      );
    }
    const parsedManifest = ProfileManifestSchema.parse(input.manifest);
    const resources = ProfileResourcesSchema.parse(input.resources);
    const profileDir = join(paths.profilesDir, parsedManifest.id);
    const existingPathHash = await hashPathEntry(profileDir);
    const existing = existingPathHash !== undefined;
    if (existing && !input.expectedContentHash) {
      throw new Error(`Profile ${parsedManifest.id} must be refreshed before it can be saved.`);
    }
    if (existing) {
      const current = await readProfile(parsedManifest.id);
      if (current.contentHash !== input.expectedContentHash) {
        throw new Error(
          `Profile ${parsedManifest.id} changed outside this view. Refresh it before saving.`
        );
      }
      if (await hashPathEntry(profileDir) !== existingPathHash) {
        throw new Error(
          `Profile ${parsedManifest.id} changed while it was being read. Refresh it before saving.`
        );
      }
    }
    let createdAt = parsedManifest.createdAt;
    if (!createdAt && existing) {
      const [currentManifest, currentStats] = await Promise.all([
        readJson(join(profileDir, PROFILE_MANIFEST_FILE)).then((value) =>
          ProfileManifestSchema.parse(value)
        ),
        lstat(profileDir)
      ]);
      createdAt = createdAtFromProfile(
        currentManifest.id,
        currentManifest.createdAt,
        currentStats
      );
    }
    const manifest = ProfileManifestSchema.parse({
      ...parsedManifest,
      createdAt: createdAt ?? new Date().toISOString()
    });
    if (existing) {
      const currentStats = await lstat(profileDir);
      if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) {
        throw new Error(`Profile storage must be a real directory: ${manifest.id}`);
      }
    }

    await replacePathAtomically(profileDir, async (stagingDir) => {
      await mkdir(stagingDir, { recursive: true, mode: 0o700 });
      await Promise.all([
        writeAtomic(
          join(stagingDir, PROFILE_MANIFEST_FILE),
          `${JSON.stringify(manifest, null, 2)}\n`
        ),
        writeAtomic(join(stagingDir, PROFILE_INSTRUCTIONS_FILE), input.instructions),
        writeAtomic(
          join(stagingDir, PROFILE_RESOURCES_FILE),
          `${JSON.stringify(resources, null, 2)}\n`
        )
      ]);
      ProfileManifestSchema.parse(await readJson(join(stagingDir, PROFILE_MANIFEST_FILE)));
      ProfileResourcesSchema.parse(await readJson(join(stagingDir, PROFILE_RESOURCES_FILE)));
    }, { expectedTargetHash: existingPathHash });
    return readProfile(manifest.id);
  };

  const createProfile = async (input: CreateProfileInput): Promise<ProfileDetail> => {
    const preferredTargetId = input.preferredTargetId
      ? SafeIdSchema.parse(input.preferredTargetId)
      : targetRegistry.list()[0]?.id;
    if (preferredTargetId) targetRegistry.get(preferredTargetId);
    const target = preferredTargetId ? targetRegistry.get(preferredTargetId).descriptor : undefined;
    const iconKey = ResourceIconKeySchema.safeParse(target?.iconKey).data;
    const name = input.name?.trim() || `${target?.name ?? "Agent"} Profile`;
    const id = `${slugProfileName(name)}-${Date.now()}`;
    return saveProfile({
      manifest: {
        id,
        name,
        description: input.description?.trim() ?? "",
        createdAt: new Date().toISOString(),
        preferredTargetId,
        iconKey,
        version: 2
      },
      instructions: "",
      resources: { skills: [], mcpByTarget: {} }
    });
  };

  const updateProfileSkills = async (
    input: UpdateProfileSkillsInput
  ): Promise<UpdateProfileSkillsResult> => {
    const profileId = parseProfileId(input.profileId);
    const targetId = SafeIdSchema.parse(input.targetId);
    targetRegistry.get(targetId);
    const current = await readProfile(profileId);
    if (!input.expectedContentHash || current.contentHash !== input.expectedContentHash) {
      throw new Error(
        `Profile ${profileId} changed outside this Agent view. Refresh it before editing Skills.`
      );
    }

    const skills = ProfileSkillSchema.array().parse(input.skills);
    let resources = ProfileResourcesSchema.parse({
      ...current.resources,
      skills
    });
    if (input.managementMode !== undefined) {
      resources = setProfileResourceMode(
        resources,
        targetId,
        "skills",
        ProfileResourceModeSchema.parse(input.managementMode)
      );
    }
    resources = ProfileResourcesSchema.parse(resources);

    if (JSON.stringify(resources) === JSON.stringify(current.resources)) {
      return { profile: current, changed: false };
    }

    const profile = await saveProfile({
      manifest: current.manifest,
      instructions: current.instructions,
      resources,
      expectedContentHash: current.contentHash
    });
    return { profile, changed: true };
  };

  const forkProfileSkills = async (
    input: ForkProfileSkillsInput
  ): Promise<UpdateProfileSkillsResult> => {
    const source = await readProfile(parseProfileId(input.profileId));
    if (!input.expectedContentHash || source.contentHash !== input.expectedContentHash) {
      throw new Error(
        `Profile ${source.id} changed outside this Agent view. Refresh it before editing Skills.`
      );
    }
    const name = input.name.trim();
    if (!name) throw new Error("Profile name is required");
    const targetId = SafeIdSchema.parse(input.targetId);
    targetRegistry.get(targetId);
    const duplicate = await duplicateProfile(source.id);
    try {
      const skills = ProfileSkillSchema.array().parse(input.skills);
      let resources = ProfileResourcesSchema.parse({
        ...duplicate.resources,
        skills
      });
      resources = setProfileResourceMode(
        resources,
        targetId,
        "skills",
        ProfileResourceModeSchema.parse(input.managementMode ?? "manage")
      );
      const profile = await saveProfile({
        manifest: {
          ...duplicate.manifest,
          name,
          preferredTargetId: targetId
        },
        instructions: duplicate.instructions,
        resources,
        expectedContentHash: duplicate.contentHash
      });
      return { profile, changed: true };
    } catch (error) {
      await deleteProfile(duplicate.id);
      throw error;
    }
  };

  const updateProfileMetadata = async (
    input: UpdateProfileMetadataInput
  ): Promise<ProfileDetail> => {
    const id = parseProfileId(input.id);
    const current = await readProfile(id);
    const name = input.name === undefined ? current.manifest.name : input.name.trim();
    if (!name) throw new Error("Profile name is required");
    const manifest = ProfileManifestSchema.parse({
      ...current.manifest,
      name,
      description:
        input.description === undefined
          ? current.manifest.description
          : input.description.trim(),
      iconKey: input.iconKey ?? current.manifest.iconKey
    });
    return saveProfile({
      manifest,
      instructions: current.instructions,
      resources: current.resources,
      expectedContentHash: input.expectedContentHash
    });
  };

  const duplicateProfile = async (id: string): Promise<ProfileDetail> => {
    const profile = await readProfile(parseProfileId(id));
    const duplicateId = `${profile.id}-copy-${Date.now()}`;
    return saveProfile({
      manifest: {
        ...profile.manifest,
        id: duplicateId,
        createdAt: new Date().toISOString(),
        name: `${profile.manifest.name} Copy`
      },
      instructions: profile.instructions,
      resources: profile.resources
    });
  };

  const deleteProfile = async (id: string): Promise<void> => {
    const safeId = parseProfileId(id);
    const profileDir = join(paths.profilesDir, safeId);
    if (!(await pathEntryExists(profileDir))) return;
    const trashDir = join(paths.appDataRoot, "trash", "profiles");
    await mkdir(trashDir, { recursive: true, mode: 0o700 });
    await rename(profileDir, join(trashDir, `${safeId}-${Date.now()}`));
    await Promise.all([
      syncParentDirectory(paths.profilesDir),
      syncParentDirectory(trashDir)
    ]);
  };

  return {
    listProfiles,
    readProfile,
    saveProfile,
    updateProfileSkills,
    forkProfileSkills,
    updateProfileMetadata,
    createProfile,
    duplicateProfile,
    deleteProfile
  };
};
