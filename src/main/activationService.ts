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
import {
  createMcpLibraryStore,
  type McpLibraryStore
} from "./mcpLibraryStore";
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
import { parseSkillFrontmatter } from "./skillFrontmatter";
import {
  createTargetRegistry,
  type TargetRegistry
} from "./targets/registry";
import { createTargetScope, type TargetScope } from "./targets/targetScope";
import type {
  ActivationPreview,
  AdoptTargetChangesResult,
  ApplyProfileOptions,
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
import { targetProfile } from "./profileTargeting";
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
  inspectSkillRoot,
  isolateSkillRoot,
  type SkillRootTransition
} from "./skillRootTopology";
import { redactSensitiveValues } from "./secretWarnings";
import { defaultTargetState, parseTargetState } from "./targetState";

export interface ActivationServiceOptions {
  paths: AgentEnvPaths;
  profileStore: ProfileStore;
  targetRegistry?: TargetRegistry;
  allowRealHomeWrites?: boolean;
  settingsStore?: SettingsStore;
  targetScope?: TargetScope;
  mcpLibraryStore?: McpLibraryStore;
  skillLibraryStore?: SkillLibraryStore;
}

interface InternalApplyProfileOptions extends ApplyProfileOptions {
  additionalBackupPaths?: string[];
}

export interface ActivationService {
  listTargetStates(): Promise<TargetManagementState[]>;
  previewProfile(profileId: string, targetId?: string): Promise<ActivationPreview>;
  applyProfile(
    profileId: string,
    previewId: string,
    options?: InternalApplyProfileOptions
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

const publicPreview = (preview: ActivationPreview): ActivationPreview => ({
  ...preview,
  warnings: preview.warnings.map(redactSensitiveValues),
  errors: preview.errors.map(redactSensitiveValues),
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
});

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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const MANAGED_DRIFT_PREFIX = "External changes detected in AgentEnv-managed";
const UNMANAGED_SKILL_CONFLICT =
  /^skill target already exists and is not AgentEnv-owned: (.+)$/i;

const unmanagedSkillConflictPath = (error: string) =>
  error.match(UNMANAGED_SKILL_CONFLICT)?.[1];

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
    assetPolicy: {
      ...profile.assetPolicy,
      skillRefs: profile.assetPolicy.skillRefs.map((reference) =>
        disabledIds.has(reference.libraryId) ? { ...reference, enabled: false } : reference
      )
    }
  };
};

const effectivePayloadFor = (
  profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
  mcpActivationSupported: boolean
): EffectiveProfilePayload => {
  const compactConfig = profile.configText.replace(/\s/g, "");
  const instructions =
    profile.manifest.managed.instructions && profile.instructions.trim().length > 0 ? 1 : 0;
  const skills = profile.manifest.managed.assets
    ? profile.assetPolicy.ownedDirs.filter((asset) => asset.kind === "skill").length +
      profile.assetPolicy.ownedFiles.filter((asset) => asset.kind === "skill").length +
      (profile.assetPolicy.skillRefs?.filter((reference) => reference.enabled !== false).length ?? 0)
    : 0;
  const agents = profile.manifest.managed.assets
    ? profile.assetPolicy.ownedDirs.filter((asset) => asset.kind === "agent").length +
      profile.assetPolicy.ownedFiles.filter((asset) => asset.kind === "agent").length
    : 0;
  const selectedMcpCount = profile.manifest.managed.config
    ? (profile.assetPolicy.mcpSelections ?? []).filter(
        (selection) => selection.targetId === profile.manifest.targetId
      ).length
    : 0;
  const mcpServers = mcpActivationSupported ? selectedMcpCount : 0;
  const observedMcpServers = mcpActivationSupported ? 0 : selectedMcpCount;
  const nativeConfig =
    profile.manifest.managed.config && compactConfig.length > 0 && compactConfig !== "{}" ? 1 : 0;
  return {
    instructions,
    skills,
    mcpServers,
    observedMcpServers,
    agents,
    nativeConfig,
    total: instructions + skills + mcpServers + agents + nativeConfig
  };
};

export const createActivationService = ({
  paths,
  profileStore,
  targetRegistry = createTargetRegistry(),
  allowRealHomeWrites = false,
  settingsStore = createSettingsStore(paths),
  targetScope = createTargetScope(targetRegistry, settingsStore),
  mcpLibraryStore = createMcpLibraryStore(paths),
  skillLibraryStore = createSkillLibraryStore(paths, settingsStore, {
    targetPathsProvider: () => targetRegistry.listAdapters().map((adapter) =>
      adapter.createTargetPaths({
        homeDir: paths.homeDir,
        fakeHomeRoot: paths.fakeHomeRoot
      })
    ),
    runtimeSnapshotProvider: (targetPaths) =>
      targetRegistry.get(targetPaths.targetId).skills.inspectRuntime(targetPaths)
  })
}: ActivationServiceOptions): ActivationService => {
  const backupStore = createBackupStore(paths);
  const previews = new Map<string, ActivationPreview>();
  const stopManagingPreviews = new Map<string, StopManagingPreview>();
  const rollbackPreviewFingerprints = new Map<string, Record<string, string | undefined>>();
  const activeTargetOperations = new Set<string>();

  const statePathFor = (targetId: string) =>
    join(paths.targetStatesDir, `${targetId}.json`);

  const restoreBackupSafely = async (backup: BackupManifest) => {
    const exactPaths = new Set<string>();
    const resourceRoots = new Set<string>();
    const targetIds = [...new Set([backup.targetId, ...(backup.targetIds ?? [])])].filter(
      (id): id is string => Boolean(id)
    );
    for (const targetId of targetIds) {
      const targetPaths = targetRegistry.get(targetId).createTargetPaths({
        homeDir: paths.homeDir,
        fakeHomeRoot: paths.fakeHomeRoot
      });
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

  const listTargetStates = async (): Promise<TargetManagementState[]> => {
    if (!(await pathExists(paths.targetStatesDir))) {
      return [];
    }
    const entries = await readdir(paths.targetStatesDir, { withFileTypes: true });
    const enabledTargetIds = new Set(await targetScope.listEnabledIds());
    const [skillLibrary, mcpLibrary] = await Promise.all([
      skillLibraryStore.listSkills(),
      mcpLibraryStore.listServers()
    ]);
    const states = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".json") &&
            enabledTargetIds.has(entry.name.replace(/\.json$/, ""))
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
            const driftChecks = await Promise.all(
              (state.managedResources ?? [])
                .filter((resource) => resource.kind !== "config")
                .map(async (resource) => {
                  const currentHash = await hashPath(resource.path);
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
              try {
                const profile = await profileStore.readProfile(state.activeProfileId);
                activeProfileName = profile.manifest.name;
                const expectedHash =
                  profile.targetContentHashes?.[targetId] ??
                  (profile.manifest.targetId === targetId ? profile.contentHash : undefined);
                const currentVersions = collectLibraryResourceVersions(
                  profile,
                  skillLibrary,
                  mcpLibrary
                );
                const isCurrent =
                  Boolean(expectedHash) &&
                  expectedHash === state.appliedProfileHash &&
                  libraryResourceVersionsEqual(currentVersions, state.appliedLibraryVersions);
                lifecycleStatus = isCurrent ? "applied" : "pending";
                if (!isCurrent) {
                  lifecycleReason = "Saved Profile or Library resources changed after the last Apply";
                }
              } catch {
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
              managedResourceCount: state.managedResources?.length ?? 0,
              sharedSkillPreparations: state.sharedSkillPreparations ?? [],
              warningCount: 0,
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
      `${JSON.stringify({ ...state, formatVersion: 1 }, null, 2)}\n`
    );
  };

  const sharedSkillPreparationPlan = async (
    profile: ProfileDetail,
    targetPaths: TargetPaths,
    profileHash: string,
    skillLibrary: SkillLibraryEntry[],
    inventory: SkillInventoryEntry[]
  ) => {
    const sharedBySkill = new Map<
      string,
      { skillKey: string; libraryId: string; paths: Set<string> }
    >();
    for (const item of inventory) {
      if (
        !item.sharedLocation ||
        !item.libraryId ||
        item.contentMatchesLibrary !== true ||
        item.ignoreReason === "keep-shared" ||
        skillLibrary.some(
          (skill) => skill.id === item.libraryId && resolve(skill.path) === resolve(item.path)
        )
      ) {
        continue;
      }
      const key = `${item.skillKey}:${item.libraryId}`;
      const entry = sharedBySkill.get(key) ?? {
        skillKey: item.skillKey,
        libraryId: item.libraryId,
        paths: new Set<string>()
      };
      entry.paths.add(resolve(item.path));
      sharedBySkill.set(key, entry);
    }

    const preparations: SharedSkillPreparation[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const fingerprints: Record<string, string> = {};
    const deferredLibraryIds = new Set<string>();
    for (const shared of sharedBySkill.values()) {
      const reference = profile.assetPolicy.skillRefs.find(
        (item) => item.libraryId === shared.libraryId && item.enabled !== false
      );
      const targetName = reference?.targetName ?? shared.libraryId;
      const profileOwnedConflict = profile.assetPolicy.ownedDirs.some(
        (item) => item.kind === "skill" && item.targetName === targetName
      );
      if (profileOwnedConflict) {
        errors.push(
          `Cannot prepare shared Skill ${shared.skillKey}: Profile-owned Skill ${targetName} uses the same install name.`
        );
        continue;
      }
      if (targetPaths.skillsDir) {
        const targetPath = join(targetPaths.skillsDir, targetName);
        const occupyingItem = inventory.find(
          (item) => !item.sharedLocation && resolve(item.path) === resolve(targetPath)
        );
        if (
          occupyingItem &&
          occupyingItem.status !== "managed"
        ) {
          errors.push(
            `Cannot prepare shared Skill ${shared.skillKey}: ${targetPath} is occupied by a non-AgentEnv Skill.`
          );
          continue;
        }
      }
      const sharedPaths = [...shared.paths].sort();
      for (const path of sharedPaths) {
        fingerprints[path] = (await hashPath(path)) ?? "";
      }
      deferredLibraryIds.add(shared.libraryId);
      preparations.push({
        skillKey: shared.skillKey,
        libraryId: shared.libraryId,
        sharedPaths,
        targetName,
        disposition: reference ? "install" : "omit",
        profileId: profile.id,
        profileHash
      });
      warnings.push(
        reference
          ? `Shared Skill ${shared.skillKey} stays active from its compatibility directory until Replace shared copy installs the Agent-specific copy.`
          : `Shared Skill ${shared.skillKey} stays active until Replace shared copy removes the compatibility copy; this Profile will omit it afterward.`
      );
    }

    preparations.sort((left, right) => left.skillKey.localeCompare(right.skillKey));
    return {
      runtimeProfile: {
        ...profile,
        assetPolicy: {
          ...profile.assetPolicy,
          skillRefs: profile.assetPolicy.skillRefs.filter(
            (reference) => !deferredLibraryIds.has(reference.libraryId)
          )
        }
      },
      preparations,
      errors,
      warnings,
      fingerprints
    };
  };

  const desiredSkillTargets = (profile: Awaited<ReturnType<ProfileStore["readProfile"]>>) =>
    new Set(
      profile.assetPolicy.ownedDirs
        .filter((ownedDir) => ownedDir.kind === "skill")
        .map((ownedDir) => ownedDir.targetName)
        .concat(
          (profile.assetPolicy.skillRefs ?? [])
            .filter((skillRef) => skillRef.enabled !== false)
            .map((skillRef) => skillRef.targetName)
        )
    );

  const desiredRuntimeSkills = async (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    skillLibrary: SkillLibraryEntry[]
  ) => {
    const ownedSkills = await Promise.all(
      profile.assetPolicy.ownedDirs
      .filter((ownedDir) => ownedDir.kind === "skill")
      .map(async (ownedDir) => {
        const sourcePath = join(profile.profileDir ?? "", ownedDir.source, "SKILL.md");
        const frontmatter = parseSkillFrontmatter(await readTextIfExists(sourcePath));
        return {
          runtimeName: frontmatter.name || ownedDir.targetName,
          deploymentName: ownedDir.targetName,
          source: `Profile / ${ownedDir.source}`
        };
      })
    );
    const librarySkills = (profile.assetPolicy.skillRefs ?? [])
      .filter((reference) => reference.enabled !== false)
      .map((reference) => ({
        runtimeName:
          skillLibrary.find((skill) => skill.id === reference.libraryId)?.name ||
          reference.targetName,
        deploymentName: reference.targetName,
        source: `Library / ${reference.libraryId}`
      }));
    return [...ownedSkills, ...librarySkills];
  };

  const validateRuntimeSkills = async (
    adapter: ReturnType<TargetRegistry["get"]>,
    targetPaths: TargetPaths,
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    skillLibrary: SkillLibraryEntry[],
    inventory: SkillInventoryEntry[]
  ) => {
    const nativeState = await adapter.skills.readNativeState(targetPaths);
    const desired = await desiredRuntimeSkills(profile, skillLibrary);
    const byRuntimeName = new Map<string, typeof desired>();
    for (const item of desired) {
      const key = normalizeSkillKey(item.runtimeName);
      byRuntimeName.set(key, [...(byRuntimeName.get(key) ?? []), item]);
    }
    const errors = [...byRuntimeName.entries()].flatMap(([runtimeName, items]) =>
      items.length > 1
        ? [
            `Profile declares runtime Skill name ${runtimeName} more than once (${items
              .map((item) => item.source)
              .join(", ")})`
          ]
        : []
    );
    const warnings = nativeState.issues
      .filter((issue) => issue.severity !== "error")
      .map((issue) => issue.message);
    errors.push(
      ...nativeState.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
    );
    const desiredNames = new Set(byRuntimeName.keys());
    for (const runtimeName of nativeState.disabledRuntimeNames) {
      if (desiredNames.has(normalizeSkillKey(runtimeName))) {
        errors.push(
          `${adapter.descriptor.name} has Skill ${runtimeName} disabled in native settings; enable it there before applying this Profile`
        );
      }
    }
    for (const [runtimeName, desiredItems] of byRuntimeName) {
      if (desiredItems.length !== 1) continue;
      const desiredItem = desiredItems[0];
      const conflictingPaths = [...new Set(
        inventory
          .filter(
            (item) =>
              item.locationRole !== "discovery-only" &&
              item.runtimeAvailability !== "disabled" &&
              normalizeSkillKey(item.runtimeName ?? item.name) === runtimeName &&
              normalizeSkillKey(item.deploymentName ?? item.id) !==
                normalizeSkillKey(desiredItem.deploymentName) &&
              !(item.status === "managed" && item.managedByTarget === true)
          )
          .map((item) => item.path)
      )].sort((left, right) => left.localeCompare(right));
      for (const path of conflictingPaths) {
        errors.push(
          `Cannot install runtime Skill ${desiredItem.runtimeName} as ${desiredItem.deploymentName} because an existing Agent Skill declares the same runtime name at ${path}`
        );
      }
    }
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  };

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
    targetPaths: TargetPaths,
    affectedPaths?: ReadonlySet<string>
  ) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const paths = new Set<string>();
    const desired = desiredManagedPaths(profile, targetPaths);
    for (const resource of state.managedResources ?? []) {
      // Native configuration files have shared ownership. Adapters compare and
      // patch only their managed fields, while Preview freshness protects the
      // whole file between confirmation and Apply.
      if (resource.kind === "config") continue;
      if (affectedPaths && !affectedPaths.has(resource.path)) {
        continue;
      }
      const currentHash = await hashPath(resource.path);
      if (!currentHash) {
        if (desired.has(resource.path)) {
          warnings.push(`Will restore missing managed ${resource.kind} ${resource.id}: ${resource.path}`);
        }
        continue;
      }
      if (currentHash !== resource.contentHash) {
        paths.add(resource.path);
        errors.push(
          `External changes detected in AgentEnv-managed ${resource.kind} ${resource.id}: ${resource.path}`
        );
      }
    }
    return { errors, warnings, paths };
  };

  const unmanagedSkillWarnings = async (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    inventory: SkillInventoryEntry[]
  ) => {
    const desired = desiredSkillTargets(profile);
    return inventory
      .filter(
        (skill) =>
          (skill.status === "unmanaged" ||
            skill.status === "ignored" ||
            skill.status === "external") &&
          !desired.has(skill.id)
      )
      .map((skill) =>
        skill.status === "ignored"
          ? `Ignored local skill kept: ${skill.path}`
          : skill.status === "external"
            ? `${skill.externalOwnership?.displayName ?? skill.externalOwnership?.manager ?? "Externally"}-managed skill kept: ${skill.path}`
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
      const identity = resourceKindForPath(path, targetPaths);
      if (identity.kind === "config") continue;
      const contentHash = await hashPath(path);
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
          sourcePath: join(profile.profileDir ?? "", asset.source),
          markerSource: asset.source
        });
      }
    }
    for (const skillRef of (profile.assetPolicy.skillRefs ?? []).filter(
      (reference) => reference.enabled !== false
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
        sourceFingerprints[sourcePath] = (await hashPath(sourcePath)) ?? "";
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
        const exists = !behindTransitionedRoot && await pathExists(path);
        const stats = exists ? await stat(path) : undefined;
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
    inventory: SkillInventoryEntry[]
  ) => {
    const desiredSkillTargets = new Set(
      profile.assetPolicy.ownedDirs
        .filter((ownedDir) => ownedDir.kind === "skill")
        .map((ownedDir) => ownedDir.targetName)
        .concat(
          (profile.assetPolicy.skillRefs ?? [])
            .filter((skillRef) => skillRef.enabled !== false)
            .map((skillRef) => skillRef.targetName)
        )
    );
    if (desiredSkillTargets.size === 0) {
      return [];
    }

    return inventory
      .filter((skill) => skill.status === "ignored" && desiredSkillTargets.has(skill.id))
      .map(
        (skill) =>
          `Cannot install ${skill.id} because an ignored unmanaged skill already exists at ${skill.path}`
      );
  };

  const resolveExternalSkills = async (
    profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
    inventory: SkillInventoryEntry[],
    skillLibrary: SkillLibraryEntry[]
  ) => {
    const references = (profile.assetPolicy.skillRefs ?? []).filter(
      (reference) => reference.enabled !== false
    );
    const desired = desiredSkillTargets(profile);
    const desiredRuntimeNames = new Set(
      (await desiredRuntimeSkills(profile, skillLibrary)).map((item) =>
        normalizeSkillKey(item.runtimeName)
      )
    );
    const external = desired.size === 0
      ? []
      : inventory.filter(
          (skill) =>
            skill.status === "external" &&
            (desired.has(skill.id) || desiredRuntimeNames.has(skill.skillKey))
        );
    const preservedReferences = new Set(
      external.flatMap((skill) => {
        const reference = references.find(
          (item) => item.targetName === skill.id && item.libraryId === skill.libraryId
        );
        return reference && skill.contentMatchesLibrary === true
          ? [`${reference.libraryId}:${reference.targetName}`]
          : [];
      })
    );
    const conflicts = external.filter(
      (skill) =>
        !references.some(
          (reference) =>
            preservedReferences.has(`${reference.libraryId}:${reference.targetName}`) &&
            reference.targetName === skill.id
        )
    );
    return {
      profile: preservedReferences.size === 0
        ? profile
        : {
            ...profile,
            assetPolicy: {
              ...profile.assetPolicy,
              skillRefs: profile.assetPolicy.skillRefs.filter(
                (reference) =>
                  !preservedReferences.has(`${reference.libraryId}:${reference.targetName}`)
              )
            }
          },
      errors: conflicts.map(
        (skill) => {
          const manager = skill.externalOwnership?.displayName ??
            skill.externalOwnership?.manager ??
            "another tool";
          if (skill.externalOwnership?.manager === "skills-cli") {
            return `Cannot install ${skill.id} because Skills CLI manages the existing Skill at ${skill.path}. Remove it from Skills CLI, then rescan before applying this Profile.`;
          }
          return `Cannot install ${skill.runtimeName ?? skill.id} because ${manager} manages the existing Skill at ${skill.path}. Disable or remove it from ${manager}, then rescan before applying this Profile.`;
        }
      ),
      warnings: external
        .filter((skill) => !conflicts.includes(skill))
        .map(
          (skill) =>
            `${skill.runtimeName ?? skill.id} is already provided by ${skill.externalOwnership?.displayName ?? skill.externalOwnership?.manager ?? "another tool"} with matching content and will be preserved`
        ),
      paths: new Set(external.map((skill) => skill.path))
    };
  };

  const previewProfile = async (
    profileId: string,
    requestedTargetId?: string
  ): Promise<ActivationPreview> => {
    const sourceProfile = await profileStore.readProfile(profileId);
    const targetId = requestedTargetId ?? sourceProfile.manifest.targetId;
    await targetScope.assertEnabled(targetId);
    const mcpLibrary = await mcpLibraryStore.listServers();
    const skillLibrary = await skillLibraryStore.listSkills();
    const adapter = targetRegistry.get(targetId);
    const targeted = targetProfile(
      sourceProfile,
      adapter,
      targetRegistry.get(sourceProfile.manifest.targetId)
    );
    const profile = applyLibrarySkillAvailability(targeted.profile, skillLibrary);
    const disabledLibrarySkills = targeted.profile.assetPolicy.skillRefs
      .filter(
        (reference) =>
          reference.enabled !== false &&
          skillLibrary.find((skill) => skill.id === reference.libraryId)?.globallyEnabled === false
      )
      .map((reference) => reference.libraryId);
    const effectivePayload = effectivePayloadFor(
      profile,
      adapter.descriptor.capabilities.mcpActivation === true
    );
    const targetPaths = adapter.createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    const skillRootInspection = await inspectSkillRoot(targetPaths.skillsDir);
    const skillRootTransition =
      skillRootInspection.kind === "symlink"
        ? skillRootInspection.transition
        : undefined;
    const inventoryTargetPaths =
      skillRootInspection.kind === "directory" || skillRootInspection.kind === "missing"
        ? targetPaths
        : {
            ...targetPaths,
            skillsDir: undefined,
            skillScanDirs: (targetPaths.skillScanDirs ?? []).filter(
              (path) => resolve(path) !== resolve(targetPaths.skillsDir ?? "")
            )
          };
    const inventory = await skillLibraryStore.scanInventory(
      [inventoryTargetPaths],
      skillLibrary
    );
    const profileContentHash =
      sourceProfile.targetContentHashes?.[adapter.descriptor.id] ??
      createProfileContentHash(targeted.profile);
    const preparationPlan = await sharedSkillPreparationPlan(
      profile,
      targetPaths,
      profileContentHash,
      skillLibrary,
      inventory
    );
    const externallyResolved = await resolveExternalSkills(
      preparationPlan.runtimeProfile,
      inventory,
      skillLibrary
    );
    const materializedProfile = adapter.materializeMcpRefs(
      externallyResolved.profile,
      mcpLibrary
    );
    const runtimeValidation = await validateRuntimeSkills(
      adapter,
      targetPaths,
      materializedProfile,
      skillLibrary,
      inventory
    );
    const settings = await settingsStore.readSettings();
    const skillLibraryDir = resolveSkillsLibraryDir(paths, settings);
    const stateFile = await readTargetStateFile(adapter.descriptor.id);
    const isTakeover = !stateFile.state.activeProfileId;
    const targetPreview = await adapter.createPreview({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      state: stateFile.state,
      allowMatchingUnmanagedConfig: true,
      allowMatchingUnmanagedSkills: isTakeover,
      allowMatchingUnmanagedAssets: isTakeover,
      isolateSkillRoot: Boolean(skillRootTransition)
    });
    const profileErrors: string[] =
      skillRootInspection.kind === "invalid" ? [skillRootInspection.error] : [];
    const recoveryErrors = stateFile.state.recoveryRequired
      ? [
          `${adapter.descriptor.name} requires recovery before another Apply: ${stateFile.state.recoveryRequired.error}`
        ]
      : [];
    const portabilityErrors =
      targeted.omissions.length > 0 && effectivePayload.total === 0
        ? [`No portable Profile content can be applied to ${adapter.descriptor.name}`]
        : [];
    const unsupportedMcpErrors = (profile.assetPolicy.mcpRefs ?? []).flatMap((reference) => {
      const server = mcpLibrary.find((entry) => entry.id === reference.libraryId);
      if (!server) return [];
      if (!adapter.descriptor.capabilities.mcpTransports.includes(server.transport)) {
        return [`${adapter.descriptor.name} does not support ${server.transport} MCP server ${server.name}`];
      }
      if (
        adapter.descriptor.capabilities.mcpEnvironmentReferences === false &&
        server.transport === "stdio" &&
        Object.keys(server.env ?? {}).length > 0
      ) {
        return [
          `${adapter.descriptor.name} does not support safe environment references for MCP server ${server.name}`
        ];
      }
      return [];
    });
    const assetBackupPaths = await adapter.getAssetBackupPaths({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      allowMatchingUnmanagedSkills: isTakeover,
      allowMatchingUnmanagedAssets: isTakeover,
      isolateSkillRoot: Boolean(skillRootTransition)
    });
    if (skillRootTransition) {
      assetBackupPaths.push(skillRootTransition.path);
    }
    const legacySkillPaths = inventory
      .filter(
        (skill) =>
          skill.legacyLocation &&
          skill.status === "managed" &&
          skill.managedByTarget === true
      )
      .map((skill) => skill.path);
    assetBackupPaths.push(...legacySkillPaths);
    const affectedManagedPaths = new Set([
      ...targetPreview.changes.map((change) => change.path),
      ...assetBackupPaths
    ]);
    const drift = await findManagedDrift(
      stateFile.state,
      materializedProfile,
      targetPaths,
      affectedManagedPaths
    );
    const assetErrors = await adapter.validateAssets({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      allowMatchingUnmanagedSkills: isTakeover,
      allowMatchingUnmanagedAssets: isTakeover,
      replaceablePaths: drift.paths,
      isolateSkillRoot: Boolean(skillRootTransition)
    });
    const unmanagedWarnings = await unmanagedSkillWarnings(materializedProfile, inventory);
    const ignoredErrors = await ignoredSkillConflicts(materializedProfile, inventory);
    const withoutGenericExternalConflicts = (errors: string[]) =>
      errors.filter(
        (error) =>
          ![...externallyResolved.paths].some(
            (path) => error.includes(path) && error.includes("not AgentEnv-owned")
          )
      );
    const assetPlan = await planAssetResources(
      materializedProfile,
      targetPaths,
      assetBackupPaths,
      skillLibraryDir,
      skillRootTransition
    );
    const previewErrors = withoutGenericExternalConflicts(targetPreview.errors).concat(
      recoveryErrors,
      portabilityErrors,
      unsupportedMcpErrors,
      profileErrors,
      withoutGenericExternalConflicts(assetErrors),
      drift.errors,
      ignoredErrors,
      externallyResolved.errors,
      preparationPlan.errors,
      runtimeValidation.errors
    );
    const replaceableTargetPaths = [
      ...new Set(
        previewErrors
          .map(unmanagedSkillConflictPath)
          .filter((path): path is string => Boolean(path))
      )
    ];
    const preview: ActivationPreview = {
      id: randomUUID(),
      profileId: profile.id,
      profileContentHash,
      libraryVersions: collectLibraryResourceVersions(profile, skillLibrary, mcpLibrary),
      targetId: adapter.descriptor.id,
      createdAt: new Date().toISOString(),
      warnings: targeted.warnings.concat(
        disabledLibrarySkills.map(
          (id) => `Library Skill ${id} is globally disabled and will not be applied`
        ),
        targetPreview.warnings,
        runtimeValidation.warnings,
        drift.warnings,
        unmanagedWarnings,
        preparationPlan.warnings,
        externallyResolved.warnings,
        ...(skillRootTransition
          ? [
              `${adapter.descriptor.name} Skills folder is linked to ${skillRootTransition.resolvedPath}. Apply will preserve that directory and replace only the Agent root link with a private Skills folder.`
            ]
          : [])
      ),
      errors: previewErrors,
      changes: targetPreview.changes,
      resourceChanges: assetPlan.resourceChanges,
      replaceableTargetPaths,
      liveFingerprints: {
        ...targetPreview.liveFingerprints,
        [stateFile.path]: hashText(stateFile.content)
      },
      resourceFingerprints: {
        ...assetPlan.resourceFingerprints,
        ...preparationPlan.fingerprints
      },
      sourceFingerprints: assetPlan.sourceFingerprints,
      sharedSkillPreparations: preparationPlan.preparations,
      sharedSkillPreparationChanged:
        JSON.stringify(stateFile.state.sharedSkillPreparations ?? []) !==
        JSON.stringify(preparationPlan.preparations),
      targetStateChanged:
        JSON.stringify(stateFile.state.managedConfigKeys) !==
          JSON.stringify(targetPreview.targetState.managedConfigKeys) ||
        JSON.stringify(stateFile.state.managedMcpNames) !==
          JSON.stringify(targetPreview.targetState.managedMcpNames),
      targetState: targetPreview.targetState,
      effectivePayload,
      omissions: targeted.omissions,
      requiresOmissionAcknowledgement: targeted.omissions.length > 0,
      operation: isTakeover ? "takeover" : "apply",
      skillRootTransition,
      legacySkillPaths
    };
    previews.set(preview.id, preview);
    return publicPreview(preview);
  };

  const applyProfile = async (
    profileId: string,
    previewId: string,
    options: InternalApplyProfileOptions = {}
  ): Promise<ApplyResult> => {
    const preview = previews.get(previewId);
    if (!preview || preview.profileId !== profileId) {
      return { ok: false, errors: ["Preview not found for profile"] };
    }
    try {
      await targetScope.assertEnabled(preview.targetId);
    } catch (error) {
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
    const replaceableTargetPaths = new Set(preview.replaceableTargetPaths ?? []);
    const blockingErrors = preview.errors.filter((error) => {
      if (options.allowManagedDrift && error.startsWith(MANAGED_DRIFT_PREFIX)) {
        return false;
      }
      const path = unmanagedSkillConflictPath(error);
      return !(
        options.allowUnmanagedSkillReplacement &&
        path &&
        replaceableTargetPaths.has(path)
      );
    });
    if (blockingErrors.length > 0) {
      return { ok: false, errors: blockingErrors };
    }
    if (
      preview.operation !== "takeover" &&
      preview.changes.length === 0 &&
      preview.resourceChanges.length === 0 &&
      !preview.sharedSkillPreparationChanged &&
      !preview.targetStateChanged
    ) {
      return { ok: false, errors: ["No changes to apply"] };
    }
    if (preview.requiresOmissionAcknowledgement && !options.allowOmissions) {
      return {
        ok: false,
        errors: ["Compatibility omissions must be acknowledged before Apply"]
      };
    }
    if (activeTargetOperations.has(preview.targetId)) {
      return { ok: false, errors: [`Another operation is already running for ${preview.targetId}`] };
    }
    activeTargetOperations.add(preview.targetId);

    try {
    const sourceProfile = await profileStore.readProfile(profileId);
    const adapter = targetRegistry.get(preview.targetId);
    const [mcpLibrary, skillLibrary] = await Promise.all([
      mcpLibraryStore.listServers(),
      skillLibraryStore.listSkills()
    ]);
    const targetedProfile = targetProfile(
      sourceProfile,
      adapter,
      targetRegistry.get(sourceProfile.manifest.targetId)
    ).profile;
    const profile = applyLibrarySkillAvailability(
      targetedProfile,
      skillLibrary
    );
    const currentProfileHash =
      sourceProfile.targetContentHashes?.[preview.targetId] ?? createProfileContentHash(targetedProfile);
    if (currentProfileHash !== preview.profileContentHash) {
      return { ok: false, errors: ["Profile changed after preview; review the latest version"] };
    }
    const currentLibraryVersions = collectLibraryResourceVersions(
      profile,
      skillLibrary,
      mcpLibrary
    );
    if (!libraryResourceVersionsEqual(currentLibraryVersions, preview.libraryVersions)) {
      return { ok: false, errors: ["Library resources changed after preview; review the latest versions"] };
    }
    const targetPaths = adapter.createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    const currentSkillRoot = await inspectSkillRoot(targetPaths.skillsDir);
    if (
      !preview.skillRootTransition &&
      (currentSkillRoot.kind === "symlink" || currentSkillRoot.kind === "invalid")
    ) {
      return { ok: false, errors: ["Skills root changed after preview; review the latest version"] };
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
    const inventory = await skillLibraryStore.scanInventory(
      [inventoryTargetPaths],
      skillLibrary
    );
    const currentLegacySkillPaths = inventory
      .filter(
        (skill) =>
          skill.legacyLocation &&
          skill.status === "managed" &&
          skill.managedByTarget === true
      )
      .map((skill) => skill.path)
      .sort();
    if (
      JSON.stringify(currentLegacySkillPaths) !==
      JSON.stringify([...(preview.legacySkillPaths ?? [])].sort())
    ) {
      return { ok: false, errors: ["Legacy Skill locations changed after preview"] };
    }
    const preparationPlan = await sharedSkillPreparationPlan(
      profile,
      targetPaths,
      currentProfileHash,
      skillLibrary,
      inventory
    );
    if (
      JSON.stringify(preparationPlan.preparations) !==
      JSON.stringify(preview.sharedSkillPreparations ?? [])
    ) {
      return { ok: false, errors: ["Shared Skill migration state changed after preview"] };
    }
    const externallyResolved = await resolveExternalSkills(
      preparationPlan.runtimeProfile,
      inventory,
      skillLibrary
    );
    if (externallyResolved.errors.length > 0) {
      return { ok: false, errors: externallyResolved.errors };
    }
    const materializedProfile = adapter.materializeMcpRefs(
      externallyResolved.profile,
      mcpLibrary
    );
    const settings = await settingsStore.readSettings();
    const skillLibraryDir = resolveSkillsLibraryDir(paths, settings);
    const isTakeover = preview.operation === "takeover";
    const runtimeValidation = await validateRuntimeSkills(
      adapter,
      targetPaths,
      materializedProfile,
      skillLibrary,
      inventory
    );
    if (runtimeValidation.errors.length > 0) {
      return { ok: false, errors: runtimeValidation.errors };
    }
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

    const statePath = statePathFor(preview.targetId);
    const assetBackupPaths = await adapter.getAssetBackupPaths({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      allowMatchingUnmanagedSkills: isTakeover,
      allowMatchingUnmanagedAssets: isTakeover,
      isolateSkillRoot: Boolean(preview.skillRootTransition)
    });
    if (preview.skillRootTransition) {
      assetBackupPaths.push(preview.skillRootTransition.path);
    }
    assetBackupPaths.push(...(preview.legacySkillPaths ?? []));
    const affectedManagedPaths = new Set([
      ...preview.changes.map((change) => change.path),
      ...assetBackupPaths
    ]);
    const currentStateFile = await readTargetStateFile(preview.targetId);
    const currentDrift = await findManagedDrift(
      currentStateFile.state,
      materializedProfile,
      targetPaths,
      affectedManagedPaths
    );
    const replaceablePaths = new Set<string>([
      ...(options.allowManagedDrift ? currentDrift.paths : []),
      ...(options.allowUnmanagedSkillReplacement ? replaceableTargetPaths : [])
    ]);

    const assetErrors = await adapter.validateAssets({
      profile: materializedProfile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: settings.skillSyncMethod,
      allowMatchingUnmanagedSkills: isTakeover,
      allowMatchingUnmanagedAssets: isTakeover,
      replaceablePaths,
      isolateSkillRoot: Boolean(preview.skillRootTransition)
    });
    if (assetErrors.length > 0) {
      return { ok: false, errors: assetErrors };
    }

    const backup = await backupStore.createBackup(
      [...new Set([
        ...preview.changes.map((change) => change.path),
        ...assetBackupPaths,
        ...(options.additionalBackupPaths ?? []),
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
        await writeAtomic(change.path, change.after);
      }

      if (preview.skillRootTransition) {
        await isolateSkillRoot(preview.skillRootTransition);
      }
      if (preview.resourceChanges.length > 0) {
        await adapter.applyAssets({
          profile: materializedProfile,
          targetPaths,
          skillLibraryDir,
          skillSyncMethod: settings.skillSyncMethod,
          allowMatchingUnmanagedSkills: isTakeover,
          allowMatchingUnmanagedAssets: isTakeover,
          replaceablePaths,
          isolateSkillRoot: Boolean(preview.skillRootTransition)
        });
      }
      for (const legacyPath of preview.legacySkillPaths ?? []) {
        await removeSkillDeployment(legacyPath);
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
        : assetBackupPaths;
      const managedResources = await snapshotManagedResources(
        [...preview.changes.map((change) => change.path), ...managedAssetPaths],
        targetPaths
      );
      for (const resource of managedResources) {
        if ((await hashPath(resource.path)) !== resource.contentHash) {
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
        sharedSkillPreparations: preparationPlan.preparations,
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
          errors: [
            `Recovery required for backup ${backup.id}: ${recoveryError}`
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
      const [skillLibrary, mcpLibrary] = await Promise.all([
        skillLibraryStore.listSkills(),
        mcpLibraryStore.listServers()
      ]);
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
        const targetPaths = adapter.createTargetPaths({
          homeDir: paths.homeDir,
          fakeHomeRoot: paths.fakeHomeRoot
        });
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
          JSON.stringify([...preparation.sharedPaths].map((path) => resolve(path)).sort()) !==
          JSON.stringify(normalizedSharedPaths)
        ) {
          throw new Error(`${adapter.descriptor.name} was prepared for a different shared copy.`);
        }

        const sourceProfile = await profileStore.readProfile(stateFile.state.activeProfileId);
        const targetedProfile = targetProfile(
          sourceProfile,
          adapter,
          targetRegistry.get(sourceProfile.manifest.targetId)
        ).profile;
        const effectiveProfile = applyLibrarySkillAvailability(targetedProfile, skillLibrary);
        const expectedReference = effectiveProfile.assetPolicy.skillRefs.find(
          (reference) => reference.libraryId === libraryId && reference.enabled !== false
        );
        const currentProfileHash =
          sourceProfile.targetContentHashes?.[targetId] ??
          createProfileContentHash(targetedProfile);
        const currentLibraryVersions = collectLibraryResourceVersions(
          effectiveProfile,
          skillLibrary,
          mcpLibrary
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
          await rm(sharedPath, { recursive: true, force: true });
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
            await removeSkillDeployment(context.targetPath);
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
    if (profile.manifest.targetId !== targetId) {
      throw new Error("Live changes can only be adopted into a Profile with the same native Agent format");
    }
    if (activeTargetOperations.has(targetId)) {
      throw new Error(`Another ${targetId} operation is already running`);
    }
    activeTargetOperations.add(targetId);
    try {
      const adapter = targetRegistry.get(targetId);
      const targetPaths = adapter.createTargetPaths({
        homeDir: paths.homeDir,
        fakeHomeRoot: paths.fakeHomeRoot
      });
      const captured = await adapter.captureProfile(targetPaths);
      const adopted: AdoptTargetChangesResult["adopted"] = [];
      const skipped = [...captured.excluded];
      let instructions = profile.instructions;
      let configText = profile.configText;
      let assetPolicy = profile.assetPolicy;

      if (captured.instructions !== profile.instructions) {
        instructions = captured.instructions;
        adopted.push("instructions");
      }
      if (captured.configText !== profile.configText) {
        configText = captured.configText;
        adopted.push("config");
      }

      if (adapter.descriptor.capabilities.disabledSkillPaths) {
        const previous = JSON.stringify(profile.assetPolicy.disabledSkillPaths);
        const next = JSON.stringify(captured.disabledSkillPaths);
        if (previous !== next) {
          assetPolicy = { ...assetPolicy, disabledSkillPaths: captured.disabledSkillPaths };
          adopted.push("disabled-skills");
        }
      }

      const otherTargetMcpSelections = (
        profile.assetPolicy.mcpSelections ?? []
      ).filter((selection) => selection.targetId !== targetId);
      const capturedMcpSelections = (captured.mcpConnections ?? []).map(
        (connection) => ({
          targetId,
          name: connection.name,
          enabled: connection.enabled
        })
      );
      const previousTargetMcpSelections = (
        profile.assetPolicy.mcpSelections ?? []
      ).filter((selection) => selection.targetId === targetId);
      if (
        JSON.stringify(capturedMcpSelections) !==
        JSON.stringify(previousTargetMcpSelections)
      ) {
        assetPolicy = {
          ...assetPolicy,
          mcpRefs: [],
          mcpSelections: [...otherTargetMcpSelections, ...capturedMcpSelections]
        };
        adopted.push("mcp");
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
        configText,
        assetPolicy
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
