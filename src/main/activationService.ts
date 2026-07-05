import { createHash } from "node:crypto";
import { appendFile, cp, lstat, mkdir, readFile, readdir, readlink, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createBackupStore } from "./backupStore";
import { createUnifiedDiff } from "./diff";
import {
  pathExists,
  readTextIfExists,
  writeAtomic
} from "./fileUtils";
import type { AgentEnvPaths } from "./paths";
import {
  createMcpLibraryStore,
  type McpLibraryStore
} from "./mcpLibraryStore";
import { materializeProfileMcpRefs } from "./mcpRefs";
import type { ProfileStore } from "./profileStore";
import {
  createSettingsStore,
  resolveSkillsLibraryDir,
  type SettingsStore
} from "./settingsStore";
import {
  createSkillLibraryStore,
  type SkillLibraryStore
} from "./skillLibraryStore";
import {
  createTargetRegistry,
  type TargetRegistry
} from "./targets/registry";
import type {
  ActivationPreview,
  ApplyProfileOptions,
  ApplyResult,
  BackupManifest,
  ManagedResourceKind,
  ManagedResourceSnapshot,
  PlannedFileChange,
  PlannedResourceChange,
  RollbackPreview,
  RollbackResult,
  TargetManagementState,
  TargetPaths,
  TargetState
} from "../shared/types";
import { createProfileContentHash } from "./profileFingerprint";

export interface ActivationServiceOptions {
  paths: AgentEnvPaths;
  profileStore: ProfileStore;
  targetRegistry?: TargetRegistry;
  allowRealHomeWrites?: boolean;
  settingsStore?: SettingsStore;
  mcpLibraryStore?: McpLibraryStore;
  skillLibraryStore?: SkillLibraryStore;
}

export interface ActivationService {
  listTargetStates(): Promise<TargetManagementState[]>;
  previewProfile(profileId: string): Promise<ActivationPreview>;
  applyProfile(
    profileId: string,
    previewId: string,
    options?: ApplyProfileOptions
  ): Promise<ApplyResult>;
  previewRollback(backupId: string): Promise<RollbackPreview>;
  rollback(backupId: string): Promise<RollbackResult>;
}

const DEFAULT_TARGET_STATE: TargetState = {
  managedConfigKeys: [],
  managedMcpNames: [],
  managedResources: []
};

const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const hashPath = async (path: string): Promise<string | undefined> => {
  if (!(await pathExists(path))) {
    return undefined;
  }

  const hash = createHash("sha256");
  const walk = async (currentPath: string) => {
    const stats = await lstat(currentPath);
    hash.update(relative(dirname(path), currentPath));
    if (stats.isSymbolicLink()) {
      hash.update(`symlink:${await readlink(currentPath)}`);
      return;
    }
    if (stats.isDirectory()) {
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        await walk(join(currentPath, entry.name));
      }
      return;
    }
    if (stats.isFile()) {
      hash.update(await readFile(currentPath));
    }
  };

  await walk(path);
  return hash.digest("hex");
};

const isDirectoryReadError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EISDIR"
  );

const readRollbackTextIfExists = async (path: string) => {
  try {
    return await readTextIfExists(path);
  } catch (error) {
    if (isDirectoryReadError(error)) {
      return "[directory]\n";
    }
    throw error;
  }
};

const appendHistory = async (
  paths: AgentEnvPaths,
  event: Record<string, unknown>
) => {
  await mkdir(paths.appDataRoot, { recursive: true, mode: 0o700 });
  await appendFile(
    paths.activationHistoryPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    "utf8"
  );
};

const normalizeTargetState = (value: unknown): TargetState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_TARGET_STATE;
  }
  const record = value as Partial<TargetState>;
  const managedResources = Array.isArray(record.managedResources)
    ? record.managedResources.filter(
        (item): item is ManagedResourceSnapshot =>
          Boolean(item) &&
          typeof item === "object" &&
          "kind" in item &&
          "id" in item &&
          "path" in item &&
          "contentHash" in item &&
          typeof item.kind === "string" &&
          typeof item.id === "string" &&
          typeof item.path === "string" &&
          typeof item.contentHash === "string"
      )
    : [];
  return {
    managedConfigKeys: Array.isArray(record.managedConfigKeys)
      ? record.managedConfigKeys.filter((item): item is string => typeof item === "string")
      : [],
    managedMcpNames: Array.isArray(record.managedMcpNames)
      ? record.managedMcpNames.filter((item): item is string => typeof item === "string")
      : [],
    activeProfileId: typeof record.activeProfileId === "string" ? record.activeProfileId : undefined,
    appliedProfileHash:
      typeof record.appliedProfileHash === "string" ? record.appliedProfileHash : undefined,
    lastAppliedAt: typeof record.lastAppliedAt === "string" ? record.lastAppliedAt : undefined,
    managedResources
  };
};

const createRollbackChange = async (
  entry: BackupManifest["entries"][number]
): Promise<PlannedFileChange> => {
  if (entry.kind === "directory") {
    const before = (await pathExists(entry.sourcePath)) ? "[directory]\n" : "";
    const after = entry.missing ? "" : "[directory]\n";

    return {
      path: entry.sourcePath,
      before,
      after,
      diff: createUnifiedDiff(entry.sourcePath, before, after)
    };
  }

  const before = await readRollbackTextIfExists(entry.sourcePath);
  const after = entry.missing ? "" : await readFile(entry.backupPath ?? "", "utf8");

  return {
    path: entry.sourcePath,
    before,
    after,
    diff: createUnifiedDiff(entry.sourcePath, before, after)
  };
};

const restoreBackupEntries = async (backup: BackupManifest) => {
  for (const entry of backup.entries) {
    if (entry.missing) {
      await rm(entry.sourcePath, { recursive: true, force: true });
      continue;
    }

    if (entry.kind === "directory") {
      await rm(entry.sourcePath, { recursive: true, force: true });
      await mkdir(dirname(entry.sourcePath), { recursive: true });
      await cp(entry.backupPath ?? "", entry.sourcePath, { recursive: true });
      continue;
    }

    const content = await readFile(entry.backupPath ?? "", "utf8");
    await writeAtomic(entry.sourcePath, content);
  }
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const MANAGED_DRIFT_PREFIX = "External changes detected in AgentEnv-managed";

const validateProfileStructure = (profile: Awaited<ReturnType<ProfileStore["readProfile"]>>) => {
  const errors: string[] = [];

  if (
    profile.manifest.managed.instructions &&
    profile.instructions.trim().length === 0
  ) {
    errors.push("Managed instructions are empty");
  }

  return errors;
};

export const createActivationService = ({
  paths,
  profileStore,
  targetRegistry = createTargetRegistry(),
  allowRealHomeWrites = false,
  settingsStore = createSettingsStore(paths),
  mcpLibraryStore = createMcpLibraryStore(paths),
  skillLibraryStore = createSkillLibraryStore(paths, settingsStore)
}: ActivationServiceOptions): ActivationService => {
  const backupStore = createBackupStore(paths);
  const previews = new Map<string, ActivationPreview>();

  const statePathFor = (targetId: string) =>
    join(paths.targetStatesDir, `${targetId}.json`);

  const readTargetStateFile = async (targetId: string) => {
    const path = statePathFor(targetId);
    const content = await readTextIfExists(path);
    if (content.trim().length === 0) {
      return { path, content, state: DEFAULT_TARGET_STATE };
    }

    try {
      return {
        path,
        content,
        state: normalizeTargetState(JSON.parse(content))
      };
    } catch {
      return {
        path,
        content,
        state: DEFAULT_TARGET_STATE
      };
    }
  };

  const listTargetStates = async (): Promise<TargetManagementState[]> => {
    if (!(await pathExists(paths.targetStatesDir))) {
      return [];
    }
    const entries = await readdir(paths.targetStatesDir, { withFileTypes: true });
    const states = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry): Promise<TargetManagementState | undefined> => {
          const targetId = entry.name.replace(/\.json$/, "");
          const { state } = await readTargetStateFile(targetId);
          if (!state.activeProfileId && (state.managedResources ?? []).length === 0) {
            return undefined;
          }
          return {
            targetId,
            activeProfileId: state.activeProfileId,
            appliedProfileHash: state.appliedProfileHash,
            status: state.activeProfileId ? "managed" : "unmanaged",
            lastAppliedAt: state.lastAppliedAt,
            managedResourceCount: state.managedResources?.length ?? 0,
            warningCount: 0,
            errorCount: 0
          };
        })
    );

    return states
      .filter((state): state is TargetManagementState => Boolean(state))
      .sort((a, b) => a.targetId.localeCompare(b.targetId));
  };

  const writeTargetState = async (targetId: string, state: TargetState) => {
    await mkdir(paths.targetStatesDir, { recursive: true, mode: 0o700 });
    await writeAtomic(statePathFor(targetId), `${JSON.stringify(state, null, 2)}\n`);
  };

  const desiredSkillTargets = (profile: Awaited<ReturnType<ProfileStore["readProfile"]>>) =>
    new Set(
      profile.assetPolicy.ownedDirs
        .filter((ownedDir) => ownedDir.kind === "skill")
        .map((ownedDir) => ownedDir.targetName)
        .concat((profile.assetPolicy.skillRefs ?? []).map((skillRef) => skillRef.targetName))
    );

  const desiredManagedPaths = (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    targetPaths: TargetPaths
  ) => {
    const desired = new Set<string>();
    if (profile.manifest.managed.instructions) {
      desired.add(targetPaths.instructionsPath);
    }
    if (profile.manifest.managed.config) {
      desired.add(targetPaths.configPath);
    }
    if (targetPaths.skillsDir) {
      for (const targetName of desiredSkillTargets(profile)) {
        desired.add(join(targetPaths.skillsDir, targetName));
      }
    }
    if (targetPaths.agentsDir) {
      for (const ownedDir of profile.assetPolicy.ownedDirs.filter((item) => item.kind === "agent")) {
        desired.add(join(targetPaths.agentsDir, ownedDir.targetName));
      }
    }
    return desired;
  };

  const findManagedDrift = async (
    state: TargetState,
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    targetPaths: TargetPaths
  ) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const desired = desiredManagedPaths(profile, targetPaths);
    for (const resource of state.managedResources ?? []) {
      const currentHash = await hashPath(resource.path);
      if (!currentHash) {
        if (desired.has(resource.path)) {
          warnings.push(`Will restore missing managed ${resource.kind} ${resource.id}: ${resource.path}`);
        }
        continue;
      }
      if (currentHash !== resource.contentHash) {
        errors.push(
          `External changes detected in AgentEnv-managed ${resource.kind} ${resource.id}: ${resource.path}`
        );
      }
    }
    return { errors, warnings };
  };

  const unmanagedSkillWarnings = async (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    targetPaths: TargetPaths
  ) => {
    const desired = desiredSkillTargets(profile);
    const inventory = await skillLibraryStore.scanInventory([targetPaths]);
    return inventory
      .filter(
        (skill) =>
          (skill.status === "unmanaged" || skill.status === "ignored") && !desired.has(skill.id)
      )
      .map((skill) =>
        skill.status === "ignored"
          ? `Ignored local skill kept: ${skill.path}`
          : `Unmanaged local skill kept: ${skill.path}`
      );
  };

  const resourceKindForPath = (
    path: string,
    targetPaths: TargetPaths
  ): { kind: ManagedResourceKind; id: string } => {
    if (path === targetPaths.instructionsPath) {
      return { kind: "instructions", id: "instructions" };
    }
    if (path === targetPaths.configPath || path === targetPaths.mcpConfigPath) {
      return { kind: "config", id: "config" };
    }
    if (targetPaths.skillsDir && path.startsWith(`${targetPaths.skillsDir}/`)) {
      return { kind: "skill", id: basename(path) };
    }
    if (targetPaths.agentsDir && path.startsWith(`${targetPaths.agentsDir}/`)) {
      return { kind: "agent", id: basename(path) };
    }
    return { kind: "file", id: basename(path) || path };
  };

  const snapshotManagedResources = async (
    pathsToSnapshot: string[],
    targetPaths: TargetPaths
  ) => {
    const snapshots: ManagedResourceSnapshot[] = [];
    for (const path of [...new Set(pathsToSnapshot)]) {
      const contentHash = await hashPath(path);
      if (!contentHash) {
        continue;
      }
      snapshots.push({
        ...resourceKindForPath(path, targetPaths),
        path,
        contentHash,
        source: "profile-apply"
      });
    }
    return snapshots.sort((a, b) => a.path.localeCompare(b.path));
  };

  const desiredAssetResources = (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    targetPaths: TargetPaths,
    skillLibraryDir: string
  ) => {
    const desired = new Map<
      string,
      {
        resource: Omit<PlannedResourceChange, "action" | "path">;
        sourcePath: string;
      }
    >();
    const rootFor = (kind: "agent" | "skill") =>
      kind === "agent" ? targetPaths.agentsDir : targetPaths.skillsDir;

    for (const asset of [...profile.assetPolicy.ownedDirs, ...profile.assetPolicy.ownedFiles]) {
      const root = rootFor(asset.kind);
      if (root) {
        desired.set(join(root, asset.targetName), {
          resource: {
            kind: asset.kind,
            name: asset.targetName,
            source: asset.source
          },
          sourcePath: join(profile.profileDir ?? "", asset.source)
        });
      }
    }
    for (const skillRef of profile.assetPolicy.skillRefs ?? []) {
      if (targetPaths.skillsDir) {
        desired.set(join(targetPaths.skillsDir, skillRef.targetName), {
          resource: {
            kind: "skill",
            name: skillRef.targetName,
            source: `Library / ${skillRef.libraryId}`
          },
          sourcePath: join(skillLibraryDir, skillRef.libraryId)
        });
      }
    }
    return desired;
  };

  const planAssetResources = async (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    targetPaths: TargetPaths,
    assetPaths: string[],
    skillLibraryDir: string
  ) => {
    const desired = desiredAssetResources(profile, targetPaths, skillLibraryDir);
    const resourceChanges: PlannedResourceChange[] = [];
    const resourceFingerprints: Record<string, string> = {};
    const sourceFingerprints: Record<string, string> = {};

    for (const { sourcePath } of desired.values()) {
      sourceFingerprints[sourcePath] = (await hashPath(sourcePath)) ?? "";
    }

    for (const path of [...new Set(assetPaths)]) {
      resourceFingerprints[path] = (await hashPath(path)) ?? "";
      const resource = desired.get(path);
      if (resource) {
        resourceChanges.push({
          ...resource.resource,
          path,
          action: (await pathExists(path)) ? "replace" : "install"
        });
        continue;
      }
      if (path.endsWith(".agentenv-owner.json")) {
        continue;
      }
      const stats = (await pathExists(path)) ? await lstat(path) : undefined;
      const identity = resourceKindForPath(path, targetPaths);
      resourceChanges.push({
        kind:
          identity.kind === "skill" || identity.kind === "agent"
            ? identity.kind
            : stats?.isDirectory()
              ? "directory"
              : "file",
        action: "remove",
        name: identity.id,
        path
      });
    }

    return {
      resourceChanges: resourceChanges.sort((left, right) => left.path.localeCompare(right.path)),
      resourceFingerprints,
      sourceFingerprints
    };
  };

  const ignoredSkillConflicts = async (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    targetPaths: TargetPaths
  ) => {
    const desiredSkillTargets = new Set(
      profile.assetPolicy.ownedDirs
        .filter((ownedDir) => ownedDir.kind === "skill")
        .map((ownedDir) => ownedDir.targetName)
        .concat((profile.assetPolicy.skillRefs ?? []).map((skillRef) => skillRef.targetName))
    );
    if (desiredSkillTargets.size === 0) {
      return [];
    }

    const inventory = await skillLibraryStore.scanInventory([targetPaths]);
    return inventory
      .filter((skill) => skill.status === "ignored" && desiredSkillTargets.has(skill.id))
      .map(
        (skill) =>
          `Cannot install ${skill.id} because an ignored unmanaged skill already exists at ${skill.path}`
      );
  };

  const previewProfile = async (profileId: string): Promise<ActivationPreview> => {
    const profile = await profileStore.readProfile(profileId);
    const mcpLibrary = await mcpLibraryStore.listServers();
    const materializedProfile = materializeProfileMcpRefs(profile, mcpLibrary);
    const adapter = targetRegistry.get(profile.manifest.targetId);
    const targetPaths = adapter.createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    const settings = await settingsStore.readSettings();
    const skillLibraryDir = resolveSkillsLibraryDir(paths, settings);
    const stateFile = await readTargetStateFile(adapter.descriptor.id);
    const targetPreview = await adapter.createPreview({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      state: stateFile.state
    });
    const profileErrors = validateProfileStructure(profile);
    const assetErrors = await adapter.validateAssets({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod
    });
    const drift = await findManagedDrift(stateFile.state, materializedProfile, targetPaths);
    const unmanagedWarnings = await unmanagedSkillWarnings(materializedProfile, targetPaths);
    const ignoredErrors = await ignoredSkillConflicts(materializedProfile, targetPaths);
    const assetBackupPaths = await adapter.getAssetBackupPaths({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod
    });
    const assetPlan = await planAssetResources(
      materializedProfile,
      targetPaths,
      assetBackupPaths,
      skillLibraryDir
    );
    const preview: ActivationPreview = {
      id: randomUUID(),
      profileId: profile.id,
      profileContentHash: profile.contentHash ?? createProfileContentHash(profile),
      targetId: adapter.descriptor.id,
      createdAt: new Date().toISOString(),
      warnings: targetPreview.warnings.concat(drift.warnings, unmanagedWarnings),
      errors: targetPreview.errors.concat(profileErrors, assetErrors, drift.errors, ignoredErrors),
      changes: targetPreview.changes,
      resourceChanges: assetPlan.resourceChanges,
      liveFingerprints: {
        ...targetPreview.liveFingerprints,
        [stateFile.path]: hashText(stateFile.content)
      },
      resourceFingerprints: assetPlan.resourceFingerprints,
      sourceFingerprints: assetPlan.sourceFingerprints,
      targetState: targetPreview.targetState
    };
    previews.set(preview.id, preview);
    return preview;
  };

  const applyProfile = async (
    profileId: string,
    previewId: string,
    options: ApplyProfileOptions = {}
  ): Promise<ApplyResult> => {
    const preview = previews.get(previewId);
    if (!preview || preview.profileId !== profileId) {
      return { ok: false, errors: ["Preview not found for profile"] };
    }
    const blockingErrors = options.allowManagedDrift
      ? preview.errors.filter((error) => !error.startsWith(MANAGED_DRIFT_PREFIX))
      : preview.errors;
    if (blockingErrors.length > 0) {
      return { ok: false, errors: blockingErrors };
    }

    const profile = await profileStore.readProfile(profileId);
    const currentProfileHash = profile.contentHash ?? createProfileContentHash(profile);
    if (currentProfileHash !== preview.profileContentHash) {
      return { ok: false, errors: ["Profile changed after preview; review the latest version"] };
    }
    const mcpLibrary = await mcpLibraryStore.listServers();
    const materializedProfile = materializeProfileMcpRefs(profile, mcpLibrary);
    const adapter = targetRegistry.get(preview.targetId);
    const targetPaths = adapter.createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    const settings = await settingsStore.readSettings();
    const skillLibraryDir = resolveSkillsLibraryDir(paths, settings);
    if (
      !allowRealHomeWrites &&
      !adapter.descriptor.realWritesEnabled &&
      resolve(paths.fakeHomeRoot) === resolve(paths.homeDir)
    ) {
      return {
        ok: false,
        errors: [`Real ${adapter.descriptor.name} writes are disabled`]
      };
    }

    for (const [path, fingerprint] of Object.entries(preview.liveFingerprints)) {
      const current = await readTextIfExists(path);
      if (hashText(current) !== fingerprint) {
        return { ok: false, errors: [`Live file changed after preview: ${path}`] };
      }
    }
    for (const [path, fingerprint] of Object.entries(preview.resourceFingerprints)) {
      const current = (await hashPath(path)) ?? "";
      if (current !== fingerprint) {
        return { ok: false, errors: [`Live resource changed after preview: ${path}`] };
      }
    }
    for (const [path, fingerprint] of Object.entries(preview.sourceFingerprints)) {
      const current = (await hashPath(path)) ?? "";
      if (current !== fingerprint) {
        return { ok: false, errors: [`Resource source changed after preview: ${path}`] };
      }
    }

    const assetErrors = await adapter.validateAssets({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod
    });
    if (assetErrors.length > 0) {
      return { ok: false, errors: assetErrors };
    }

    const statePath = statePathFor(preview.targetId);
    const assetBackupPaths = await adapter.getAssetBackupPaths({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod
    });
    const backup = await backupStore.createBackup(
      [
        ...preview.changes.map((change) => change.path),
        ...assetBackupPaths,
        statePath
      ],
      {
        operation: "apply",
        targetId: preview.targetId,
        profileId: profile.id,
        profileName: profile.manifest.name
      }
    );

    try {
      for (const change of preview.changes) {
        await writeAtomic(change.path, change.after);
      }

      await adapter.applyAssets({
        profile: materializedProfile,
        targetPaths,
        skillLibraryDir,
        skillSyncMethod: settings.skillSyncMethod
      });
      const managedResources = await snapshotManagedResources(
        [...preview.changes.map((change) => change.path), ...assetBackupPaths],
        targetPaths
      );
      await writeTargetState(preview.targetId, {
        ...preview.targetState,
        activeProfileId: profile.id,
        appliedProfileHash: profile.contentHash ?? createProfileContentHash(profile),
        lastAppliedAt: new Date().toISOString(),
        managedResources
      });
    } catch (error) {
      try {
        await restoreBackupEntries(backup);
      } catch (restoreError) {
        return {
          ok: false,
          errors: [
            `Failed to apply profile and failed to restore backup ${backup.id}: ${errorMessage(
              error
            )}; restore error: ${errorMessage(restoreError)}`
          ]
        };
      }

      return {
        ok: false,
        errors: [`Failed to apply profile; restored backup: ${errorMessage(error)}`]
      };
    }

    await appendHistory(paths, {
      type: "apply",
      profileId,
      targetId: preview.targetId,
      previewId,
      backupId: backup.id
    });

    return { ok: true, backupId: backup.id };
  };

  const previewRollback = async (backupId: string): Promise<RollbackPreview> => {
    const backup = await backupStore.readBackup(backupId);
    const changes = await Promise.all(backup.entries.map(createRollbackChange));
    return {
      id: backup.id,
      backupId: backup.id,
      createdAt: new Date().toISOString(),
      warnings: [],
      errors: [],
      changes
    };
  };

  const rollback = async (backupId: string): Promise<RollbackResult> => {
    const backup = await backupStore.readBackup(backupId);

    await restoreBackupEntries(backup);

    await appendHistory(paths, {
      type: "rollback",
      backupId
    });

    return { ok: true };
  };

  return {
    listTargetStates,
    previewProfile,
    applyProfile,
    previewRollback,
    rollback
  };
};
