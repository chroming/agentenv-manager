import { createHash } from "node:crypto";
import { appendFile, cp, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createBackupStore } from "./backupStore";
import { createUnifiedDiff } from "./diff";
import {
  pathEntryExists,
  pathExists,
  readTextIfExists,
  replacePathAtomically,
  replacePathWithCopy,
  writeAtomic
} from "./fileUtils";
import type { AgentEnvPaths } from "./paths";
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
import { normalizeSkillKey } from "../shared/skillIdentity";
import {
  materializeTargetResourcePolicy,
  profileManagesResource,
  profileResourceMode,
  profileUsesResource
} from "../shared/profileResources";
import { profileWithoutLocalSkillExceptions } from "../shared/effectiveProfile";
import {
  createTargetRegistry,
  type TargetRegistry
} from "./targets/registry";
import { createTargetScope, type TargetScope } from "./targets/targetScope";
import type {
  ActivationPreview,
  AdoptTargetChangesResult,
  ApplyIssue,
  ApplyResult,
  BackupManifest,
  EffectiveProfilePayload,
  ManagedResourceKind,
  ManagedResourceSnapshot,
  PlannedFileChange,
  PlannedResourceChange,
  ProfileDetail,
  RollbackPreview,
  RollbackResult,
  SharedSkillPreparation,
  SkillCleanupBackupSummary,
  SkillCleanupResult,
  SkillInventoryEntry,
  SkillLibraryEntry,
  StopManagingMode,
  StopManagingPreview,
  StopManagingResult,
  TargetManagementState,
  TargetPaths,
  TargetState
} from "../shared/types";
import { createProfileContentHash } from "./profileFingerprint";
import {
  collectLibraryResourceVersions,
  libraryResourceVersionsEqual
} from "../shared/libraryVersions";
import {
  createOwnerMarkerContent,
  markerPathFor,
  markerPathForFile
} from "./ownershipMarkers";
import { removeSkillDeployment } from "./skillDeployment";
import {
  expectedManagedSkillHashes,
  hashManagedResourcePath,
  hashPath
} from "./managedResourceHashes";
import {
  inspectSkillRoot,
  isolateSkillRoot,
  type SkillRootTransition
} from "./skillRootTopology";
import { redactSensitiveValues } from "./secretWarnings";
import { defaultTargetState, parseTargetState } from "./targetState";
import { createCaptureReceiptStore } from "./captureReceiptStore";
import { targetPathInputFor } from "./targets/pathInput";
import {
  buildSkillDeploymentPlan,
  fingerprintSkillDeploymentFacts,
  type SkillDeploymentPlan
} from "./skillDeploymentPlanner";
import {
  blockingApplyIssues,
  createApplyIssue,
  dedupeApplyIssues,
  replaceableApplyPaths
} from "./applyIssues";
import {
  desiredRuntimeSkills,
  desiredSkillTargets,
  findManagedDrift,
  fingerprintRuntimeSkillPreconditions,
  preservedUnmanagedSkillIssues,
  validateRuntimeSkills
} from "./applySkillIssues";

export interface ActivationServiceOptions {
  paths: AgentEnvPaths;
  profileStore: ProfileStore;
  targetRegistry?: TargetRegistry;
  allowRealHomeWrites?: boolean;
  settingsStore?: SettingsStore;
  targetScope?: TargetScope;
  skillLibraryStore?: SkillLibraryStore;
}

export interface ActivationService {
  listTargetStates(options?: { includeDisabled?: boolean }): Promise<TargetManagementState[]>;
  previewProfile(profileId: string, targetId?: string): Promise<ActivationPreview>;
  applyProfile(
    profileId: string,
    previewId: string
  ): Promise<ApplyResult>;
  completeSharedSkillMigration(input: {
    skillKey: string;
    libraryId: string;
    sharedPaths: string[];
    consumerTargetIds: string[];
  }): Promise<SkillCleanupResult>;
  listSharedSkillMigrationBackups(): Promise<SkillCleanupBackupSummary[]>;
  rollbackSharedSkillMigration(backupId: string): Promise<void>;
  previewRollback(backupId: string): Promise<RollbackPreview>;
  rollback(backupId: string): Promise<RollbackResult>;
  previewStopManaging(targetId: string, mode: StopManagingMode): Promise<StopManagingPreview>;
  stopManaging(previewId: string): Promise<StopManagingResult>;
  adoptTargetChanges(profileId: string, targetId: string): Promise<AdoptTargetChangesResult>;
}

const DEFAULT_TARGET_STATE: TargetState = defaultTargetState();

class InvalidTargetStateError extends Error {
  constructor(readonly statePath: string) {
    super(`Agent management state is invalid and must be recovered before changes can continue: ${statePath}`);
    this.name = "InvalidTargetStateError";
  }
}

interface InternalActivationPreview extends ActivationPreview {
  targetStateFingerprint: string;
  assetBackupPaths: string[];
  resourceManagement: {
    instructions: boolean;
    skills: boolean;
    pausedSkillPaths: string[];
  };
  skillDeployment: {
    plan: SkillDeploymentPlan;
    profile: ProfileDetail;
    sourceSkills: ProfileDetail["resources"]["skills"];
    inventoryPreconditionFingerprint: string;
    runtimePreconditionFingerprint: string;
    skillLibraryDir: string;
    skillSyncMethod: "symlink" | "copy" | "auto";
  };
}

const publicPreview = (preview: InternalActivationPreview): ActivationPreview => {
  const {
    targetStateFingerprint: _targetStateFingerprint,
    assetBackupPaths: _assetBackupPaths,
    resourceManagement: _resourceManagement,
    skillDeployment: _skillDeployment,
    ...publicValue
  } = preview;
  return {
    ...publicValue,
    issues: preview.issues.map((issue) => ({
      ...issue,
      message: redactSensitiveValues(issue.message),
      detail: issue.detail ? redactSensitiveValues(issue.detail) : undefined
    })),
    changes: preview.changes.map((change) => {
      const before = redactSensitiveValues(change.before);
      const after = redactSensitiveValues(change.after);
      return {
        ...change,
        before,
        after,
        diff: createUnifiedDiff(change.path, before, after)
      };
    })
  };
};

const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const normalizeSharedSkillPreparations = (
  preparations: readonly SharedSkillPreparation[] = []
) =>
  preparations
    .map((preparation) => ({
      ...preparation,
      sharedPaths: [...new Set(preparation.sharedPaths.map((path) => resolve(path)))].sort()
    }))
    .sort(
      (left, right) =>
        left.skillKey.localeCompare(right.skillKey) ||
        left.libraryId.localeCompare(right.libraryId) ||
        left.targetName.localeCompare(right.targetName) ||
        left.disposition.localeCompare(right.disposition) ||
        left.profileId.localeCompare(right.profileId) ||
        left.profileHash.localeCompare(right.profileHash)
    );

const normalizeKeptOutsideSkills = (
  entries: Readonly<NonNullable<TargetState["keptOutsideSkills"]>> = []
) =>
  entries
    .map((entry) => ({ ...entry, path: resolve(entry.path) }))
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.libraryId.localeCompare(right.libraryId) ||
        left.targetName.localeCompare(right.targetName)
    );

const sharedSkillPreparationsEqual = (
  left: readonly SharedSkillPreparation[] = [],
  right: readonly SharedSkillPreparation[] = []
) =>
  JSON.stringify(normalizeSharedSkillPreparations(left)) ===
  JSON.stringify(normalizeSharedSkillPreparations(right));

const fingerprintTargetState = (state: TargetState): string => {
  const managedResources = [...(state.managedResources ?? [])]
    .map((resource) => ({ ...resource, path: resolve(resource.path) }))
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id)
    );
  const appliedSkillVersions = Object.fromEntries(
    Object.entries(state.appliedLibraryVersions?.skills ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  const comparable = {
    activeProfileId: state.activeProfileId ?? null,
    appliedProfileHash: state.appliedProfileHash ?? null,
    appliedLibraryVersions: { skills: appliedSkillVersions },
    managedMcpNames: [...new Set(state.managedMcpNames)].sort(),
    managedResources,
    keptOutsideSkills: normalizeKeptOutsideSkills(state.keptOutsideSkills),
    sharedSkillPreparations: normalizeSharedSkillPreparations(
      state.sharedSkillPreparations
    ),
    recoveryRequired: state.recoveryRequired ?? null
  };
  return hashText(JSON.stringify(comparable));
};

const hashComparablePath = async (path: string): Promise<string | undefined> => {
  if (!(await pathExists(path))) {
    return undefined;
  }

  const hash = createHash("sha256");
  const walk = async (currentPath: string, relativePath: string) => {
    const stats = await stat(currentPath);
    if (stats.isDirectory()) {
      hash.update(`directory:${relativePath}`);
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".agentenv-owner.json" || entry.name === ".agentenv-skill.json") {
          continue;
        }
        await walk(join(currentPath, entry.name), join(relativePath, entry.name));
      }
      return;
    }
    hash.update(`file:${relativePath}`);
    hash.update(await readFile(currentPath));
  };

  await walk(path, ".");
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

const createRollbackChange = async (
  entry: BackupManifest["entries"][number]
): Promise<PlannedFileChange> => {
  if (entry.kind === "symlink") {
    const currentStats = (await pathEntryExists(entry.sourcePath))
      ? await lstat(entry.sourcePath)
      : undefined;
    const before = currentStats?.isSymbolicLink()
      ? `[link] ${await readlink(entry.sourcePath)}\n`
      : currentStats?.isDirectory()
        ? "[directory]\n"
        : currentStats?.isFile()
          ? "[file]\n"
          : "";
    const after = entry.missing ? "" : `[link] ${await readlink(entry.backupPath ?? "")}\n`;
    return {
      path: entry.sourcePath,
      before,
      after,
      diff: createUnifiedDiff(entry.sourcePath, before, after)
    };
  }
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
      await replacePathWithCopy(entry.backupPath ?? "", entry.sourcePath, {
        dereference: false
      });
      continue;
    }

    if (entry.kind === "symlink") {
      const linkTarget = await readlink(entry.backupPath ?? "");
      await replacePathAtomically(entry.sourcePath, (stagingPath) =>
        symlink(linkTarget, stagingPath, "dir")
      );
      continue;
    }

    const content = await readFile(entry.backupPath ?? "", "utf8");
    await writeAtomic(entry.sourcePath, content);
  }
};

const materializeManagedSkillLink = async (path: string) => {
  const stats = await lstat(path).catch(() => undefined);
  if (!stats?.isSymbolicLink()) return;
  await replacePathAtomically(path, (stagingPath) =>
    cp(path, stagingPath, { recursive: true, dereference: true })
  );
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const applyLibrarySkillAvailability = (
  profile: ProfileDetail,
  skillLibrary: readonly SkillLibraryEntry[]
): ProfileDetail => {
  const disabledIds = new Set(
    skillLibrary.filter((skill) => skill.globallyEnabled === false).map((skill) => skill.id)
  );
  if (disabledIds.size === 0) {
    return profile;
  }
  return {
    ...profile,
    resources: {
      ...profile.resources,
      skills: profile.resources.skills.filter(
        (reference) => !disabledIds.has(reference.libraryId)
      )
    }
  };
};

const effectivePayloadFor = (
  profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
  targetId: string,
  mcpActivationSupported: boolean
): EffectiveProfilePayload => {
  const instructions = profileUsesResource(
    profile.resources,
    targetId,
    "instructions"
  ) ? 1 : 0;
  const skills = profileUsesResource(profile.resources, targetId, "skills")
    ? profile.resources.skills.filter((reference) => reference.enabled).length
    : 0;
  const policy = profile.resources.mcpByTarget[targetId];
  const mcpServers =
    mcpActivationSupported && policy?.mode === "manage"
      ? policy.selections.length
      : 0;
  return {
    instructions,
    skills,
    mcpServers,
    total: instructions + skills + mcpServers
  };
};

export const createActivationService = ({
  paths,
  profileStore,
  targetRegistry = createTargetRegistry(),
  allowRealHomeWrites = false,
  settingsStore = createSettingsStore(paths),
  targetScope = createTargetScope(targetRegistry, settingsStore),
  skillLibraryStore = createSkillLibraryStore(paths, settingsStore, {
    targetPathsProvider: async () => {
      const settings = await settingsStore.readSettings();
      return targetRegistry.listAdapters().map((adapter) =>
        adapter.createTargetPaths(targetPathInputFor(paths, settings, adapter.descriptor.id))
      );
    },
    runtimeSnapshotProvider: (targetPaths) =>
      targetRegistry.get(targetPaths.targetId).skills.inspectRuntime(targetPaths)
  })
}: ActivationServiceOptions): ActivationService => {
  const backupStore = createBackupStore(paths);
  const captureReceiptStore = createCaptureReceiptStore(paths);
  const previews = new Map<string, InternalActivationPreview>();
  const stopManagingPreviews = new Map<string, StopManagingPreview>();
  const rollbackPreviewFingerprints = new Map<string, Record<string, string | undefined>>();
  const activeTargetOperations = new Set<string>();
  const targetPathsFor = async (targetId: string) => {
    const adapter = targetRegistry.get(targetId);
    const settings = await settingsStore.readSettings();
    return adapter.createTargetPaths(targetPathInputFor(paths, settings, targetId));
  };

  const statePathFor = (targetId: string) =>
    join(paths.targetStatesDir, `${targetId}.json`);

  const restoreBackupSafely = async (backup: BackupManifest) => {
    const exactPaths = new Set<string>();
    const resourceRoots = new Set<string>();
    const targetIds = [...new Set([backup.targetId, ...(backup.targetIds ?? [])])].filter(
      (id): id is string => Boolean(id)
    );
    for (const targetId of targetIds) {
      const targetPaths = await targetPathsFor(targetId);
      exactPaths.add(resolve(targetPaths.instructionsPath));
      exactPaths.add(resolve(targetPaths.configPath));
      exactPaths.add(resolve(statePathFor(targetId)));
      if (targetPaths.mcpConfigPath) exactPaths.add(resolve(targetPaths.mcpConfigPath));
      for (const root of [
        targetPaths.skillsDir,
        targetPaths.agentsDir,
        ...(targetPaths.skillScanDirs ?? []),
        ...(targetPaths.skillLocations ?? []).map((location) => location.path)
      ]) {
        if (root) resourceRoots.add(resolve(root));
      }
    }
    if (backup.profileId) {
      exactPaths.add(resolve(paths.profilesDir, backup.profileId));
    }

    for (const entry of backup.entries) {
      const sourcePath = resolve(entry.sourcePath);
      const allowedResource = [...resourceRoots].some((root) => {
        if (sourcePath === root) {
          return entry.kind === "symlink";
        }
        const child = relative(root, sourcePath);
        return child.length > 0 && !child.startsWith("..") && !child.includes("/../") && dirname(sourcePath) === root;
      });
      if (!exactPaths.has(sourcePath) && !allowedResource) {
        throw new Error(`Backup contains a path outside AgentEnv-managed locations: ${entry.sourcePath}`);
      }
    }
    await restoreBackupEntries(backup);
  };

  const readTargetStateFile = async (targetId: string) => {
    const path = statePathFor(targetId);
    if (!(await pathEntryExists(path))) {
      return { path, content: "", state: DEFAULT_TARGET_STATE };
    }
    const content = await readFile(path, "utf8");
    if (content.trim().length === 0) {
      throw new InvalidTargetStateError(path);
    }

    try {
      return { path, content, state: parseTargetState(JSON.parse(content)) };
    } catch {
      throw new InvalidTargetStateError(path);
    }
  };

  const listTargetStates = async (
    options: { includeDisabled?: boolean } = {}
  ): Promise<TargetManagementState[]> => {
    if (!(await pathExists(paths.targetStatesDir))) {
      return [];
    }
    const entries = await readdir(paths.targetStatesDir, { withFileTypes: true });
    const enabledTargetIds = new Set(await targetScope.listEnabledIds());
    const supportedTargetIds = new Set(targetRegistry.list().map((target) => target.id));
    const skillLibrary = await skillLibraryStore.listSkills();
    const states = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".json") &&
            supportedTargetIds.has(entry.name.replace(/\.json$/, "")) &&
            (options.includeDisabled || enabledTargetIds.has(entry.name.replace(/\.json$/, "")))
        )
        .map(async (entry): Promise<TargetManagementState | undefined> => {
          const targetId = entry.name.replace(/\.json$/, "");
          try {
            const { state } = await readTargetStateFile(targetId);
            if (
              !state.activeProfileId &&
              (state.managedResources ?? []).length === 0 &&
              !state.recoveryRequired
            ) {
              return undefined;
            }
            const activeManagedResources = (state.managedResources ?? []).filter(
              (resource) => !resource.paused
            );
            const activeProfile = state.activeProfileId
              ? await profileStore.readProfile(state.activeProfileId).catch(() => undefined)
              : undefined;
            const activeTargetPaths = activeProfile ? await targetPathsFor(targetId) : undefined;
            const activeExpectedSkillHashes =
              activeProfile && activeTargetPaths
                ? expectedManagedSkillHashes(activeProfile, activeTargetPaths, skillLibrary)
                : new Map<string, string>();
            const driftChecks = await Promise.all(
              activeManagedResources
                .filter((resource) => resource.kind !== "config")
                .map(async (resource) => {
                  const currentHash = await hashManagedResourcePath(resource.path, resource.kind);
                  if (
                    resource.kind === "skill" &&
                    activeExpectedSkillHashes.get(resolve(resource.path)) === currentHash
                  ) {
                    return false;
                  }
                  return currentHash !== resource.contentHash;
                })
            );
            const driftCount = driftChecks.filter(Boolean).length;
            let lifecycleStatus: TargetManagementState["lifecycleStatus"] = "unmanaged";
            let lifecycleReason: string | undefined;
            let activeProfileName: string | undefined;
            if (state.recoveryRequired) {
              lifecycleStatus = "recovery-required";
              lifecycleReason = state.recoveryRequired.error;
            } else if (driftCount > 0) {
              lifecycleStatus = "drifted";
              lifecycleReason = `${driftCount} managed ${driftCount === 1 ? "resource differs" : "resources differ"} from the applied snapshot`;
            } else if (state.activeProfileId) {
              if (activeProfile) {
                activeProfileName = activeProfile.manifest.name;
                const expectedHash =
                  activeProfile.targetContentHashes?.[targetId] ??
                  createProfileContentHash(activeProfile, targetId);
                const currentVersions = collectLibraryResourceVersions(
                  profileWithoutLocalSkillExceptions(
                    activeProfile,
                    state.keptOutsideSkills,
                    state.sharedSkillPreparations
                  ),
                  skillLibrary,
                  targetId
                );
                const isCurrent =
                  Boolean(expectedHash) &&
                  expectedHash === state.appliedProfileHash &&
                  libraryResourceVersionsEqual(currentVersions, state.appliedLibraryVersions);
                lifecycleStatus = isCurrent
                  ? (state.keptOutsideSkills?.length ?? 0) > 0
                    ? "applied-with-outside"
                    : "applied"
                  : "pending";
                if (!isCurrent) {
                  lifecycleReason = "Saved Profile or Library resources changed after the last Apply";
                } else if ((state.keptOutsideSkills?.length ?? 0) > 0) {
                  lifecycleReason = `${state.keptOutsideSkills!.length} ${
                    state.keptOutsideSkills!.length === 1 ? "Skill stays" : "Skills stay"
                  } outside AgentEnv on this device`;
                }
              } else {
                lifecycleStatus = "pending";
                lifecycleReason = "The active Profile is unavailable";
              }
            }
            return {
              targetId,
              activeProfileId: state.activeProfileId,
              activeProfileName,
              appliedProfileHash: state.appliedProfileHash,
              appliedLibraryVersions: state.appliedLibraryVersions,
              status: state.activeProfileId ? "managed" : "unmanaged",
              lifecycleStatus,
              lifecycleReason,
              lastAppliedAt: state.lastAppliedAt,
              managedResourceCount: activeManagedResources.length,
              warningCount: state.keptOutsideSkills?.length ?? 0,
              keptOutsideSkills: state.keptOutsideSkills ?? [],
              sharedSkillPreparations: state.sharedSkillPreparations ?? [],
              errorCount: driftCount
            };
          } catch (error) {
            if (!(error instanceof InvalidTargetStateError)) throw error;
            return {
              targetId,
              status: "managed",
              lifecycleStatus: "recovery-required",
              lifecycleReason: error.message,
              managedResourceCount: 0,
              sharedSkillPreparations: [],
              warningCount: 0,
              errorCount: 1
            };
          }
        })
    );

    return states
      .filter((state): state is TargetManagementState => Boolean(state))
      .sort((a, b) => a.targetId.localeCompare(b.targetId));
  };

  const writeTargetState = async (targetId: string, state: TargetState) => {
    await mkdir(paths.targetStatesDir, { recursive: true, mode: 0o700 });
    await writeAtomic(
      statePathFor(targetId),
      `${JSON.stringify({ ...state, formatVersion: 2 }, null, 2)}\n`
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
    if (path.endsWith(".agentenv-owner.json")) {
      return { kind: "file", id: basename(path) };
    }
    if (
      [targetPaths.skillsDir, ...(targetPaths.skillLocations ?? []).map((location) => location.path)]
        .filter(Boolean)
        .some((skillsRoot) => path.startsWith(`${skillsRoot}/`))
    ) {
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
      if (path.endsWith(".agentenv-owner.json")) continue;
      const identity = resourceKindForPath(path, targetPaths);
      if (identity.kind === "config") continue;
      const contentHash = await hashManagedResourcePath(path, identity.kind);
      if (!contentHash) {
        continue;
      }
      snapshots.push({
        ...identity,
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
        markerSource: string;
      }
    >();
    if (!profileManagesResource(profile.resources, targetPaths.targetId, "skills")) {
      return desired;
    }
    for (const skillRef of profile.resources.skills.filter(
      (reference) => reference.enabled
    )) {
      if (targetPaths.skillsDir) {
        desired.set(join(targetPaths.skillsDir, skillRef.targetName), {
          resource: {
            kind: "skill",
            name: skillRef.targetName,
            source: `Library / ${skillRef.libraryId}`
          },
          sourcePath: join(skillLibraryDir, skillRef.libraryId),
          markerSource: `skills-library/${skillRef.libraryId}`
        });
      }
    }
    return desired;
  };

  const planAssetResources = async (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    targetPaths: TargetPaths,
    assetPaths: string[],
    skillLibraryDir: string,
    skillRootTransition?: SkillRootTransition
  ) => {
    if (!profileManagesResource(profile.resources, targetPaths.targetId, "skills")) {
      return {
        resourceChanges: [] as PlannedResourceChange[],
        resourceFingerprints: {} as Record<string, string>,
        sourceFingerprints: {} as Record<string, string>
      };
    }
    const desired = desiredAssetResources(profile, targetPaths, skillLibraryDir);
    const resourceChanges: PlannedResourceChange[] = skillRootTransition
      ? [{
          kind: "directory",
          action: "replace",
          name: "Skills folder",
          path: skillRootTransition.path,
          source: `Linked to ${skillRootTransition.resolvedPath}`
        }]
      : [];
    const resourceFingerprints: Record<string, string> = {};
    const sourceFingerprints: Record<string, string> = {};

    await Promise.all(
      [...desired.values()].map(async ({ sourcePath }) => {
        sourceFingerprints[sourcePath] = (await hashComparablePath(sourcePath)) ?? "";
      })
    );

    if (skillRootTransition) {
      resourceFingerprints[skillRootTransition.path] =
        (await hashPath(skillRootTransition.path)) ?? "";
    }

    for (const path of [...new Set([...assetPaths, ...desired.keys()])]) {
      const behindTransitionedRoot = Boolean(
        skillRootTransition &&
        dirname(path) === skillRootTransition.path
      );
      if (!behindTransitionedRoot) {
        resourceFingerprints[path] = (await hashPath(path)) ?? "";
      }
      if (skillRootTransition && path === skillRootTransition.path) {
        continue;
      }
      const resource = desired.get(path);
      if (resource) {
        const exists = !behindTransitionedRoot && await pathEntryExists(path);
        const stats = exists ? await lstat(path) : undefined;
        const markerPath = stats?.isDirectory() ? markerPathFor(path) : markerPathForFile(path);
        const expectedMarker = createOwnerMarkerContent({
          profileId: profile.id,
          targetId: targetPaths.targetId,
          kind: resource.resource.kind === "agent" ? "agent" : "skill",
          source: resource.markerSource
        });
        const contentMatches =
          exists &&
          (await hashComparablePath(resource.sourcePath)) ===
            (await hashComparablePath(path));
        const markerMatches = exists && (await readTextIfExists(markerPath)) === expectedMarker;
        if (contentMatches && markerMatches) {
          continue;
        }
        resourceChanges.push({
          ...resource.resource,
          path,
          action: exists ? "replace" : "install"
        });
        continue;
      }
      if (path.endsWith(".agentenv-owner.json")) {
        continue;
      }
      const stats = (await pathEntryExists(path)) ? await lstat(path) : undefined;
      if (!stats) {
        continue;
      }
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

  const previewProfile = async (
    profileId: string,
    requestedTargetId?: string
  ): Promise<ActivationPreview> => {
    const sourceProfile = await profileStore.readProfile(profileId);
    const targetId =
      requestedTargetId ??
      sourceProfile.manifest.preferredTargetId ??
      targetRegistry.list()[0]?.id;
    if (!targetId) throw new Error("No Agent is available for this Profile");
    await targetScope.assertEnabled(targetId);
    const skillLibrary = await skillLibraryStore.listSkills();
    const adapter = targetRegistry.get(targetId);
    const availableProfile = applyLibrarySkillAvailability(sourceProfile, skillLibrary);
    const managesInstructions = profileManagesResource(
      availableProfile.resources,
      targetId,
      "instructions"
    );
    const managesSkills = profileManagesResource(
      availableProfile.resources,
      targetId,
      "skills"
    );
    const usesSkills = profileUsesResource(
      availableProfile.resources,
      targetId,
      "skills"
    );
    const instructionsMode = profileResourceMode(
      availableProfile.resources,
      targetId,
      "instructions"
    );
    const disabledLibrarySkills = (usesSkills ? sourceProfile.resources.skills : [])
      .filter(
        (reference) =>
          reference.enabled &&
          skillLibrary.find((skill) => skill.id === reference.libraryId)?.globallyEnabled === false
      )
      .map((reference) => reference.libraryId);
    const effectivePayload = effectivePayloadFor(
      availableProfile,
      targetId,
      adapter.descriptor.capabilities.mcpActivation === true
    );
    const profile = materializeTargetResourcePolicy(availableProfile, targetId);
    const targetPaths = await targetPathsFor(targetId);
    const skillRootInspection = managesSkills
      ? await inspectSkillRoot(targetPaths.skillsDir)
      : undefined;
    const skillRootTransition =
      skillRootInspection?.kind === "symlink"
        ? skillRootInspection.transition
        : undefined;
    const inventoryTargetPaths =
      !skillRootInspection ||
      skillRootInspection.kind === "directory" ||
      skillRootInspection.kind === "missing"
        ? targetPaths
        : {
            ...targetPaths,
            skillsDir: undefined,
            skillScanDirs: (targetPaths.skillScanDirs ?? []).filter(
              (path) => resolve(path) !== resolve(targetPaths.skillsDir ?? "")
            )
          };
    const inventory = managesSkills
      ? await skillLibraryStore.scanInventory([inventoryTargetPaths], skillLibrary)
      : [];
    const stateFile = await readTargetStateFile(adapter.descriptor.id);
    const isTakeover = !stateFile.state.activeProfileId;
    const profileContentHash =
      sourceProfile.targetContentHashes?.[adapter.descriptor.id] ??
      createProfileContentHash(sourceProfile, adapter.descriptor.id);
    const captureReceipt = isTakeover && managesSkills
      ? await captureReceiptStore.read(profile.id, adapter.descriptor.id)
      : undefined;
    const skillDeploymentPlan = buildSkillDeploymentPlan({
      profile,
      targetPaths,
      profileHash: profileContentHash,
      skillLibrary,
      inventory,
      captureReceipt
    });
    if (!managesSkills) {
      skillDeploymentPlan.sharedPreparations = stateFile.state.sharedSkillPreparations ?? [];
    }
    const deploymentProfile: ProfileDetail = {
      ...profile,
      resources: {
        ...profile.resources,
        skills: skillDeploymentPlan.effectiveSkills
      }
    };
    const materializedProfile = deploymentProfile;
    const approvedUnmanagedSkillHashes = new Map(
      skillDeploymentPlan.approvedUnmanagedSkills.map((skill) => [
        skill.path,
        skill.contentHash
      ])
    );
    const nativeSkillState = managesSkills
      ? await adapter.skills.readNativeState(targetPaths)
      : { disabledRuntimeNames: [], issues: [] };
    const runtimeValidation = managesSkills
      ? await validateRuntimeSkills(
          adapter,
          targetPaths,
          materializedProfile,
          skillLibrary,
          inventory,
          nativeSkillState
        )
      : [];
    const settings = await settingsStore.readSettings();
    const skillLibraryDir = resolveSkillsLibraryDir(paths, settings);
    const adapterPreview = await adapter.createPreview({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      state: stateFile.state,
      approvedUnmanagedSkillHashes,
      isolateSkillRoot: Boolean(skillRootTransition)
    });
    const instructionRemovalBefore =
      instructionsMode === "disable" &&
      (await pathEntryExists(targetPaths.instructionsPath))
        ? await readTextIfExists(targetPaths.instructionsPath)
        : undefined;
    const instructionRemoval =
      instructionRemovalBefore !== undefined
        ? {
            path: targetPaths.instructionsPath,
            before: instructionRemovalBefore,
            after: "",
            diff: createUnifiedDiff(
              targetPaths.instructionsPath,
              instructionRemovalBefore,
              ""
            ),
            action: "remove" as const
          }
        : undefined;
    const targetPreview = {
      ...adapterPreview,
      changes:
        instructionsMode === "disable"
          ? [
              ...adapterPreview.changes.filter(
                (change) => change.path !== targetPaths.instructionsPath
              ),
              ...(instructionRemoval ? [instructionRemoval] : [])
            ]
          : adapterPreview.changes
    };
    const profileIssues: ApplyIssue[] =
      skillRootInspection?.kind === "invalid"
        ? [createApplyIssue({
            code: "invalid-skill-root",
            resourceKind: "skills-root",
            path: targetPaths.skillsDir,
            message: skillRootInspection.error
          })]
        : [];
    const recoveryIssues: ApplyIssue[] = stateFile.state.recoveryRequired
      ? [createApplyIssue({
          code: "recovery-required",
          resourceKind: "target",
          resourceId: adapter.descriptor.id,
          message: `${adapter.descriptor.name} requires recovery before another Apply`,
          detail: stateFile.state.recoveryRequired.error
        })]
      : [];
    const assetBackupPaths = await adapter.getAssetBackupPaths({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      approvedUnmanagedSkillHashes,
      isolateSkillRoot: Boolean(skillRootTransition)
    });
    if (skillRootTransition) {
      assetBackupPaths.push(skillRootTransition.path);
    }
    assetBackupPaths.push(...skillDeploymentPlan.removalPaths);
    const legacySkillPaths = (managesSkills ? inventory : [])
      .filter(
        (skill) =>
          skill.legacyLocation &&
          skill.status === "managed" &&
          skill.managedByTarget === true
      )
      .map((skill) => skill.path);
    assetBackupPaths.push(...legacySkillPaths);
    const pausedSkillPaths = managesSkills
      ? []
      : (
          await Promise.all(
            (stateFile.state.managedResources ?? [])
              .filter((resource) => resource.kind === "skill")
              .map(async (resource) => {
                const stats = await lstat(resource.path).catch(() => undefined);
                return stats?.isSymbolicLink() ? resource.path : undefined;
              })
          )
        ).filter((path): path is string => Boolean(path));
    const pausedSkillFingerprints = Object.fromEntries(
      await Promise.all(
        pausedSkillPaths.map(async (path) => [path, (await hashPath(path)) ?? ""])
      )
    );
    assetBackupPaths.push(
      ...pausedSkillPaths.flatMap((path) => [path, markerPathForFile(path)])
    );
    const affectedManagedPaths = new Set([
      ...targetPreview.changes.map((change) => change.path),
      ...assetBackupPaths
    ]);
    const drift = await findManagedDrift({
      state: stateFile.state,
      profile: materializedProfile,
      targetPaths,
      hashPath: hashManagedResourcePath,
      affectedPaths: affectedManagedPaths,
      automaticallyAdoptablePaths: new Set(approvedUnmanagedSkillHashes.keys()),
      expectedManagedSkillHashes: expectedManagedSkillHashes(
        materializedProfile,
        targetPaths,
        skillLibrary
      )
    });
    const unmanagedIssues = managesSkills
      ? preservedUnmanagedSkillIssues(materializedProfile, inventory)
      : [];
    const rootTransitionIssues: ApplyIssue[] = skillRootTransition
      ? [createApplyIssue({
          code: "skill-root-isolation",
          resourceKind: "skills-root",
          resourceId: adapter.descriptor.id,
          path: skillRootTransition.path,
          message: `${adapter.descriptor.name} Skills root link will be backed up and replaced with a private directory`,
          detail: skillRootTransition.resolvedPath
            ? `Current destination: ${skillRootTransition.resolvedPath}`
            : `Current link: ${skillRootTransition.linkTarget}`
        })]
      : [];
    const disabledLibraryIssues = disabledLibrarySkills.map((id) => createApplyIssue({
      code: "globally-disabled-skill",
      resourceKind: "skill",
      resourceId: id,
      message: `Library Skill ${id} is globally disabled and will not be applied`
    }));
    const preAssetIssues = dedupeApplyIssues([
      ...targetPreview.issues,
      ...recoveryIssues,
      ...profileIssues,
      ...drift.issues,
      ...skillDeploymentPlan.issues,
      ...runtimeValidation,
      ...unmanagedIssues,
      ...rootTransitionIssues,
      ...disabledLibraryIssues
    ]);
    const replaceablePaths = replaceableApplyPaths(preAssetIssues);
    const assetIssues = await adapter.validateAssets({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      approvedUnmanagedSkillHashes,
      replaceablePaths,
      isolateSkillRoot: Boolean(skillRootTransition)
    });
    const assetPlan = await planAssetResources(
      materializedProfile,
      targetPaths,
      assetBackupPaths,
      skillLibraryDir,
      skillRootTransition
    );
    const sharedFingerprints = Object.fromEntries(
      await Promise.all(
        skillDeploymentPlan.sharedPaths.map(async (path) => [path, (await hashPath(path)) ?? ""])
      )
    );
    const issues = dedupeApplyIssues([...preAssetIssues, ...assetIssues]);
    const keptOutsideSkills = normalizeKeptOutsideSkills(
      skillDeploymentPlan.decisions
        .filter(
          (decision) =>
            decision.reason === "kept-outside" &&
            Boolean(decision.path)
        )
        .map((decision) => ({
          path: decision.path!,
          skillKey: decision.targetName,
          libraryId: decision.libraryId,
          targetName: decision.targetName
        }))
    );
    const preview: InternalActivationPreview = {
      id: randomUUID(),
      profileId: profile.id,
      profileContentHash,
      libraryVersions: collectLibraryResourceVersions(
        materializedProfile,
        skillLibrary,
        targetId
      ),
      targetId: adapter.descriptor.id,
      createdAt: new Date().toISOString(),
      issues,
      changes: targetPreview.changes.map((change) => ({
        ...change,
        category:
          change.path === targetPaths.instructionsPath
            ? "instructions"
            : change.path === targetPaths.configPath ||
                change.path === targetPaths.mcpConfigPath
              ? "mcp"
              : "configuration"
      })),
      resourceChanges: assetPlan.resourceChanges.concat(
        pausedSkillPaths.map((path) => ({
          kind: "skill" as const,
          action: "replace" as const,
          name: basename(path),
          path,
          source: "Keep current content and pause Profile management"
        }))
      ),
      liveFingerprints: {
        ...targetPreview.liveFingerprints
      },
      resourceFingerprints: {
        ...assetPlan.resourceFingerprints,
        ...pausedSkillFingerprints,
        ...sharedFingerprints
      },
      sourceFingerprints: assetPlan.sourceFingerprints,
      sharedSkillPreparations: normalizeSharedSkillPreparations(
        skillDeploymentPlan.sharedPreparations
      ),
      keptOutsideSkills,
      sharedSkillPreparationChanged: !sharedSkillPreparationsEqual(
        stateFile.state.sharedSkillPreparations,
        skillDeploymentPlan.sharedPreparations
      ),
      targetStateChanged:
        JSON.stringify([...new Set(stateFile.state.managedMcpNames)].sort()) !==
          JSON.stringify([...new Set(targetPreview.targetState.managedMcpNames)].sort()),
      targetState: targetPreview.targetState,
      effectivePayload,
      operation: isTakeover ? "takeover" : "apply",
      skillRootTransition,
      legacySkillPaths,
      assetBackupPaths: [...new Set(assetBackupPaths)].sort(),
      resourceManagement: {
        instructions: managesInstructions,
        skills: managesSkills,
        pausedSkillPaths
      },
      skillDeployment: {
        plan: skillDeploymentPlan,
        profile: materializedProfile,
        sourceSkills: availableProfile.resources.skills,
        inventoryPreconditionFingerprint: fingerprintSkillDeploymentFacts({
          inventory,
          profile: materializedProfile,
          skillLibrary,
          targetPaths: inventoryTargetPaths
        }),
        runtimePreconditionFingerprint: fingerprintRuntimeSkillPreconditions(
          nativeSkillState,
          materializedProfile,
          skillLibrary
        ),
        skillLibraryDir,
        skillSyncMethod: settings.skillSyncMethod
      },
      targetStateFingerprint: fingerprintTargetState(stateFile.state)
    };
    previews.set(preview.id, preview);
    return publicPreview(preview);
  };

  const applyProfile = async (
    profileId: string,
    previewId: string
  ): Promise<ApplyResult> => {
    const preview = previews.get(previewId);
    if (!preview || preview.profileId !== profileId) {
      return { ok: false, kind: "stale", errors: ["Preview not found for profile"] };
    }
    try {
      await targetScope.assertEnabled(preview.targetId);
    } catch (error) {
      return {
        ok: false,
        kind: "blocked",
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
    const blockingIssues = blockingApplyIssues(preview.issues);
    if (blockingIssues.length > 0) {
      return {
        ok: false,
        kind: "blocked",
        errors: blockingIssues.map((issue) => issue.message)
      };
    }
    if (
      preview.operation !== "takeover" &&
      preview.changes.length === 0 &&
      preview.resourceChanges.length === 0 &&
      !preview.sharedSkillPreparationChanged &&
      !preview.targetStateChanged
    ) {
      return { ok: false, kind: "no-op", errors: ["No changes to apply"] };
    }
    if (activeTargetOperations.has(preview.targetId)) {
      return {
        ok: false,
        kind: "busy",
        errors: [`Another operation is already running for ${preview.targetId}`]
      };
    }
    activeTargetOperations.add(preview.targetId);

    try {
      const sourceProfile = await profileStore.readProfile(profileId);
      const adapter = targetRegistry.get(preview.targetId);
      const settings = await settingsStore.readSettings();
      const currentSkillLibraryDir = resolveSkillsLibraryDir(paths, settings);
      if (
        currentSkillLibraryDir !== preview.skillDeployment.skillLibraryDir ||
        settings.skillSyncMethod !== preview.skillDeployment.skillSyncMethod
      ) {
        return {
          ok: false,
          kind: "stale",
          errors: ["Skill deployment settings changed after preview; review the latest version"]
        };
      }
      const skillLibrary = await skillLibraryStore.listSkills();
      const profile = applyLibrarySkillAvailability(
        sourceProfile,
        skillLibrary
      );
      const currentProfileHash =
        sourceProfile.targetContentHashes?.[preview.targetId] ??
        createProfileContentHash(sourceProfile, preview.targetId);
      if (currentProfileHash !== preview.profileContentHash) {
        return {
          ok: false,
          kind: "stale",
          errors: ["Profile changed after preview; review the latest version"]
        };
      }
      const currentLibraryVersions = collectLibraryResourceVersions(
        preview.skillDeployment.profile,
        skillLibrary,
        preview.targetId
      );
      if (!libraryResourceVersionsEqual(currentLibraryVersions, preview.libraryVersions)) {
        return {
          ok: false,
          kind: "stale",
          errors: ["Library resources changed after preview; review the latest versions"]
        };
      }
      if (
        JSON.stringify(profile.resources.skills) !==
        JSON.stringify(preview.skillDeployment.sourceSkills)
      ) {
        return {
          ok: false,
          kind: "stale",
          errors: ["Library Skill availability changed after preview; review the latest version"]
        };
      }
      const targetPaths = await targetPathsFor(preview.targetId);
      const currentStateFile = await readTargetStateFile(preview.targetId);
      if (fingerprintTargetState(currentStateFile.state) !== preview.targetStateFingerprint) {
        return {
          ok: false,
          kind: "stale",
          errors: ["AgentEnv management state changed after preview; review the latest version"]
        };
      }
      const currentSkillRoot = preview.resourceManagement.skills
        ? await inspectSkillRoot(targetPaths.skillsDir)
        : undefined;
      if (
        currentSkillRoot &&
        !preview.skillRootTransition &&
        (currentSkillRoot.kind === "symlink" || currentSkillRoot.kind === "invalid")
      ) {
        return {
          ok: false,
          kind: "stale",
          errors: ["Skills root changed after preview; review the latest version"]
        };
      }
      const inventoryTargetPaths = preview.skillRootTransition
        ? {
            ...targetPaths,
            skillsDir: undefined,
            skillScanDirs: (targetPaths.skillScanDirs ?? []).filter(
              (path) => resolve(path) !== resolve(targetPaths.skillsDir ?? "")
            )
          }
        : targetPaths;
      const inventory = preview.resourceManagement.skills
        ? await skillLibraryStore.scanInventory([inventoryTargetPaths], skillLibrary)
        : [];
      const materializedProfile = preview.skillDeployment.profile;
      if (
        fingerprintSkillDeploymentFacts({
          inventory,
          profile: materializedProfile,
          skillLibrary,
          targetPaths: inventoryTargetPaths
        }) !== preview.skillDeployment.inventoryPreconditionFingerprint
      ) {
        return {
          ok: false,
          kind: "stale",
          errors: ["A deployment-relevant Skill changed after preview; review the latest version"]
        };
      }
      const skillLibraryDir = preview.skillDeployment.skillLibraryDir;
      const isTakeover = preview.operation === "takeover";
      const approvedUnmanagedSkillHashes = new Map(
        preview.skillDeployment.plan.approvedUnmanagedSkills.map((skill) => [
          skill.path,
          skill.contentHash
        ])
      );
      const currentNativeSkillState = preview.resourceManagement.skills
        ? await adapter.skills.readNativeState(targetPaths)
        : { disabledRuntimeNames: [], issues: [] };
      if (
        fingerprintRuntimeSkillPreconditions(
          currentNativeSkillState,
          materializedProfile,
          skillLibrary
        ) !== preview.skillDeployment.runtimePreconditionFingerprint
      ) {
        return {
          ok: false,
          kind: "stale",
          errors: ["Agent Skill runtime settings changed after preview; review the latest version"]
        };
      }
      if (
        !allowRealHomeWrites &&
        !adapter.descriptor.realWritesEnabled &&
        resolve(paths.fakeHomeRoot) === resolve(paths.homeDir)
      ) {
        return {
          ok: false,
          kind: "blocked",
          errors: [`Real ${adapter.descriptor.name} writes are disabled`]
        };
      }

      for (const [path, fingerprint] of Object.entries(preview.liveFingerprints)) {
        const current = await readTextIfExists(path);
        if (hashText(current) !== fingerprint) {
          return {
            ok: false,
            kind: "stale",
            errors: [`Live file changed after preview: ${path}`]
          };
        }
      }
      for (const [path, fingerprint] of Object.entries(preview.resourceFingerprints)) {
        const current = (await hashPath(path)) ?? "";
        if (current !== fingerprint) {
          return {
            ok: false,
            kind: "stale",
            errors: [`Live resource changed after preview: ${path}`]
          };
        }
      }
      for (const [path, fingerprint] of Object.entries(preview.sourceFingerprints)) {
        const current = (await hashComparablePath(path)) ?? "";
        if (current !== fingerprint) {
          return {
            ok: false,
            kind: "stale",
            errors: [`Resource source changed after preview: ${path}`]
          };
        }
      }

      const statePath = statePathFor(preview.targetId);
      const assetBackupPaths = preview.assetBackupPaths;
      const replaceablePaths = replaceableApplyPaths(preview.issues);

      const backup = await backupStore.createBackup(
        [...new Set([
          ...preview.changes.map((change) => change.path),
          ...assetBackupPaths,
          statePath
        ])],
        {
          operation: "apply",
          targetId: preview.targetId,
          profileId: profile.id,
          profileName: profile.manifest.name
        }
      );

      const preOperationState = (await readTargetStateFile(preview.targetId)).state;
      await writeTargetState(preview.targetId, {
        ...preOperationState,
        recoveryRequired: {
          operation: "apply",
          error: "Profile Apply was interrupted before completion",
          backupId: backup.id,
          occurredAt: new Date().toISOString()
        }
      });

      try {
        for (const change of preview.changes) {
          if (change.action === "remove") {
            await rm(change.path, { force: true });
          } else {
            await writeAtomic(change.path, change.after);
          }
        }

        if (preview.skillRootTransition) {
          await isolateSkillRoot(preview.skillRootTransition);
        }
        for (const path of preview.resourceManagement.pausedSkillPaths) {
          await materializeManagedSkillLink(path);
        }
        if (preview.resourceChanges.length > 0) {
          await adapter.applyAssets({
            profile: materializedProfile,
            targetPaths,
            skillLibraryDir,
            skillSyncMethod: preview.skillDeployment.skillSyncMethod,
            approvedUnmanagedSkillHashes,
            replaceablePaths,
            plannedResourceRemovals: new Set(
              preview.resourceChanges
                .filter((change) => change.action === "remove")
                .map((change) => resolve(change.path))
            ),
            isolateSkillRoot: Boolean(preview.skillRootTransition)
          });
        }
        for (const legacyPath of preview.legacySkillPaths ?? []) {
          await removeSkillDeployment(legacyPath, {
            allowedRoot: dirname(legacyPath)
          });
          if (await pathEntryExists(legacyPath)) {
            throw new Error(`Post-apply verification failed for legacy Skill ${legacyPath}`);
          }
        }
        if (preview.skillRootTransition) {
          const isolatedRoot = await inspectSkillRoot(preview.skillRootTransition.path);
          if (isolatedRoot.kind !== "directory") {
            throw new Error(
              `Post-apply verification failed for Skills root ${preview.skillRootTransition.path}`
            );
          }
        }
        const managedAssetPaths = preview.skillRootTransition
          ? [...desiredAssetResources(materializedProfile, targetPaths, skillLibraryDir).keys()]
          : assetBackupPaths.filter(
              (path) =>
                !preview.resourceManagement.pausedSkillPaths.some(
                  (skillPath) => path === markerPathForFile(skillPath)
                )
            );
        const refreshedManagedResources = await snapshotManagedResources(
          [...preview.changes.map((change) => change.path), ...managedAssetPaths],
          targetPaths
        );
        const retainedManagedResources = (preOperationState.managedResources ?? [])
          .filter(
            (resource) =>
              (!preview.resourceManagement.instructions && resource.kind === "instructions") ||
              (!preview.resourceManagement.skills && resource.kind === "skill")
          )
          .map((resource) => ({ ...resource, paused: true }));
        const managedResources = [...refreshedManagedResources, ...retainedManagedResources]
          .filter(
            (resource, index, resources) =>
              resources.findIndex((candidate) => candidate.path === resource.path) === index
          )
          .sort((left, right) => left.path.localeCompare(right.path));
        for (const resource of refreshedManagedResources) {
          if ((await hashManagedResourcePath(resource.path, resource.kind)) !== resource.contentHash) {
            throw new Error(`Post-apply verification failed for ${resource.path}`);
          }
        }
        await writeTargetState(preview.targetId, {
          ...preview.targetState,
          activeProfileId: profile.id,
          appliedProfileHash: currentProfileHash,
          appliedLibraryVersions: currentLibraryVersions,
          lastAppliedAt: new Date().toISOString(),
          managedResources,
          keptOutsideSkills: preview.keptOutsideSkills,
          sharedSkillPreparations: preview.skillDeployment.plan.sharedPreparations,
          recoveryRequired: undefined
        });
      } catch (error) {
        try {
          await restoreBackupSafely(backup);
        } catch (restoreError) {
          const recoveryError = `Apply failed: ${errorMessage(error)}; automatic restore failed: ${errorMessage(restoreError)}`;
          try {
            const currentState = (await readTargetStateFile(preview.targetId)).state;
            await writeTargetState(preview.targetId, {
              ...currentState,
              recoveryRequired: {
                operation: "apply",
                error: recoveryError,
                backupId: backup.id,
                occurredAt: new Date().toISOString()
              }
            });
          } catch {
            // The returned error still identifies the backup when state persistence also fails.
          }
          return {
            ok: false,
            kind: "recovery-required",
            errors: [
              `Recovery required for backup ${backup.id}: ${recoveryError}`
            ]
          };
        }

        return {
          ok: false,
          kind: "failed",
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
      if (isTakeover) {
        await captureReceiptStore.remove(profile.id, preview.targetId).catch(() => undefined);
      }
      previews.delete(previewId);

      return { ok: true, backupId: backup.id };
    } finally {
      activeTargetOperations.delete(preview.targetId);
    }
  };

  const completeSharedSkillMigration = async ({
    skillKey,
    libraryId,
    sharedPaths,
    consumerTargetIds
  }: {
    skillKey: string;
    libraryId: string;
    sharedPaths: string[];
    consumerTargetIds: string[];
  }): Promise<SkillCleanupResult> => {
    const targetIds = [...new Set(consumerTargetIds)].sort();
    if (targetIds.length === 0) {
      throw new Error(`${skillKey} has no installed Agent consumers to migrate.`);
    }
    await Promise.all(targetIds.map((targetId) => targetScope.assertEnabled(targetId)));
    const busyTarget = targetIds.find((targetId) => activeTargetOperations.has(targetId));
    if (busyTarget) {
      throw new Error(`Another operation is already running for ${busyTarget}`);
    }
    targetIds.forEach((targetId) => activeTargetOperations.add(targetId));

    try {
      const skillLibrary = await skillLibraryStore.listSkills();
      const librarySkill = skillLibrary.find((skill) => skill.id === libraryId);
      if (!librarySkill) {
        throw new Error(`Library Skill is unavailable: ${libraryId}`);
      }

      const contexts: Array<{
        targetId: string;
        targetPaths: TargetPaths;
        targetPath: string;
        statePath: string;
        state: TargetState;
        preparation: SharedSkillPreparation;
      }> = [];
      const normalizedSharedPaths = [...new Set(sharedPaths.map((path) => resolve(path)))].sort();

      for (const targetId of targetIds) {
        const adapter = targetRegistry.get(targetId);
        const targetPaths = await targetPathsFor(targetId);
        if (!targetPaths.skillsDir) {
          throw new Error(`${adapter.descriptor.name} does not expose a skills directory.`);
        }
        const stateFile = await readTargetStateFile(targetId);
        const preparation = (stateFile.state.sharedSkillPreparations ?? []).find(
          (item) => item.skillKey === skillKey && item.libraryId === libraryId
        );
        if (!preparation || !stateFile.state.activeProfileId) {
          throw new Error(
            `${adapter.descriptor.name} is not prepared. Save and Apply its current Profile first.`
          );
        }
        if (stateFile.state.recoveryRequired) {
          throw new Error(`${adapter.descriptor.name} requires recovery before migration.`);
        }
        if (
          JSON.stringify([...(preparation.sharedPaths ?? [])].map((path) => resolve(path)).sort()) !==
          JSON.stringify(normalizedSharedPaths)
        ) {
          throw new Error(
            `${adapter.descriptor.name}'s saved preparation no longer matches this shared copy. Apply its current Profile again, then retry replacement.`
          );
        }

        const sourceProfile = await profileStore.readProfile(stateFile.state.activeProfileId);
        const effectiveProfile = applyLibrarySkillAvailability(sourceProfile, skillLibrary);
        const expectedReference = effectiveProfile.resources.skills.find(
          (reference) => reference.libraryId === libraryId && reference.enabled
        );
        const currentProfileHash =
          sourceProfile.targetContentHashes?.[targetId] ??
          createProfileContentHash(sourceProfile, targetId);
        const currentLibraryVersions = collectLibraryResourceVersions(
          profileWithoutLocalSkillExceptions(
            effectiveProfile,
            stateFile.state.keptOutsideSkills,
            stateFile.state.sharedSkillPreparations
          ),
          skillLibrary,
          targetId
        );
        if (
          preparation.profileId !== sourceProfile.id ||
          preparation.profileHash !== currentProfileHash ||
          preparation.disposition !== (expectedReference ? "install" : "omit") ||
          preparation.targetName !== (expectedReference?.targetName ?? libraryId) ||
          stateFile.state.appliedProfileHash !== currentProfileHash ||
          !libraryResourceVersionsEqual(
            currentLibraryVersions,
            stateFile.state.appliedLibraryVersions
          )
        ) {
          throw new Error(
            `${adapter.descriptor.name} preparation is stale. Preview and Apply the saved Profile again.`
          );
        }

        const targetPath = join(targetPaths.skillsDir, preparation.targetName);
        const inventory = await skillLibraryStore.scanInventory([targetPaths]);
        const occupyingItem = inventory.find(
          (item) => !item.sharedLocation && resolve(item.path) === resolve(targetPath)
        );
        if (
          occupyingItem &&
          (occupyingItem.status !== "managed" || occupyingItem.libraryId !== libraryId)
        ) {
          throw new Error(
            `${adapter.descriptor.name} cannot switch ${skillKey}: ${targetPath} is not the prepared AgentEnv copy.`
          );
        }
        contexts.push({
          targetId,
          targetPaths,
          targetPath,
          statePath: stateFile.path,
          state: stateFile.state,
          preparation
        });
      }

      for (const sharedPath of normalizedSharedPaths) {
        if (!(await pathExists(join(sharedPath, "SKILL.md")))) {
          throw new Error(`Shared Skill changed before migration: ${sharedPath}`);
        }
        if (
          (await hashComparablePath(sharedPath)) !==
          (await hashComparablePath(librarySkill.path))
        ) {
          throw new Error(`Shared Skill no longer matches Library: ${sharedPath}`);
        }
      }

      const backup = await backupStore.createBackup(
        [
          ...normalizedSharedPaths,
          ...contexts.flatMap((context) => [
            context.targetPath,
            markerPathForFile(context.targetPath),
            context.statePath
          ])
        ].filter((path, index, all) => all.indexOf(path) === index),
        {
          operation: "shared-skill-migration",
          targetIds,
          profileName: libraryId
        }
      );
      const installedPaths: string[] = [];

      try {
        await Promise.all(
          contexts.map((context) =>
            writeTargetState(context.targetId, {
              ...context.state,
              recoveryRequired: {
                operation: "apply",
                error: "Shared Skill migration was interrupted before completion",
                backupId: backup.id,
                occurredAt: new Date().toISOString()
              }
            })
          )
        );
        for (const sharedPath of normalizedSharedPaths) {
          await removeSkillDeployment(sharedPath, {
            allowedRoot: dirname(sharedPath)
          });
        }
        for (const context of contexts) {
          if (context.preparation.disposition === "install") {
            await skillLibraryStore.deployLibrarySkill({
              targetPaths: context.targetPaths,
              targetName: context.preparation.targetName,
              libraryId,
              profileId: context.preparation.profileId
            });
            installedPaths.push(context.targetPath);
          } else {
            await removeSkillDeployment(context.targetPath, {
              allowedRoot: context.targetPaths.skillsDir ?? dirname(context.targetPath)
            });
          }

          const retainedResources = (context.state.managedResources ?? []).filter(
            (resource) => resolve(resource.path) !== resolve(context.targetPath)
          );
          const migratedResources =
            context.preparation.disposition === "install"
              ? await snapshotManagedResources([context.targetPath], context.targetPaths)
              : [];
          await writeTargetState(context.targetId, {
            ...context.state,
            managedResources: retainedResources.concat(migratedResources),
            sharedSkillPreparations: (context.state.sharedSkillPreparations ?? []).filter(
              (item) => item.skillKey !== skillKey || item.libraryId !== libraryId
            )
          });
        }

        for (const sharedPath of normalizedSharedPaths) {
          if (await pathExists(sharedPath)) {
            throw new Error(`Shared Skill removal verification failed: ${sharedPath}`);
          }
        }
        for (const context of contexts) {
          const shouldExist = context.preparation.disposition === "install";
          if ((await pathExists(join(context.targetPath, "SKILL.md"))) !== shouldExist) {
            throw new Error(`Agent Skill verification failed: ${context.targetPath}`);
          }
          const targetStats = shouldExist
            ? await lstat(context.targetPath).catch(() => undefined)
            : undefined;
          const ownershipMarkerPath = targetStats?.isSymbolicLink()
            ? markerPathForFile(context.targetPath)
            : markerPathFor(context.targetPath);
          if (
            shouldExist &&
            ((await hashComparablePath(context.targetPath)) !==
              (await hashComparablePath(librarySkill.path)) ||
              (await readTextIfExists(ownershipMarkerPath)) !==
                createOwnerMarkerContent({
                  profileId: context.preparation.profileId,
                  targetId: context.targetId,
                  kind: "skill",
                  source: `skills-library/${libraryId}`
                }))
          ) {
            throw new Error(`Agent Skill ownership verification failed: ${context.targetPath}`);
          }
        }
        await appendHistory(paths, {
          type: "shared-skill-migration",
          skillKey,
          libraryId,
          targetIds,
          backupId: backup.id
        });
      } catch (error) {
        try {
          await restoreBackupSafely(backup);
        } catch (restoreError) {
          const recoveryError = `Shared Skill migration failed: ${errorMessage(error)}; automatic restore failed: ${errorMessage(restoreError)}`;
          await Promise.all(
            contexts.map(async (context) => {
              try {
                const currentState = (await readTargetStateFile(context.targetId)).state;
                await writeTargetState(context.targetId, {
                  ...currentState,
                  recoveryRequired: {
                    operation: "rollback",
                    error: recoveryError,
                    backupId: backup.id,
                    occurredAt: new Date().toISOString()
                  }
                });
              } catch {
                // The backup id in the reported error remains the manual recovery path.
              }
            })
          );
          throw new Error(
            `${recoveryError}. Recovery required for backup ${backup.id}.`
          );
        }
        throw new Error(
          `Shared Skill migration failed and was restored: ${errorMessage(error)}`
        );
      }

      return {
        backupId: backup.id,
        libraryId,
        managedLocations: normalizedSharedPaths.concat(installedPaths),
        operation: "retire"
      };
    } finally {
      targetIds.forEach((targetId) => activeTargetOperations.delete(targetId));
    }
  };

  const listSharedSkillMigrationBackups = async (): Promise<SkillCleanupBackupSummary[]> =>
    (await backupStore.listBackups())
      .filter((backup) => backup.operation === "shared-skill-migration")
      .map((backup) => ({
        id: backup.id,
        libraryId: backup.profileName ?? "shared-skill",
        createdAt: backup.createdAt,
        locationCount: backup.fileCount,
        operation: "retire" as const
      }));

  const rollbackSharedSkillMigration = async (backupId: string): Promise<void> => {
    const backup = await backupStore.readBackup(backupId);
    if (backup.operation !== "shared-skill-migration") {
      throw new Error(`Backup is not a shared Skill migration: ${backupId}`);
    }
    const targetIds = backup.targetIds ?? [];
    await Promise.all(targetIds.map((targetId) => targetScope.assertEnabled(targetId)));
    const busyTarget = targetIds.find((targetId) => activeTargetOperations.has(targetId));
    if (busyTarget) {
      throw new Error(`Another operation is already running for ${busyTarget}`);
    }
    targetIds.forEach((targetId) => activeTargetOperations.add(targetId));
    try {
      await restoreBackupSafely(backup);
      await appendHistory(paths, {
        type: "rollback-shared-skill-migration",
        backupId,
        targetIds
      });
    } finally {
      targetIds.forEach((targetId) => activeTargetOperations.delete(targetId));
    }
  };

  const previewRollback = async (backupId: string): Promise<RollbackPreview> => {
    const backup = await backupStore.readBackup(backupId);
    const targetIds = [...new Set([backup.targetId, ...(backup.targetIds ?? [])])].filter(
      (targetId): targetId is string => Boolean(targetId)
    );
    await Promise.all(targetIds.map((targetId) => targetScope.assertEnabled(targetId)));
    const changes = await Promise.all(backup.entries.map(createRollbackChange));
    rollbackPreviewFingerprints.set(
      backup.id,
      Object.fromEntries(
        await Promise.all(
          backup.entries.map(async (entry) => [entry.sourcePath, await hashPath(entry.sourcePath)])
        )
      )
    );
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
    const targetIds = [...new Set([backup.targetId, ...(backup.targetIds ?? [])])].filter(
      (targetId): targetId is string => Boolean(targetId)
    );
    try {
      await Promise.all(targetIds.map((targetId) => targetScope.assertEnabled(targetId)));
    } catch (error) {
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
    const previewFingerprints = rollbackPreviewFingerprints.get(backupId);
    if (!previewFingerprints) {
      return { ok: false, errors: ["Preview this rollback before restoring files"] };
    }
    for (const [path, previewFingerprint] of Object.entries(previewFingerprints)) {
      if ((await hashPath(path)) !== previewFingerprint) {
        rollbackPreviewFingerprints.delete(backupId);
        return {
          ok: false,
          errors: ["Agent files changed after the rollback preview. Review a fresh preview before restoring"]
        };
      }
    }
    const operationTargetId = backup.targetId;
    if (operationTargetId && activeTargetOperations.has(operationTargetId)) {
      return { ok: false, errors: [`Another operation is already running for ${operationTargetId}`] };
    }
    if (operationTargetId) {
      activeTargetOperations.add(operationTargetId);
    }

    try {
      if (operationTargetId) {
        const currentState = (await readTargetStateFile(operationTargetId)).state;
        await writeTargetState(operationTargetId, {
          ...currentState,
          recoveryRequired: {
            operation: "rollback",
            error: "Rollback was interrupted before completion",
            backupId,
            occurredAt: new Date().toISOString()
          }
        });
      }
      await restoreBackupSafely(backup);

      await appendHistory(paths, {
        type: "rollback",
        backupId
      });

      rollbackPreviewFingerprints.delete(backupId);

      return { ok: true };
    } catch (error) {
      if (operationTargetId) {
        try {
          const currentState = (await readTargetStateFile(operationTargetId)).state;
          await writeTargetState(operationTargetId, {
            ...currentState,
            recoveryRequired: {
              operation: "rollback",
              error: errorMessage(error),
              backupId,
              occurredAt: new Date().toISOString()
            }
          });
        } catch {
          // Return the rollback failure even if recovery state cannot be persisted.
        }
      }
      return { ok: false, errors: [`Recovery required: ${errorMessage(error)}`] };
    } finally {
      if (operationTargetId) {
        activeTargetOperations.delete(operationTargetId);
      }
    }
  };

  const materializeManagedResource = async (path: string) => {
    if (!(await pathEntryExists(path))) {
      return;
    }
    const stats = await lstat(path);
    const resolvedStats = stats.isSymbolicLink() ? await stat(path) : stats;
    if (resolvedStats.isDirectory()) {
      await replacePathAtomically(path, (stagingPath) =>
        cp(path, stagingPath, { recursive: true, dereference: true })
      );
      const removeMarkers = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = join(directory, entry.name);
          if (entry.name === ".agentenv-owner.json" || entry.name === ".agentenv-skill.json") {
            await rm(entryPath, { force: true });
          } else if (entry.isDirectory()) {
            await removeMarkers(entryPath);
          }
        }
      };
      await removeMarkers(path);
    } else if (stats.isSymbolicLink()) {
      await replacePathAtomically(path, (stagingPath) =>
        cp(path, stagingPath, { dereference: true })
      );
    }
    await rm(markerPathForFile(path), { force: true });
  };

  const previewStopManaging = async (
    targetId: string,
    mode: StopManagingMode
  ): Promise<StopManagingPreview> => {
    await targetScope.assertEnabled(targetId);
    const adapter = targetRegistry.get(targetId);
    const stateFile = await readTargetStateFile(targetId);
    const errors: string[] = [];
    if (!stateFile.state.activeProfileId) {
      errors.push(`${adapter.descriptor.name} is not managed by AgentEnv`);
    }
    let takeoverBackupId: string | undefined;
    let changes: PlannedFileChange[] = [];
    if (mode === "restore-pre-takeover") {
      const candidates = (await backupStore.listBackups())
        .filter((backup) => backup.targetId === targetId && backup.operation === "apply")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      takeoverBackupId = candidates[0]?.id;
      if (!takeoverBackupId) {
        errors.push(`No pre-takeover backup is available for ${adapter.descriptor.name}`);
      } else {
        const takeoverBackup = await backupStore.readBackup(takeoverBackupId);
        changes = await Promise.all(takeoverBackup.entries.map(createRollbackChange));
      }
    }
    const preview: StopManagingPreview = {
      id: randomUUID(),
      backupId: takeoverBackupId ?? "",
      targetId,
      targetName: adapter.descriptor.name,
      mode,
      takeoverBackupId,
      managedResourceCount: stateFile.state.managedResources?.length ?? 0,
      stateFingerprint: hashText(stateFile.content),
      createdAt: new Date().toISOString(),
      warnings:
        mode === "keep-current"
          ? ["Current Agent files will be kept and AgentEnv ownership will be removed"]
          : ["Current Agent files will be replaced with the environment captured before takeover"],
      errors,
      changes
    };
    stopManagingPreviews.set(preview.id, preview);
    return preview;
  };

  const stopManaging = async (previewId: string): Promise<StopManagingResult> => {
    const preview = stopManagingPreviews.get(previewId);
    if (!preview) {
      return { ok: false, errors: ["Stop managing preview not found"] };
    }
    try {
      await targetScope.assertEnabled(preview.targetId);
    } catch (error) {
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
    if (preview.errors.length > 0) {
      return { ok: false, errors: preview.errors };
    }
    if (activeTargetOperations.has(preview.targetId)) {
      return { ok: false, errors: [`Another operation is already running for ${preview.targetId}`] };
    }
    activeTargetOperations.add(preview.targetId);
    try {
      const stateFile = await readTargetStateFile(preview.targetId);
      if (hashText(stateFile.content) !== preview.stateFingerprint) {
        return { ok: false, errors: ["Agent management state changed after preview"] };
      }
      const managedPaths = (stateFile.state.managedResources ?? []).map((resource) => resource.path);
      const safetyBackup = await backupStore.createBackup(
        [...managedPaths, stateFile.path],
        {
          operation: "stop-managing",
          targetId: preview.targetId,
          profileId: stateFile.state.activeProfileId
        }
      );
      try {
        await writeTargetState(preview.targetId, {
          ...stateFile.state,
          recoveryRequired: {
            operation: "rollback",
            error: "Stop managing was interrupted before completion",
            backupId: safetyBackup.id,
            occurredAt: new Date().toISOString()
          }
        });
        if (preview.mode === "restore-pre-takeover" && preview.takeoverBackupId) {
          await restoreBackupSafely(await backupStore.readBackup(preview.takeoverBackupId));
        } else {
          for (const path of managedPaths) {
            await materializeManagedResource(path);
          }
          await rm(stateFile.path, { force: true });
        }
      } catch (error) {
        try {
          await restoreBackupSafely(safetyBackup);
        } catch (restoreError) {
          const recoveryError = `Stop managing failed: ${errorMessage(error)}; restore failed: ${errorMessage(restoreError)}`;
          await writeTargetState(preview.targetId, {
            ...stateFile.state,
            recoveryRequired: {
              operation: "rollback",
              error: recoveryError,
              backupId: safetyBackup.id,
              occurredAt: new Date().toISOString()
            }
          });
          return { ok: false, errors: [`Recovery required: ${recoveryError}`] };
        }
        return { ok: false, errors: [`Stop managing failed; restored backup: ${errorMessage(error)}`] };
      }
      await appendHistory(paths, {
        type: "stop-managing",
        targetId: preview.targetId,
        mode: preview.mode,
        backupId: safetyBackup.id
      });
      return { ok: true, backupId: safetyBackup.id };
    } finally {
      activeTargetOperations.delete(preview.targetId);
    }
  };

  const adoptTargetChanges = async (
    profileId: string,
    targetId: string
  ): Promise<AdoptTargetChangesResult> => {
    await targetScope.assertEnabled(targetId);
    const profile = await profileStore.readProfile(profileId);
    if (activeTargetOperations.has(targetId)) {
      throw new Error(`Another ${targetId} operation is already running`);
    }
    activeTargetOperations.add(targetId);
    try {
      const adapter = targetRegistry.get(targetId);
      const targetPaths = await targetPathsFor(targetId);
      const captured = await adapter.captureProfile(targetPaths);
      const adopted: AdoptTargetChangesResult["adopted"] = [];
      const skipped = [...captured.excluded];
      let instructions = profile.instructions;
      let resources = profile.resources;

      if (captured.instructions !== profile.instructions) {
        instructions = captured.instructions;
        adopted.push("instructions");
      }
      const currentMcpPolicy = profile.resources.mcpByTarget[targetId];
      if (
        adapter.descriptor.capabilities.mcpActivation &&
        currentMcpPolicy?.mode === "manage"
      ) {
        const capturedByName = new Map(
          (captured.mcpConnections ?? []).map((connection) => [connection.name, connection])
        );
        const capturedSelections = currentMcpPolicy.selections.map((selection) => ({
          name: selection.name,
          enabled: capturedByName.get(selection.name)?.enabled ?? false
        }));
        if (
          JSON.stringify(capturedSelections) !==
          JSON.stringify(currentMcpPolicy.selections)
        ) {
          resources = {
            ...resources,
            mcpByTarget: {
              ...resources.mcpByTarget,
              [targetId]: { mode: "manage", selections: capturedSelections }
            }
          };
          adopted.push("mcp");
        }
      }

      if (adopted.length === 0) {
        throw new Error(
          skipped.length > 0
            ? `No compatible live changes can be adopted: ${skipped.join("; ")}`
            : "No compatible live changes to adopt"
        );
      }
      if (profile.profileDir) {
        await backupStore.createBackup([profile.profileDir], {
          operation: "adopt-drift",
          targetId,
          profileId,
          profileName: profile.manifest.name
        });
      }
      const saved = await profileStore.saveProfile({
        manifest: profile.manifest,
        instructions,
        resources
      });
      return { profile: saved, adopted, skipped };
    } finally {
      activeTargetOperations.delete(targetId);
    }
  };

  return {
    listTargetStates,
    previewProfile,
    applyProfile,
    completeSharedSkillMigration,
    listSharedSkillMigrationBackups,
    rollbackSharedSkillMigration,
    previewRollback,
    rollback,
    previewStopManaging,
    stopManaging,
    adoptTargetChanges
  };
};
