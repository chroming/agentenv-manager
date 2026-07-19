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
  SaveProfileInput,
  UpdateProfileMetadataInput
} from "../shared/types";
import { createPaths, type PathOverrides } from "./paths";
import { createProfileContentHash } from "./profileFingerprint";
import { targetProfile } from "./profileTargeting";
import { createTargetRegistry, type TargetRegistry } from "./targets/registry";
import { pathEntryExists, replacePathAtomically, writeAtomic } from "./fileUtils";
import { findSecretWarnings } from "./secretWarnings";

export interface ProfileStore {
  listProfiles(): Promise<ProfileSummary[]>;
  readProfile(id: string): Promise<ProfileDetail>;
  saveProfile(input: SaveProfileInput): Promise<ProfileDetail>;
  updateProfileMetadata(input: UpdateProfileMetadataInput): Promise<ProfileDetail>;
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

const createdAtFromProfile = (
  id: string,
  storedCreatedAt: string | undefined,
  stats: Awaited<ReturnType<typeof lstat>>
) => {
  if (storedCreatedAt) {
    return storedCreatedAt;
  }
  const idTimestamp = id.match(/-(\d{13})$/)?.[1];
  if (idTimestamp) {
    const parsed = new Date(Number(idTimestamp));
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
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
    const parsedId = SafeIdSchema.safeParse(id);
    if (!parsedId.success) {
      throw new Error("Invalid profile id");
    }

    const profileDir = join(paths.profilesDir, parsedId.data);
    const profileStats = await lstat(profileDir);
    if (!profileStats.isDirectory() || profileStats.isSymbolicLink()) {
      throw new Error(`Profile storage must be a real directory: ${parsedId.data}`);
    }
    const storedManifest = ProfileManifestSchema.parse(
      await readJson(join(profileDir, "profile.json"))
    );
    const manifest = {
      ...storedManifest,
      createdAt: createdAtFromProfile(storedManifest.id, storedManifest.createdAt, profileStats)
    };
    const profile = await targetRegistry
      .get(manifest.targetId)
      .readProfileFiles(profileDir, manifest);
    const legacyMcpSelections = profile.assetPolicy.mcpRefs.map(
      (reference) => ({
        targetId: manifest.targetId,
        name: reference.targetName
      })
    );
    const mcpSelections = [
      ...(profile.assetPolicy.mcpSelections ?? []),
      ...legacyMcpSelections
    ].filter(
      (selection, index, selections) =>
        selections.findIndex(
          (candidate) =>
            candidate.targetId === selection.targetId &&
            candidate.name === selection.name
        ) === index
    );
    const normalizedProfile: ProfileDetail = {
      ...profile,
      assetPolicy: {
        ...profile.assetPolicy,
        mcpRefs: [],
        mcpSelections
      }
    };
    const targetContentHashes = Object.fromEntries(
      targetRegistry.listAdapters().map((adapter) => {
        const targeted = targetProfile(normalizedProfile, adapter).profile;
        return [adapter.descriptor.id, createProfileContentHash(targeted)];
      })
    );
    return {
      ...normalizedProfile,
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
          createdAt: profile.manifest.createdAt,
          iconKey: profile.manifest.iconKey,
          contentHash: profile.contentHash,
          targetContentHashes: profile.targetContentHashes
        };
      })
    );

    return summaries.sort((a, b) => {
      const createdAtDifference =
        Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "");
      return createdAtDifference || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
  };

  const saveProfile = async (input: SaveProfileInput): Promise<ProfileDetail> => {
    const secretWarnings = [
      ...findSecretWarnings(input.instructions),
      ...findSecretWarnings(input.configText)
    ];
    if (secretWarnings.length > 0) {
      const keys = [...new Set(secretWarnings.map((warning) => warning.split(": ").at(-1)))]
        .filter(Boolean)
        .join(", ");
      throw new Error(
        `Profile contains literal credentials (${keys}). Reference environment variables instead.`
      );
    }
    const parsedManifest = ProfileManifestSchema.parse(input.manifest);
    const profileDir = join(paths.profilesDir, parsedManifest.id);
    let createdAt = parsedManifest.createdAt;
    if (!createdAt && await pathEntryExists(profileDir)) {
      const [currentManifest, currentStats] = await Promise.all([
        readJson(join(profileDir, "profile.json")).then((value) =>
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
    const manifest = {
      ...parsedManifest,
      createdAt: createdAt ?? new Date().toISOString()
    };
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
        createdAt: new Date().toISOString(),
        name: input.name?.trim() || profile.manifest.name,
        description: input.description?.trim() ?? profile.manifest.description
      }
    });
  };

  const updateProfileMetadata = async (
    input: UpdateProfileMetadataInput
  ): Promise<ProfileDetail> => {
    const id = SafeIdSchema.parse(input.id);
    const current = await readProfile(id);
    const name = input.name === undefined ? current.manifest.name : input.name.trim();
    if (!name) {
      throw new Error("Profile name is required");
    }
    const manifest = ProfileManifestSchema.parse({
      ...current.manifest,
      name,
      description:
        input.description === undefined
          ? current.manifest.description
          : input.description.trim(),
      iconKey: input.iconKey ?? current.manifest.iconKey
    });
    await writeAtomic(
      join(current.profileDir ?? join(paths.profilesDir, id), "profile.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    return readProfile(id);
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
      createdAt: new Date().toISOString(),
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

  return {
    listProfiles,
    readProfile,
    saveProfile,
    updateProfileMetadata,
    createProfile,
    duplicateProfile,
    deleteProfile
  };
};
