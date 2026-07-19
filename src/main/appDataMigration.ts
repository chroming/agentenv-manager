import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import {
  ProfileManifestSchema,
  ProfileResourcesSchema,
  SafeIdSchema
} from "../shared/schemas";
import type { AgentEnvPaths } from "./paths";
import {
  isMissingFileError,
  pathEntryExists,
  pathExists,
  replacePathAtomically,
  writeAtomic
} from "./fileUtils";
import { hashComparableResource } from "./resourceHash";
import { parseTargetState } from "./targetState";
import { createTargetRegistry, type TargetRegistry } from "./targets/registry";
import {
  createLegacyProfileMigrationCatalog,
  type LegacyProfileMigrationCatalog
} from "./targets/legacyProfileMigration";

const LegacyManagedSurfaceSchema = z.union([
  z.object({
    instructions: z.boolean(),
    config: z.boolean(),
    assets: z.boolean()
  }),
  z.object({
    agents: z.boolean(),
    mcp: z.boolean(),
    skills: z.boolean()
  }).transform((value) => ({
    instructions: value.agents,
    config: value.mcp,
    assets: value.skills
  }))
]).default({ instructions: true, config: true, assets: true });

const LegacyRelativeAssetSourceSchema = z
  .string()
  .regex(/^(agents|skills)\/[a-zA-Z0-9._/-]+$/)
  .refine((value) => !value.split("/").includes(".."), {
    message: "Asset source cannot traverse directories"
  });

const LegacyTargetNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

const LegacyManifestSchema = z.object({
  id: SafeIdSchema,
  targetId: SafeIdSchema.optional(),
  name: z.string().min(1),
  description: z.string().default(""),
  iconKey: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  version: z.literal(1),
  managed: LegacyManagedSurfaceSchema
});

const LegacyAssetSchema = z.object({
  ownedDirs: z.array(z.object({
    kind: z.enum(["agent", "skill"]),
    source: LegacyRelativeAssetSourceSchema,
    targetName: LegacyTargetNameSchema
  })).default([]),
  ownedFiles: z.array(z.object({
    kind: z.enum(["agent", "skill"]),
    source: LegacyRelativeAssetSourceSchema,
    targetName: LegacyTargetNameSchema
  })).default([]),
  skillRefs: z.array(z.object({
    libraryId: SafeIdSchema,
    targetName: LegacyTargetNameSchema,
    enabled: z.boolean().optional()
  })).default([]),
  mcpRefs: z.array(z.object({
    libraryId: SafeIdSchema,
    targetName: LegacyTargetNameSchema
  })).default([]),
  mcpSelections: z.array(z.object({
    targetId: SafeIdSchema,
    name: z.string().trim().min(1),
    enabled: z.boolean().optional()
  })).default([]),
  disabledSkillPaths: z.array(z.string()).default([])
});

const LegacySkillsSchema = z.object({
  ownedSkillDirs: z.array(z.object({
    source: LegacyRelativeAssetSourceSchema,
    targetName: LegacyTargetNameSchema
  })).default([]),
  disabledSkillPaths: z.array(z.string()).default([])
});

const LegacyTargetStateSchema = z.object({
  formatVersion: z.literal(1).default(1),
  managedConfigKeys: z.array(z.string()).default([]),
  managedMcpNames: z.array(z.string()).default([]),
  activeProfileId: z.string().optional(),
  appliedProfileHash: z.string().optional(),
  appliedLibraryVersions: z.object({
    skills: z.record(z.string(), z.string()).default({}),
    mcp: z.record(z.string(), z.string()).default({})
  }).optional(),
  lastAppliedAt: z.string().optional(),
  managedResources: z.array(z.object({
    kind: z.enum(["instructions", "config", "mcp", "skill", "agent", "file", "directory"]),
    id: z.string().min(1),
    path: z.string().min(1),
    contentHash: z.string().min(1),
    source: z.string().optional()
  })).default([]),
  sharedSkillPreparations: z.array(z.object({
    skillKey: z.string().min(1),
    libraryId: z.string().min(1),
    sharedPaths: z.array(z.string().min(1)),
    targetName: z.string().min(1),
    disposition: z.enum(["install", "omit"]),
    profileId: z.string().min(1),
    profileHash: z.string().min(1)
  })).default([]),
  recoveryRequired: z.object({
    operation: z.enum(["apply", "rollback"]),
    error: z.string().min(1),
    backupId: z.string().optional(),
    occurredAt: z.string().min(1)
  }).optional()
});

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"));

const sha256 = (content: string) =>
  createHash("sha256").update(content).digest("hex");

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const safeLibraryId = (value: string, fallback: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SafeIdSchema.safeParse(normalized).success ? normalized : fallback;
};

const chooseLibraryId = async (
  paths: AgentEnvPaths,
  sourceDir: string,
  requestedId: string,
  profileId: string
) => {
  const sourceHash = await hashComparableResource(sourceDir);
  const candidates = [
    requestedId,
    safeLibraryId(`${profileId}-${requestedId}`, `${profileId}-skill`)
  ];
  for (let suffix = 2; ; suffix += 1) {
    const candidate = candidates.shift() ?? `${profileId}-skill-${suffix}`;
    const targetDir = join(paths.skillsLibraryDir, candidate);
    if (!(await pathEntryExists(targetDir))) return { id: candidate, sourceHash };
    if (
      await pathExists(join(targetDir, "SKILL.md")) &&
      (await hashComparableResource(targetDir)) === sourceHash
    ) {
      return { id: candidate, sourceHash, reuse: true };
    }
  }
};

const migrateOwnedSkill = async (
  paths: AgentEnvPaths,
  profileId: string,
  profileDir: string,
  source: string,
  targetName: string
) => {
  const sourceDir = join(profileDir, source);
  if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
    throw new Error(`Profile ${profileId} Skill is missing SKILL.md: ${sourceDir}`);
  }
  const requestedId = safeLibraryId(targetName, `${profileId}-skill`);
  const selected = await chooseLibraryId(
    paths,
    sourceDir,
    requestedId,
    profileId
  );
  if (!selected.reuse) {
    const targetDir = join(paths.skillsLibraryDir, selected.id);
    await replacePathAtomically(targetDir, async (stagingDir) => {
      await cp(sourceDir, stagingDir, { recursive: true, dereference: true });
      await writeAtomic(
        join(stagingDir, ".agentenv-skill.json"),
        `${JSON.stringify({
          sourceType: "local",
          source: `migrated-profile://${profileId}/${source}`,
          updatePolicy: "untracked",
          contentHash: selected.sourceHash,
          updatedAt: new Date().toISOString(),
          provenance: { importedVia: "agentenv" }
        }, null, 2)}\n`
      );
    });
  }
  return { libraryId: selected.id, targetName, enabled: true };
};

const readLegacyAssets = async (profileDir: string) => {
  const assetsPath = join(profileDir, "assets.json");
  if (await pathExists(assetsPath)) {
    return LegacyAssetSchema.parse(await readJson(assetsPath));
  }
  const skillsPath = join(profileDir, "skills.json");
  if (await pathExists(skillsPath)) {
    const legacy = LegacySkillsSchema.parse(await readJson(skillsPath));
    return LegacyAssetSchema.parse({
      ownedDirs: legacy.ownedSkillDirs.map((entry) => ({
        ...entry,
        kind: "skill"
      })),
      disabledSkillPaths: legacy.disabledSkillPaths
    });
  }
  return LegacyAssetSchema.parse({});
};

const migrateProfile = async (
  paths: AgentEnvPaths,
  profileDir: string,
  catalog: LegacyProfileMigrationCatalog
) => {
  const profileId = basename(profileDir);
  let stored: unknown;
  try {
    stored = await readJson(join(profileDir, "profile.json"));
  } catch (error) {
    return {
      status: "retained" as const,
      report: { profileId, error: errorMessage(error) }
    };
  }
  const current = ProfileManifestSchema.safeParse(stored);
  if (current.success) {
    try {
      if (current.data.id !== profileId) {
        throw new Error(`Profile directory and manifest ids differ: ${profileId}`);
      }
      await readFile(join(profileDir, "INSTRUCTIONS.md"), "utf8");
      ProfileResourcesSchema.parse(await readJson(join(profileDir, "resources.json")));
      return { status: "current" as const };
    } catch (error) {
      return {
        status: "retained" as const,
        report: { profileId, error: errorMessage(error) }
      };
    }
  }
  const legacyResult = LegacyManifestSchema.safeParse(stored);
  if (!legacyResult.success) {
    return {
      status: "retained" as const,
      report: { profileId, error: "Profile manifest is neither valid v1 nor valid v2 data" }
    };
  }
  const legacy = legacyResult.data;
  let sourceTargetId: string;
  try {
    sourceTargetId = catalog.resolveTargetId(legacy.targetId);
  } catch (error) {
    return {
      status: "retained" as const,
      report: { profileId, error: errorMessage(error) }
    };
  }
  if (legacy.id !== profileId) {
    return {
      status: "retained" as const,
      report: {
        profileId,
        error: `Profile directory and manifest ids differ: ${profileId}`
      }
    };
  }
  const assets = await readLegacyAssets(profileDir);
  const instructionsPath = join(profileDir, catalog.instructionFileFor(sourceTargetId));
  const instructions = await readFile(instructionsPath, "utf8").catch((error) => {
    if (isMissingFileError(error)) return "";
    throw error;
  });
  const skills = [...assets.skillRefs.map((reference) => ({
    libraryId: reference.libraryId,
    targetName: reference.targetName,
    enabled: reference.enabled !== false
  }))];
  for (const owned of assets.ownedDirs.filter((entry) => entry.kind === "skill")) {
    skills.push(
      await migrateOwnedSkill(
        paths,
        legacy.id,
        profileDir,
        owned.source,
        owned.targetName
      )
    );
  }
  const targetSelections = [
    ...assets.mcpSelections,
    ...assets.mcpRefs.map((reference) => ({
      targetId: sourceTargetId,
      name: reference.targetName,
      enabled: true
    }))
  ];
  const mcpByTarget: Record<string, { mode: "ignore" | "manage"; selections: Array<{ name: string; enabled: boolean }> }> = {};
  for (const targetId of catalog.mcpActivationTargetIds) {
    const selections = targetSelections
      .filter((selection) => selection.targetId === targetId)
      .map((selection) => ({
        name: selection.name,
        enabled: selection.enabled !== false
      }))
      .filter(
        (selection, index, all) =>
          all.findIndex((candidate) => candidate.name === selection.name) === index
      );
    if (legacy.managed.config && selections.length > 0) {
      mcpByTarget[targetId] = { mode: "manage", selections };
    }
  }
  const manifest = ProfileManifestSchema.parse({
    id: legacy.id,
    name: legacy.name,
    description: legacy.description,
    iconKey: legacy.iconKey,
    createdAt: legacy.createdAt,
    preferredTargetId: sourceTargetId,
    createdFromTargetId: sourceTargetId,
    version: 2
  });
  const uniqueSkills = skills.filter(
    (skill, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.libraryId === skill.libraryId ||
          candidate.targetName === skill.targetName
      ) === index
  );
  const resources = ProfileResourcesSchema.parse({ skills: uniqueSkills, mcpByTarget });
  const omitted = [
    ...assets.ownedDirs.filter((entry) => entry.kind === "agent"),
    ...assets.ownedFiles
  ];
  let omittedNativeConfigHash: string | undefined;
  for (const file of catalog.nativeConfigFiles) {
    const path = join(profileDir, file);
    if (await pathExists(path)) {
      omittedNativeConfigHash = sha256(await readFile(path, "utf8"));
      break;
    }
  }
  await replacePathAtomically(profileDir, async (stagingDir) => {
    await mkdir(stagingDir, { recursive: true, mode: 0o700 });
    await Promise.all([
      writeAtomic(join(stagingDir, "profile.json"), `${JSON.stringify(manifest, null, 2)}\n`),
      writeAtomic(join(stagingDir, "INSTRUCTIONS.md"), instructions),
      writeAtomic(join(stagingDir, "resources.json"), `${JSON.stringify(resources, null, 2)}\n`)
    ]);
  });
  return {
    status: "migrated" as const,
    report: {
      profileId: legacy.id,
      sourceTargetId,
      importedOwnedSkillCount: assets.ownedDirs.filter((entry) => entry.kind === "skill").length,
      omittedNativeAssetCount: omitted.length,
      omittedNativeConfigHash
    }
  };
};

const createMigrationBackup = async (
  paths: AgentEnvPaths,
  fromVersion: 1 | "unversioned"
) => {
  const createdAt = new Date().toISOString();
  const id = createdAt.replace(/[:.]/g, "-");
  const backupRoot = join(dirname(paths.appDataRoot), "agentenv-manager-migration-backups", id);
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await cp(paths.appDataRoot, join(backupRoot, "data"), {
    recursive: true,
    dereference: false
  });
  await writeAtomic(
    join(backupRoot, "migration-backup.json"),
    `${JSON.stringify({ fromVersion, toVersion: 2, createdAt }, null, 2)}\n`
  );
  return backupRoot;
};

export interface AppDataMigrationResult {
  migrated: boolean;
  backupPath?: string;
  profileCount: number;
  retainedProfileCount: number;
}

export const migrateAppDataToV2 = async (
  paths: AgentEnvPaths,
  targetRegistry: TargetRegistry = createTargetRegistry()
): Promise<AppDataMigrationResult> => {
  const migrationCatalog = createLegacyProfileMigrationCatalog(targetRegistry);
  const manifestPath = join(paths.appDataRoot, "agentenv-data.json");
  let rawManifest: { formatVersion?: unknown } | undefined;
  try {
    rawManifest = await readJson(manifestPath) as { formatVersion?: unknown };
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  if (rawManifest?.formatVersion === 2) {
    return { migrated: false, profileCount: 0, retainedProfileCount: 0 };
  }
  if (rawManifest && rawManifest.formatVersion !== 1) {
    throw new Error(`Unsupported AgentEnv data format: ${String(rawManifest.formatVersion)}`);
  }
  if (!rawManifest) {
    const existingEntries = await readdir(paths.appDataRoot).catch((error) => {
      if (isMissingFileError(error)) return [];
      throw error;
    });
    if (existingEntries.length === 0) {
      await writeAtomic(manifestPath, `${JSON.stringify({ formatVersion: 2 }, null, 2)}\n`);
      return { migrated: false, profileCount: 0, retainedProfileCount: 0 };
    }
  }

  const backupPath = await createMigrationBackup(
    paths,
    rawManifest ? 1 : "unversioned"
  );
  const reports = [];
  const retainedProfiles = [];
  if (await pathExists(paths.profilesDir)) {
    for (const entry of await readdir(paths.profilesDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.includes(".agentenv-")) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Profile storage must be a real directory: ${entry.name}`);
      }
      SafeIdSchema.parse(entry.name);
      const outcome = await migrateProfile(
        paths,
        join(paths.profilesDir, entry.name),
        migrationCatalog
      );
      if (outcome.status === "migrated") reports.push(outcome.report);
      if (outcome.status === "retained") retainedProfiles.push(outcome.report);
    }
  }
  const retainedTargetStates = [];
  if (await pathExists(paths.targetStatesDir)) {
    for (const entry of await readdir(paths.targetStatesDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
        throw new Error(`Invalid Target state entry: ${entry.name}`);
      }
      const statePath = join(paths.targetStatesDir, entry.name);
      let rawState: unknown;
      try {
        rawState = await readJson(statePath);
        if ((rawState as { formatVersion?: unknown }).formatVersion === 2) {
          parseTargetState(rawState);
          continue;
        }
      } catch (error) {
        retainedTargetStates.push({ file: entry.name, error: errorMessage(error) });
        continue;
      }
      const legacyResult = LegacyTargetStateSchema.safeParse(rawState);
      if (!legacyResult.success) {
        retainedTargetStates.push({
          file: entry.name,
          error: "Target state is neither valid v1 nor valid v2 data"
        });
        continue;
      }
      const legacy = legacyResult.data;
      await writeAtomic(statePath, `${JSON.stringify({
        formatVersion: 2,
        managedMcpNames: legacy.managedMcpNames,
        activeProfileId: legacy.activeProfileId,
        appliedProfileHash: undefined,
        appliedLibraryVersions: legacy.appliedLibraryVersions
          ? { skills: legacy.appliedLibraryVersions.skills }
          : undefined,
        lastAppliedAt: legacy.lastAppliedAt,
        managedResources: legacy.managedResources.filter((resource) =>
          resource.kind === "instructions" || resource.kind === "skill"
        ),
        sharedSkillPreparations: legacy.sharedSkillPreparations,
        recoveryRequired: legacy.recoveryRequired
      }, null, 2)}\n`);
    }
  }
  await writeAtomic(
    join(paths.appDataRoot, "migration-v2-report.json"),
    `${JSON.stringify({
      migratedAt: new Date().toISOString(),
      backupPath,
      profiles: reports,
      retainedProfiles,
      retainedTargetStates
    }, null, 2)}\n`
  );
  await writeAtomic(manifestPath, `${JSON.stringify({ formatVersion: 2 }, null, 2)}\n`);
  return {
    migrated: true,
    backupPath,
    profileCount: reports.length,
    retainedProfileCount: retainedProfiles.length
  };
};
