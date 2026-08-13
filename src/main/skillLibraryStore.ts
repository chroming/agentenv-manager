import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type {
  AgentEnvSettings,
  GitHubSkillCandidate,
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  RepositorySkillImportInput,
  RepositorySkillImportResult,
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  ProjectSkillScanResult,
  SkillCleanupBackupSummary,
  SkillCleanupResult,
  SkillAvailabilityInput,
  SkillInventoryEntry,
  SkillImportConflict,
  SkillImportInput,
  SkillImportPreview,
  SkillImportPreviewInput,
  SkillImportSnapshot,
  SkillIconInput,
  SkillLibraryEntry,
  SkillMergeInput,
  SkillMergePreview,
  SkillMergeResult,
  ManagedBackupFile,
  SkillProvenance,
  ResourceIconKey,
  SkillSourceType,
  SkillUpstream,
  SkillUpdateInfo,
  SkillUpdateConfirmation,
  SkillUpdateImpact,
  SkillUpdatePolicy,
  SkillUpdatePolicyInput,
  SkillUpdatePlan,
  SkillUpdatePreviewBatchResult,
  SkillUpdateSettingsInput,
  SkillUpdateSourceInput,
  SkillCollectionMemberDecision,
  SkillCollectionMemberDecisionUpdate,
  SkillRuntimeSnapshot,
  SkillRuntimeIssue,
  SkillSourceCheckAllResult,
  SkillSourceCollectionRef,
  SkillSourceGroupView,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillSourceScope,
  TargetPaths,
  UnmanagedSkillEntry,
  UnmanagedSkillLocation,
  UnmanagedSkillLocationUpdate,
  SharedSkillRetentionInput
} from "../shared/types";
import { normalizeSkillKey } from "../shared/skillIdentity";
import { buildSkillCleanupGroups } from "../shared/skillCleanup";
import { managedResourceOrigin } from "../shared/managedResource";
import { pathEntryExists, pathExists, replacePathAtomically, writeAtomic } from "./fileUtils";
import {
  legacyOwnerMarkerPathsFor,
  markerPathFor,
  markerPathForFile
} from "./ownershipMarkers";
import type { AgentEnvPaths } from "./paths";
import type { ProfileStore } from "./profileStore";
import { DEFAULT_SETTINGS, resolveSkillsLibraryDir, type SettingsStore } from "./settingsStore";
import { parseSkillFrontmatter } from "./skillFrontmatter";
import { inspectSkillsCliLocks } from "./skillsCliInspector";
import { removeSkillDeployment } from "./skillDeployment";
import { createSkillLibraryTargetDeployer } from "./skillLibraryTargetDeployment";
import { createTargetRegistry } from "./targets/registry";
import { createTargetStateRepository } from "./targetStateRepository";
import {
  createManagedSkillResource,
  readManagedSkillResourcesByTarget,
  readTargetStateFiles,
  updateConsolidatedSkillTargetStates,
  updateMergedSkillTargetStates,
  upsertManagedSkillResource
} from "./skillLibraryTargetReceipts";
import { targetPathInputFor } from "./targets/pathInput";
import { createFilesystemSkillDriver } from "./targets/shared/skillRuntime";
import { applyLibraryUpdatePropagation, prepareLibraryUpdatePropagation } from "./skillLibraryUpdatePropagation";
import { createLibraryUpdateBackup as createLibraryUpdateBackupTransaction } from "./skillLibraryUpdateBackup";
import type { GitCliSkillSource } from "./skillSources/contract";
import { RepositorySkillSourceMissingError } from "./skillSources/gitCliSource";
import { parseRepositoryLocation } from "./skillSources/repositoryLocation";
import {
  boundedSkillFiles,
  commonSkillDirectory,
  indexedSkillFiles
} from "./skillSources/skillIndexManifest";
import { readAllProfilesForResourceMutation } from "./profileSafety";
import { createSkillChanges, createSkillChangeSet } from "./skillFileChanges";
import { hashSkillContent, SKILL_CONTENT_HASH_VERSION } from "./skillContentHash";
import { removeUnavailableSkillLinksTransaction } from "./skillUnavailableCleanup";
import { createBackupStore } from "./backupStore";
import { BackupRecoveryError } from "./backupRestore";
import {
  copyPathVerified,
  hashPathEntry
} from "./filesystemIntegrity";
import {
  createSkillCleanupBackupStore,
  type SkillCleanupBackupManifest,
  type SkillCleanupRecoveryResult
} from "./skillCleanupBackupStore";
import {
  createLibrarySkillSourceService,
  createGitHubSourceScope,
  createSkillSourceGroupStore,
  githubCandidateStatus,
  normalizeRepositorySkillScan,
  resolveSkillSourceCollection,
  validateGitHubImportCollection,
  validateRepositoryImportCollection
} from "./skillSourceLibrary";
import { readSkillLibraryEntry, type SkillMetadataFile } from "./skillLibraryMetadata";
import { bindSkillSourceCollection, createSkillSourceRegistry } from "./skillSourceRegistry";
import {
  createLocalSkillSourceCollection,
  createSingleSkillSourceCollection,
  validateLocalSkillSourceCollection
} from "./skillSourceScope";
import { createSkillSourceMergeService } from "./skillSourceMergeService";
import { githubContentsRevision } from "./skillSources/revisionCompatibility";
import { scanProjectSkillRoots } from "./projectSkillDiscovery";
import { createRemovedSourceSkillUpdatePlan } from "./skillUpdatePlans";
import {
  createGitHubSkillClient,
  encodeGitHubPath,
  githubSkillSourceUrl,
  mapWithConcurrency,
  parseGitHubSkillUrl,
  skillIdFrom,
  type GitHubCommitResponse,
  type GitHubFetch,
  type GitHubTreeResponse,
  type ParsedGitHubSkillSource
} from "./githubSkillClient";
import { isPathInside, pathsEqual } from "./platformPaths";
import { mergeInventoryLocation } from "./skillInventoryLocation";
import { resolveSkillInventoryLibraryMatch } from "./skillInventoryLibraryMatch";
import {
  findManagedSkillInstallPaths,
  scanUnmanagedSkillInventory
} from "./skillInventoryQueries";
import { canPreserveLegacySkillTopology, legacyOwnedLibraryId,
  legacySkillOwnershipMigrationReady, protectedLegacySkillMarkerPaths } from "./skillLegacyOwnershipMigration";
import { createSkillPolicyStore } from "./skillPolicyStore";
import { createSharedSkillAreaStore } from "./sharedSkillAreaStore";
import { createSharedSkillInventoryOwnership, managedSharedSkillReceipt } from "./sharedSkillAreaInventory";
import { createGitHubSkillTreeMaterializer } from "./githubSkillTreeMaterializer";
import { backupSharedSkillAreaState } from "./sharedSkillAreaBackup";
import {
  createRecentSkillUpdateCheckStore,
  createSkillUpdatePreviewStore
} from "./skillUpdatePreviewStore";
import type {
  ConsolidateSharedSkillGroupStoreInput,
  ConsolidateSkillGroupStoreInput,
  DeployLibrarySkillStoreInput,
  ImportSkillStoreInput,
  ManageTargetSkillStoreInput,
  RemoveUnavailableSkillLinksStoreInput,
  SkillLibraryStore
} from "./skillLibraryStoreTypes";
export type {
  ConsolidateSharedSkillGroupStoreInput,
  ConsolidateSkillGroupStoreInput,
  DeployLibrarySkillStoreInput,
  ImportSkillStoreInput,
  ManageTargetSkillStoreInput,
  RemoveUnavailableSkillLinksStoreInput,
  SkillLibraryStore
} from "./skillLibraryStoreTypes";

interface SkillLibraryStoreOptions {
  authTokenProvider?: () => Promise<string | undefined>;
  fetch?: GitHubFetch;
  skillsCliLockPaths?: string[];
  profileStore?: Pick<ProfileStore, "listProfiles" | "readProfile" | "saveProfile">;
  targetPathsProvider?: () => TargetPaths[] | Promise<TargetPaths[]>;
  runtimeSnapshotProvider?: (targetPaths: TargetPaths) => Promise<SkillRuntimeSnapshot>;
  repositorySource?: GitCliSkillSource;
}

const updatePolicyFor = (metadata: SkillMetadataFile): SkillUpdatePolicy => {
  if (metadata.updatePolicy === "tracked" || metadata.updatePolicy === "untracked") {
    return metadata.updatePolicy;
  }
  if (typeof metadata.updateCheckEnabled === "boolean") {
    return metadata.updateCheckEnabled ? "tracked" : "untracked";
  }
  return metadata.sourceType === "github" || metadata.sourceType === "git"
    ? "tracked"
    : "untracked";
};

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

export { normalizeSkillKey } from "../shared/skillIdentity";

const readJsonIfExists = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
};

const computeContentHash = hashSkillContent;

const validateSkillFrontmatter = async (skillDir: string) => {
  const frontmatter = parseSkillFrontmatter(await readFile(join(skillDir, "SKILL.md"), "utf8"));
  if (frontmatter.errors.length > 0) {
    throw new Error(`Skill frontmatter is invalid: ${frontmatter.errors.join("; ")}`);
  }
  return frontmatter;
};

interface RemoveAndCopyOptions {
  expectMissing?: boolean;
  prepareStaging?: (stagingPath: string) => Promise<void>;
}

const removeAndCopy = async (
  source: string,
  destination: string,
  options: RemoveAndCopyOptions = {}
) => {
  await replacePathAtomically(destination, async (stagingPath) => {
    await cp(source, stagingPath, { recursive: true, dereference: true });
    await rm(join(stagingPath, ".agentenv-owner.json"), { force: true });
    await options.prepareStaging?.(stagingPath);
  }, options.expectMissing ? { expectedTargetHash: undefined } : {});
};

export const createSkillLibraryStore = (
  paths: AgentEnvPaths,
  settingsStore?: Pick<SettingsStore, "readSettings">,
  options: SkillLibraryStoreOptions = {}
): SkillLibraryStore => {
  const readSettings = () => settingsStore?.readSettings() ?? Promise.resolve(DEFAULT_SETTINGS);
  const libraryDir = async () => resolveSkillsLibraryDir(paths, await readSettings());
  const fetchImpl = options.fetch ?? fetch;
  const authTokenProvider = options.authTokenProvider;
  const profileStore = options.profileStore;
  const repositorySource = options.repositorySource;
  const requireRepositorySource = () => {
    if (!repositorySource) {
      throw new Error("System Git is unavailable. Install Git and retry the Repository operation.");
    }
    return repositorySource;
  };
  const targetPathsProvider = options.targetPathsProvider ?? (async () => {
    const settings = await readSettings();
    return createTargetRegistry().listAdapters().map((adapter) =>
      adapter.createTargetPaths(targetPathInputFor(paths, settings, adapter.descriptor.id))
    );
  });
  const runtimeSnapshotProvider = options.runtimeSnapshotProvider ?? ((targetPaths) =>
    createFilesystemSkillDriver({ targetId: targetPaths.targetId }).inspectRuntime(targetPaths));
  const targetStateRepository = createTargetStateRepository(paths);
  const pendingUpdates = createSkillUpdatePreviewStore();
  const safetyBackupStore = createBackupStore(paths);
  const {
    cleanupBackupRoot,
    writeCleanupManifest,
    copyCleanupEntry,
    snapshotCleanupPaths,
    createCleanupPathClaimer,
    setCleanupStatus,
    readCleanupBackup,
    listCleanupBackups,
    previewCleanupBackup,
    recoverInterruptedCleanupBackups,
    listPendingCleanupRecoveries,
    restoreCleanupBackupSafely,
    failAfterCleanupRollback
  } = createSkillCleanupBackupStore({
    paths,
    resolveLibraryDir: libraryDir,
    targetPathsProvider
  });
  const createLibraryUpdateBackup = (
    libraryId: string,
    targetLibraryDir: string,
    copiedInstallPaths: string[] = [],
    statePaths: string[] = []
  ) => createLibraryUpdateBackupTransaction({
    libraryId,
    targetLibraryDir,
    copiedInstallPaths,
    statePaths,
    cleanupBackupRoot,
    copyCleanupEntry,
    snapshotCleanupPaths,
    writeCleanupManifest
  });
  const recentUpdateChecks = createRecentSkillUpdateCheckStore();
  const {
    fetchJson: fetchGitHubJson,
    fetchText: fetchGitHubText,
    resolveLocation: resolveGitHubLocation,
    readTree: readGitHubTree,
    readSkillUpdatedAt: readGitHubSkillUpdatedAt
  } = createGitHubSkillClient({ fetchImpl, authTokenProvider });
  const materializeGitHubSkillTree = createGitHubSkillTreeMaterializer({
    readTree: readGitHubTree, repositorySource, copySkillTree: removeAndCopy });
  const skillSourceRegistry = createSkillSourceRegistry(paths.skillSourcesPath);
  const skillSourceService = createLibrarySkillSourceService(
    paths.skillSourceObservationsDir,
    repositorySource
  );
  const skillPolicyStore = createSkillPolicyStore(paths);
  const sharedSkillAreaStore = createSharedSkillAreaStore(paths);

  const metadataHash = (metadata: SkillMetadataFile) =>
    createHash("sha256").update(JSON.stringify(metadata)).digest("hex");

  const discardPendingUpdate = pendingUpdates.discard;
  const discardPendingUpdatesForSkill = pendingUpdates.discardForSkill;
  const discardExpiredPendingUpdates = pendingUpdates.discardExpired;

  const migrateLegacySkillPolicies = skillPolicyStore.migrateLegacy;
  const readUnmanagedSkillLocations =
    skillPolicyStore.readUnmanagedLocations;
  const findUnmanagedSkillLocation =
    skillPolicyStore.findUnmanagedLocation;
  const setUnmanagedSkillLocations =
    skillPolicyStore.setUnmanagedLocations;
  const readSkillCollectionDecisions =
    skillPolicyStore.readCollectionDecisions;
  const findSkillCollectionDecision =
    skillPolicyStore.findCollectionDecision;
  const setSkillCollectionDecision =
    skillPolicyStore.setCollectionDecision;
  const setSharedSkillRetention = async (input: SharedSkillRetentionInput) => {
    await skillPolicyStore.setSharedRetention(input);
    if (input.retained) await sharedSkillAreaStore.removeManaged(input.paths);
  };

  const entryFor = (id: string, skillDir: string) =>
    readSkillLibraryEntry(id, skillDir, skillSourceRegistry);

  const normalizedSkillName = (name: string) => name.normalize("NFKC").trim().toLowerCase();

  const snapshotForDirectory = async (
    id: string,
    skillDir: string,
    source: Pick<SkillImportSnapshot, "sourceType" | "source" | "upstream">
  ): Promise<SkillImportSnapshot> => {
    const frontmatter = await validateSkillFrontmatter(skillDir);
    const skillStats = await stat(join(skillDir, "SKILL.md"));
    return {
      id,
      name: frontmatter.name || id,
      description: frontmatter.description,
      version: frontmatter.version,
      versionSource: frontmatter.versionSource,
      contentHash: await computeContentHash(skillDir),
      modifiedAt: skillStats.mtime.toISOString(),
      ...source,
      skillMarkdown: await readFile(join(skillDir, "SKILL.md"), "utf8")
    };
  };

  const previewDirectoryImport = async (
    source: SkillImportPreviewInput,
    sourceDir: string,
    requestedId: string,
    sourceDetails: Pick<SkillImportSnapshot, "sourceType" | "source" | "upstream">
  ): Promise<SkillImportPreview> => {
    const safeRequestedId = SafeIdSchema.parse(requestedId);
    const incoming = await snapshotForDirectory(safeRequestedId, sourceDir, sourceDetails);
    const skills = await listSkills();
    const normalizedIncomingName = normalizedSkillName(incoming.name);
    const matchingSkills = skills.filter(
      (skill) =>
        normalizedSkillName(skill.name) === normalizedIncomingName || skill.id === safeRequestedId
    );
    const occupiedIds = new Set(skills.map((skill) => skill.id));
    let suggestedDuplicateId = safeRequestedId;
    for (let suffix = 2; occupiedIds.has(suggestedDuplicateId); suffix += 1) {
      suggestedDuplicateId = `${safeRequestedId}-${suffix}`;
    }
    const conflicts: SkillImportConflict[] = await Promise.all(
      matchingSkills.map(async (skill) => {
        const existing = await snapshotForDirectory(
          skill.id,
          skill.path,
          {
            sourceType: skill.sourceType,
            source: skill.source ?? skill.path,
            upstream: skill.upstream
          }
        );
        const contentIdentical = existing.contentHash === incoming.contentHash;
        const normalizedSource = (value: string) => value.trim().replace(/\/+$/, "");
        const onlineSourceKey = (snapshot: SkillImportSnapshot) =>
          [
            snapshot.sourceType,
            normalizedSource(snapshot.source),
            snapshot.upstream?.ref ?? "",
            snapshot.upstream?.subpath ?? ""
          ].join("\0");
        const sourceUpdateAvailable =
          contentIdentical &&
          (incoming.sourceType === "github" || incoming.sourceType === "git") &&
          onlineSourceKey(existing) !== onlineSourceKey(incoming);
        const identical = contentIdentical && !sourceUpdateAvailable;
        const nameMatches = normalizedSkillName(skill.name) === normalizedIncomingName;
        const idMatches = skill.id === safeRequestedId;
        return {
          existing,
          match: nameMatches && idMatches ? "name-and-id" : nameMatches ? "name" : "id",
          contentIdentical,
          sourceUpdateAvailable,
          identical,
          changes: contentIdentical ? [] : await createSkillChanges(skill.path, sourceDir)
        };
      })
    );
    return { source, incoming, conflicts, suggestedDuplicateId };
  };

  const previewImport = async (source: SkillImportPreviewInput): Promise<SkillImportPreview> => {
    if (source.kind === "local") {
      const sourceDir = resolve(source.input.sourcePath);
      if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
        throw new Error(`Skill source is missing SKILL.md: ${sourceDir}`);
      }
      return previewDirectoryImport(
        source,
        sourceDir,
        source.input.id ?? basename(sourceDir),
        source.input.upstream?.kind === "github"
          ? (() => {
              const githubSource = parseGitHubSkillUrl(source.input.upstream!.locator, {
                ref: source.input.upstream!.ref,
                remotePath: source.input.upstream!.subpath
              });
              return {
                sourceType: "github" as const,
                source: githubSource.sourceUrl,
                upstream: source.input.upstream
              };
            })()
          : {
              sourceType: "local",
              source: source.input.upstream?.kind === "local"
                ? source.input.upstream.locator
                : sourceDir,
              upstream: source.input.upstream ?? { kind: "local", locator: sourceDir }
            }
      );
    }

    if (source.kind === "repository") {
      const tempDir = await mkdtemp(join(tmpdir(), "agentenv-repository-skill-preview-"));
      try {
        const materialized = await requireRepositorySource().materialize(
          source.input,
          tempDir,
          undefined,
          { refresh: false }
        );
        const frontmatter = await validateSkillFrontmatter(tempDir);
        const requestedId =
          source.input.id ??
          normalizeSkillKey(frontmatter.name || basename(materialized.directory) || "skill");
        return await previewDirectoryImport(source, tempDir, requestedId, {
          sourceType: "git",
          source: materialized.repository,
          upstream: materialized.upstream
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    const parsedSource = parseGitHubSkillUrl(source.input.url, {
      ref: source.input.ref,
      remotePath: source.input.remotePath
    });
    const tempDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-preview-"));
    try {
      const [{ hasSkillMd, revision }, sourceUpdatedAt] = await Promise.all([
        materializeGitHubSkillTree(parsedSource, tempDir, { refreshFiles: true }),
        readGitHubSkillUpdatedAt(parsedSource)
      ]);
      if (!hasSkillMd) {
        throw new Error(`GitHub skill source is missing SKILL.md: ${source.input.url}`);
      }
      return await previewDirectoryImport(
        source,
        tempDir,
        source.input.id ?? parsedSource.defaultId,
        {
          sourceType: "github",
          source: parsedSource.sourceUrl,
          upstream: {
            kind: "github",
            locator: parsedSource.sourceUrl,
            ref: parsedSource.ref,
            subpath: parsedSource.remotePath,
            revision,
            updatedAt: sourceUpdatedAt
          }
        }
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };

  const readLibraryMetadata = async (skillDir: string) =>
    (await readJsonIfExists<SkillMetadataFile>(join(skillDir, ".agentenv-skill.json"))) ?? {};

  const writeMetadata = async (
    skillDir: string,
    metadata: Pick<
      SkillMetadataFile,
      | "sourceType"
      | "source"
      | "remoteRef"
      | "remotePath"
      | "remoteRevision"
      | "updatePolicy"
      | "updateCheckEnabled"
      | "globallyEnabled"
      | "upstream"
      | "provenance"
    > & {
      iconKey?: ResourceIconKey | null;
      sourceCollection?: SkillSourceCollectionRef | null;
    }
  ) => {
    const current = await readLibraryMetadata(skillDir);
    const sourceType = metadata.sourceType ?? "local";
    const contentHash = await computeContentHash(skillDir);
    const sourceCollection = await bindSkillSourceCollection(
      skillSourceRegistry,
      resolveSkillSourceCollection(metadata.sourceCollection, current.sourceCollection)
    );
    await writeAtomic(
      join(skillDir, ".agentenv-skill.json"),
      `${JSON.stringify(
        {
          sourceType,
          source: metadata.source,
          remoteRef: metadata.remoteRef,
          remotePath: metadata.remotePath,
          remoteRevision: metadata.remoteRevision,
          upstream: metadata.upstream ?? current.upstream,
          provenance: metadata.provenance ?? current.provenance,
          sourceCollection,
          iconKey: metadata.iconKey === null ? undefined : metadata.iconKey ?? current.iconKey,
          globallyEnabled: metadata.globallyEnabled ?? current.globallyEnabled ?? true,
          updatePolicy:
            metadata.updatePolicy ??
            (typeof metadata.updateCheckEnabled === "boolean"
              ? metadata.updateCheckEnabled
                ? "tracked"
                : "untracked"
              : Object.keys(current).length > 0
                ? updatePolicyFor(current)
                : sourceType === "github" || sourceType === "git"
                  ? "tracked"
                  : "untracked"),
          updateCheckEnabled:
            (metadata.updatePolicy ??
              (typeof metadata.updateCheckEnabled === "boolean"
                ? metadata.updateCheckEnabled
                  ? "tracked"
                  : "untracked"
                : Object.keys(current).length > 0
                  ? updatePolicyFor(current)
                  : sourceType === "github" || sourceType === "git"
                    ? "tracked"
                    : "untracked")) === "tracked",
          contentHash,
          contentHashVersion: SKILL_CONTENT_HASH_VERSION,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`
    );
  };

  const listSkills = async () => {
    let entries;
    const root = await libraryDir();
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry): Promise<SkillLibraryEntry | undefined> => {
          const skillDir = join(root, entry.name);
          try {
            return await entryFor(entry.name, skillDir);
          } catch (error) {
            if (isMissingFileError(error)) {
              return undefined;
            }
            throw error;
          }
        })
    );

    return skills
      .filter((skill): skill is SkillLibraryEntry => Boolean(skill))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const scanGitHubSkills = async (rawUrl: string): Promise<GitHubSkillScanResult> => {
    const source = await resolveGitHubLocation(rawUrl, { refresh: true });
    const treeUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(source.treeSha)}?recursive=1`;
    const treeResponse = await fetchGitHubJson(treeUrl, { refresh: true }) as GitHubTreeResponse;
    const treeItems = (treeResponse.tree ?? []).filter(
      (item): item is { path: string; type: string; sha: string; mode?: string } =>
        typeof item.path === "string" &&
        typeof item.type === "string" &&
        typeof item.sha === "string"
    );
    const allSkillFiles = treeItems
      .filter(
        (item) =>
          item.type === "blob" &&
          (item.path === "SKILL.md" || item.path.endsWith("/SKILL.md"))
      )
      .sort((a, b) => a.path.localeCompare(b.path));
    const scopedSkillFiles = allSkillFiles.filter(
      (item) =>
        !source.rootPath ||
        item.path === `${source.rootPath}/SKILL.md` ||
        item.path.startsWith(`${source.rootPath}/`)
    );
    const manifestPath = source.rootPath ? `${source.rootPath}/llms.txt` : "llms.txt";
    const manifestEntry = treeItems.find(
      (item) => item.type === "blob" && item.path === manifestPath
    );
    let indexedPaths: string[] = [];
    if (manifestEntry) {
      const manifestUrl = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${encodeURIComponent(source.ref)}/${encodeGitHubPath(manifestPath)}`;
      indexedPaths = indexedSkillFiles(
        await fetchGitHubText(manifestUrl, { refresh: true }),
        source.rootPath,
        new Set(allSkillFiles.map((item) => item.path))
      );
    }
    const usesManifest = Boolean(manifestEntry && indexedPaths.length > 0);
    const discoveredPaths = usesManifest
      ? indexedPaths
      : scopedSkillFiles.map((item) => item.path);
    const effectiveRootPath = usesManifest
      ? commonSkillDirectory(discoveredPaths, source.rootPath)
      : source.rootPath;
    const selectedSkillPaths = boundedSkillFiles(
      discoveredPaths,
      effectiveRootPath,
      !usesManifest
    );
    const selectedSkillPathSet = new Set(selectedSkillPaths);
    const discoveredSkillFiles = allSkillFiles.filter((item) =>
      selectedSkillPathSet.has(item.path)
    );
    const effectiveSource = { ...source, rootPath: effectiveRootPath };
    const sourceScope = {
      ...createGitHubSourceScope(rawUrl, effectiveSource),
      ...(usesManifest
        ? {
            canonicalLink: rawUrl.trim().replace(/\/+$/, ""),
            indexManifestPath: manifestPath
          }
        : {})
    };
    const existingSkills = await listSkills();
    const revisionEntries = treeItems
      .filter((item): item is { path: string; type: "blob" | "tree"; sha: string; mode?: string } =>
        item.type === "blob" || item.type === "tree");
    const candidates = await mapWithConcurrency(
      discoveredSkillFiles.slice(0, 500),
      8,
      async (skillFile): Promise<GitHubSkillCandidate> => {
      const remotePath = dirname(skillFile.path) === "." ? "" : dirname(skillFile.path);
      const sourceUrl = githubSkillSourceUrl(
        source.owner,
        source.repo,
        source.ref,
        remotePath
      );
      const rawSkillUrl = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${encodeURIComponent(source.ref)}/${encodeGitHubPath(skillFile.path)}`;
      const content = await fetchGitHubText(rawSkillUrl, { refresh: true });
      const revision = githubContentsRevision(remotePath, revisionEntries);
      const treeRevision = remotePath
        ? revisionEntries.find((item) => item.type === "tree" && item.path === remotePath)?.sha
        : source.treeSha;
      const existingSource = existingSkills.find(
        (skill) => skill.source?.replace(/\/$/, "") === sourceUrl.replace(/\/$/, "")
      );
      const duplicate = existingSkills.find(
        (skill) => !existingSource && skill.remoteRevision === revision
      );
      const pathName = remotePath.split("/").filter(Boolean).at(-1) ?? source.repo;
      const baseId = skillIdFrom(pathName);
      const id = existingSource?.id ?? duplicate?.id ?? baseId;
      const frontmatter = parseSkillFrontmatter(content);
      return {
        id,
        name: frontmatter.name || pathName,
        description: frontmatter.description,
        version: frontmatter.version,
        remotePath,
        sourceUrl,
        ref: source.ref,
        revision,
        compatibleRevisions:
          treeRevision && treeRevision !== revision ? [treeRevision] : [],
        status: githubCandidateStatus(
          frontmatter.errors,
          Boolean(existingSource),
          Boolean(duplicate)
        ),
        existingLibraryId: existingSource?.id ?? duplicate?.id,
        error: frontmatter.errors.length > 0 ? frontmatter.errors.join("; ") : undefined
      };
    });

    const result: GitHubSkillScanResult = {
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      rootPath: effectiveRootPath,
      sourceScope,
      ...(usesManifest
        ? {
            indexManifest: {
              path: manifestPath,
              requestedDirectory: source.rootPath,
              resolvedDirectory: effectiveRootPath
            }
          }
        : {}),
      truncated: Boolean(treeResponse.truncated) || discoveredSkillFiles.length > 500,
      candidates
    };
    await skillSourceService.recordGitHubScan(sourceScope, result);
    return result;
  };

  const scanInventory = async (
    targetPaths: TargetPaths[],
    knownLibrarySkills?: SkillLibraryEntry[],
    onIssues?: (issues: SkillRuntimeIssue[]) => void
  ): Promise<SkillInventoryEntry[]> => {
    const librarySkills = knownLibrarySkills ?? await listSkills();
    const libraryIds = new Set(librarySkills.map((skill) => skill.id));
    const libraryById = new Map(librarySkills.map((skill) => [skill.id, skill]));
    const libraryBySkillKey = new Map<string, SkillLibraryEntry[]>();
    for (const skill of librarySkills) {
      const key = normalizeSkillKey(skill.name || skill.id);
      libraryBySkillKey.set(key, [...(libraryBySkillKey.get(key) ?? []), skill]);
    }
    const skillsCliEvidence = (
      await inspectSkillsCliLocks(paths.homeDir, options.skillsCliLockPaths)
    ).evidenceBySkillKey;
    const byKey = new Map<string, SkillInventoryEntry>();
    const managedResourcesByTarget = await readManagedSkillResourcesByTarget(
      targetPaths,
      targetStateRepository
    );
    const snapshots = await Promise.all(targetPaths.map(async (target) => ({
      target,
      snapshot: await runtimeSnapshotProvider(target)
    })));
    onIssues?.(
      snapshots.flatMap(({ snapshot }) => snapshot.issues)
        .filter((issue) => issue.code === "unreadable-skill-location")
    );
    await migrateLegacySkillPolicies(snapshots);
    const unmanagedLocations = await readUnmanagedSkillLocations();
    const collectionDecisions = await readSkillCollectionDecisions();
    const sharedSkillArea = await sharedSkillAreaStore.read();
    const sharedOwnershipFor = createSharedSkillInventoryOwnership(sharedSkillArea, libraryIds);
    const unmanagedLocationFor = (
      targetId: string,
      path: string,
      collectionPath?: string
    ) =>
      findUnmanagedSkillLocation(unmanagedLocations, {
        path,
        targetId,
        coverage: "exact"
      }) ??
      findUnmanagedSkillLocation(unmanagedLocations, {
        path,
        coverage: "exact"
      }) ??
      (collectionPath
        ? findUnmanagedSkillLocation(unmanagedLocations, {
            path: collectionPath,
            coverage: "collection"
          })
        : undefined);
    for (const { target, snapshot } of snapshots) {
      for (const observation of snapshot.observations) {
        const deploymentName = observation.deploymentName;
        const skillDir = observation.path;
        const managedResource = managedResourcesByTarget
          .get(target.targetId)
          ?.get(resolve(skillDir));
        const deploymentKey = normalizeSkillKey(deploymentName);
        const skillKey = normalizeSkillKey(observation.runtimeName);
        const evidence = skillsCliEvidence.get(skillKey) ?? skillsCliEvidence.get(deploymentKey);
        const location = target.skillLocations?.find(
          (item) => resolve(item.path) === resolve(observation.locationPath)
        );
        const legacyOwnershipMarkerPaths = await legacyOwnerMarkerPathsFor(skillDir, {
          targetId: target.targetId,
          kind: "skill"
        });
        const unreadable = observation.issues.some((issue) => issue.code === "unreadable-skill");
        if (unreadable) {
          const unmanagedLocation = unmanagedLocationFor(
            target.targetId,
            skillDir,
            observation.collectionLink?.path
          );
          const collectionDecision = findSkillCollectionDecision(
            collectionDecisions,
            skillDir
          );
          const externalEvidence = evidence
            ? { ...evidence, confidence: "confirmed" as const, state: "broken-link" as const }
            : observation.externalEvidence;
          const sharedOwnership = sharedOwnershipFor({
            path: skillDir,
            shared: observation.shared,
            explicitlyUnmanaged: Boolean(unmanagedLocation)
          });
          const status = sharedOwnership.kept
            ? "left-unmanaged"
            : managedResource || legacyOwnershipMarkerPaths.length > 0 || sharedOwnership.managed
              ? "managed"
              : unmanagedLocation
              ? "left-unmanaged"
              : "outside";
          const key = `${status}:${deploymentName}:${skillDir}`;
          const existing = byKey.get(key);
          if (existing) {
            mergeInventoryLocation(existing, target.targetId, location, observation);
            continue;
          }
          byKey.set(key, {
            id: deploymentName,
            name: observation.runtimeName,
            description: "Skill link target is unavailable.",
            path: skillDir,
            canonicalPath: resolve(skillDir),
            foundIn: [target.targetId],
            status,
            libraryId:
              managedResource?.source?.startsWith("skills-library/") &&
              libraryIds.has(managedResource.source.slice("skills-library/".length))
                ? managedResource.source.slice("skills-library/".length)
                : sharedOwnership.libraryId ??
                  (libraryIds.has(deploymentName) ? deploymentName : undefined),
            skillKey,
            runtimeName: observation.runtimeName,
            deploymentName,
            version: observation.version,
            runtimeScope: observation.scope,
            runtimeOwner: managedResource || legacyOwnershipMarkerPaths.length > 0 || sharedOwnership.managed
              ? "agentenv"
              : externalEvidence
                ? "external"
                : observation.owner,
            managedByTarget: Boolean(managedResource) || legacyOwnershipMarkerPaths.length > 0,
            managedAsShared: sharedOwnership.managed,
            legacyOwnershipMarkerPaths,
            runtimeAvailability: observation.availability,
            runtimeConfidence: observation.confidence,
            runtimeIssues: observation.issues,
            runtimeStates: [{
              targetId: target.targetId,
              availability: observation.availability,
              confidence: observation.confidence,
              issues: observation.issues
            }],
            contentHash: "",
            unmanagedLocationId: unmanagedLocation?.id,
            unmanagedCoverage: unmanagedLocation?.coverage,
            collectionDecision: collectionDecision?.decision,
            locationManagement: observation.locationManagement ?? location?.management,
            locationRole: observation.locationRole,
            sharedLocation: observation.shared,
            sharedLocationId: observation.sharedLocationId,
            sharedAreaMode: sharedOwnership.mode,
            legacyLocation: observation.legacy,
            externalEvidence,
            collectionLink: observation.collectionLink
          });
          continue;
        }

        const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
        const frontmatter = parseSkillFrontmatter(content);
        const ownedId = await legacyOwnedLibraryId(skillDir);
        const receiptLibraryId = managedResource?.source?.startsWith("skills-library/")
          ? managedResource.source.slice("skills-library/".length)
          : undefined;
        const agentEnvOwned = legacyOwnershipMarkerPaths.length > 0;
        const unmanagedLocation = unmanagedLocationFor(
          target.targetId,
          skillDir,
          observation.collectionLink?.path
        );
        const sharedOwnership = sharedOwnershipFor({
          path: skillDir,
          shared: observation.shared,
          explicitlyUnmanaged: Boolean(unmanagedLocation)
        });
        const markerId = receiptLibraryId && libraryIds.has(receiptLibraryId)
          ? receiptLibraryId
          : sharedOwnership.libraryId ??
            (ownedId && libraryIds.has(ownedId) ? ownedId : undefined);
        const managedAsShared = Boolean(sharedOwnership.libraryId && markerId === sharedOwnership.libraryId);
        const managedByAgentEnv =
          Boolean(managedResource) || agentEnvOwned || managedAsShared || Boolean(markerId);
        const collectionDecision = findSkillCollectionDecision(
          collectionDecisions,
          skillDir
        );
        let externalEvidence = managedByAgentEnv
          ? undefined
          : evidence ?? observation.externalEvidence;
        if (externalEvidence) {
          let confidence = externalEvidence.confidence;
          try {
            if (
              skillDir === externalEvidence.canonicalPath ||
              (await realpath(skillDir)) === (await realpath(externalEvidence.canonicalPath))
            ) {
              confidence = "confirmed";
            }
          } catch {
            // The lock is still useful evidence when its canonical copy is unavailable.
          }
          externalEvidence = { ...externalEvidence, confidence, state: "healthy" };
        }
        const contentHash = await computeContentHash(skillDir);
        const canonicalPath = await realpath(skillDir).catch(() => resolve(skillDir));
        const externalLibraryId = externalEvidence
          ? librarySkills.find((skill) => skill.contentHash === contentHash)?.id
          : undefined;
        const runtimeLibraryCandidates = libraryBySkillKey.get(skillKey) ?? [];
        const { localLibraryId, observedDiscovery } = resolveSkillInventoryLibraryMatch({
          deploymentName, contentHash, libraryIds, runtimeLibraryCandidates, observation
        });
        const status = sharedOwnership.kept
          ? "left-unmanaged"
          : managedByAgentEnv
            ? "managed"
            : unmanagedLocation
              ? "left-unmanaged"
              : observedDiscovery
                ? "outside"
                : localLibraryId
                  ? "library"
                  : "outside";
        const libraryId = markerId ?? externalLibraryId ?? localLibraryId;
        const key = `${status}:${libraryId ?? deploymentName}:${skillDir}`;
        const existing = byKey.get(key);
        if (existing) {
          mergeInventoryLocation(existing, target.targetId, location, observation);
          continue;
        }
        const skillDirStats = await lstat(skillDir);
        const skillFileLinkStats = await lstat(join(skillDir, "SKILL.md"));
        const skillFileStats = await stat(join(skillDir, "SKILL.md"));
        const contentMatchesLibrary = libraryId
          ? libraryById.get(libraryId)?.contentHash === contentHash
          : undefined;
        const linkedInstall = skillDirStats.isSymbolicLink() || skillFileLinkStats.isSymbolicLink();
        const libraryCanonicalPath = libraryId
          ? await realpath(libraryById.get(libraryId)?.path ?? "").catch(() => undefined)
          : undefined;
        byKey.set(key, {
          id: deploymentName,
          name: observation.runtimeName,
          description: frontmatter.description,
          path: skillDir,
          canonicalPath,
          foundIn: [target.targetId],
          status,
          libraryId,
          skillKey,
          runtimeName: observation.runtimeName,
          deploymentName,
          version: observation.version,
          runtimeScope: observation.scope,
          runtimeOwner: managedByAgentEnv
            ? "agentenv"
            : externalEvidence
              ? "external"
              : observation.owner,
          managedByTarget: Boolean(managedResource) || agentEnvOwned,
          managedAsShared,
          legacyOwnershipMarkerPaths,
          legacyOwnershipMigrationReady: legacySkillOwnershipMigrationReady({
            markerPaths: legacyOwnershipMarkerPaths,
            contentMatchesLibrary: contentMatchesLibrary === true,
            linkedInstall,
            canonicalPath,
            libraryCanonicalPath
          }),
          runtimeAvailability: observation.availability,
          runtimeConfidence: observation.confidence,
          runtimeIssues: observation.issues,
          runtimeStates: [{
            targetId: target.targetId,
            availability: observation.availability,
            confidence: observation.confidence,
            issues: observation.issues
          }],
          contentHash,
          modifiedAt: skillFileStats.mtime.toISOString(),
          unmanagedLocationId: unmanagedLocation?.id,
          unmanagedCoverage: unmanagedLocation?.coverage,
          collectionDecision: collectionDecision?.decision,
          installMethod: managedByAgentEnv && !sharedOwnership.kept
            ? linkedInstall
              ? "linked"
              : "copied"
            : undefined,
          contentMatchesLibrary,
          externalEvidence,
          locationRole: observation.locationRole,
          sharedLocation: observation.shared,
          sharedLocationId: observation.sharedLocationId,
          sharedAreaMode: sharedOwnership.mode,
          legacyLocation: observation.legacy,
          locationManagement: observation.locationManagement ?? location?.management,
          collectionLink: observation.collectionLink
        });
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const findManagedInstallPaths = (libraryId: string, targetPaths: TargetPaths[]) =>
    findManagedSkillInstallPaths(libraryId, targetPaths);

  const scanUnmanaged = (targetPaths: TargetPaths[]) =>
    scanUnmanagedSkillInventory(targetPaths, scanInventory);

  const scanLocalSkillSource = async (rootPath: string): Promise<ProjectSkillScanResult> => {
    const canonicalRoot = await realpath(rootPath).catch(() => resolve(rootPath));
    const targetPaths = await targetPathsProvider();
    const protectedRoots = [
      await libraryDir(),
      ...targetPaths.flatMap((target) => [target.skillsDir, ...(target.skillScanDirs ?? [])])
    ].filter((path): path is string => Boolean(path));
    for (const protectedRoot of protectedRoots) {
      const canonicalProtectedRoot = await realpath(protectedRoot).catch(() => resolve(protectedRoot));
      const overlaps =
        pathsEqual(canonicalRoot, canonicalProtectedRoot) ||
        isPathInside(canonicalRoot, canonicalProtectedRoot) ||
        isPathInside(canonicalProtectedRoot, canonicalRoot);
      if (overlaps) {
        throw new Error(
          "Choose a source folder outside Agent Skill locations and the AgentEnv Library"
        );
      }
    }
    return scanProjectSkillRoots([canonicalRoot], await listSkills());
  };

  const resolveImportPlan = (
    preview: SkillImportPreview,
    resolution: SkillImportInput["conflictResolution"],
    expectedContentHash: string | undefined
  ) => {
    if (expectedContentHash && preview.incoming.contentHash !== expectedContentHash) {
      throw new Error("Skill changed after the import preview; review the latest version");
    }
    if (preview.conflicts.length === 0) {
      return { id: preview.incoming.id, replace: false, reused: false, sourceOnly: false };
    }
    if (!resolution) {
      throw new Error(`Skill name or ID already exists in Library: ${preview.incoming.name}`);
    }
    const selected = resolution.action === "keep-both"
      ? undefined
      : preview.conflicts.find(
          (conflict) => conflict.existing.id === resolution.existingId
        );
    if (resolution.action === "reuse") {
      if (!selected?.identical) {
        throw new Error("Only an identical Library skill can be reused");
      }
      return { id: selected.existing.id, replace: false, reused: true, sourceOnly: false };
    }
    if (resolution.action === "keep-existing") {
      if (!selected) {
        throw new Error("The selected Library skill is no longer a matching conflict");
      }
      return { id: selected.existing.id, replace: false, reused: true, sourceOnly: false };
    }
    if (resolution.action === "update-source") {
      if (!selected?.contentIdentical || !selected.sourceUpdateAvailable) {
        throw new Error("The selected Skill no longer has an available source-only update");
      }
      return {
        id: selected.existing.id,
        replace: false,
        reused: false,
        sourceOnly: true
      };
    }
    if (resolution.action === "replace") {
      if (!selected) {
        throw new Error("The selected Library skill is no longer a matching conflict");
      }
      return { id: selected.existing.id, replace: true, reused: false, sourceOnly: false };
    }
    const safeId = SafeIdSchema.parse(resolution.id);
    if (safeId !== preview.suggestedDuplicateId) {
      throw new Error("The suggested Library ID changed; review the latest import preview");
    }
    if (preview.conflicts.some((conflict) => conflict.existing.id === safeId)) {
      throw new Error(`Library skill already exists: ${safeId}`);
    }
    return { id: safeId, replace: false, reused: false, sourceOnly: false };
  };

  const importSkill = async ({
    sourcePath,
    id,
    sourceType = "local",
    provenance,
    upstream,
    expectedContentHash,
    conflictResolution,
    sourceCollection
  }: ImportSkillStoreInput): Promise<SkillLibraryEntry> => {
    if (!(await pathExists(join(sourcePath, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${sourcePath}`);
    }
    await validateSkillFrontmatter(sourcePath);
    const validatedSourceCollection = await validateLocalSkillSourceCollection(
      sourceCollection,
      sourcePath
    );
    const preview = await previewImport({
      kind: "local",
      input: { sourcePath, id, provenance, upstream, sourceCollection: validatedSourceCollection }
    });
    const plan = resolveImportPlan(preview, conflictResolution, expectedContentHash);
    if (plan.reused) {
      const existing = (await listSkills()).find((skill) => skill.id === plan.id);
      if (!existing) throw new Error(`Library skill does not exist: ${plan.id}`);
      return existing;
    }
    const targetDir = join(await libraryDir(), plan.id);
    const previousMetadata = plan.replace || plan.sourceOnly
      ? await readLibraryMetadata(targetDir)
      : undefined;
    const githubSource = upstream?.kind === "github"
      ? parseGitHubSkillUrl(upstream.locator, {
          ref: upstream.ref,
          remotePath: upstream.subpath
        })
      : undefined;
    const persistedLocalSource =
      upstream?.kind === "local" ? upstream.locator : sourcePath;
    const nextMetadata = {
      sourceType: githubSource ? "github" as const : sourceType,
      source: githubSource?.sourceUrl ?? persistedLocalSource,
      remoteRef: githubSource?.ref,
      remotePath: githubSource?.remotePath,
      remoteRevision: githubSource
        ? upstream?.revision
        : validatedSourceCollection
          ? preview.incoming.contentHash
          : undefined,
      updatePolicy: githubSource ? "tracked" as const : "untracked" as const,
      iconKey: previousMetadata?.iconKey,
      globallyEnabled: previousMetadata?.globallyEnabled,
      upstream: upstream ?? {
        kind: "local" as const,
        locator: persistedLocalSource,
        revision: validatedSourceCollection ? preview.incoming.contentHash : undefined
      },
      provenance: provenance ?? previousMetadata?.provenance ?? { importedVia: "agentenv" as const },
      sourceCollection: validatedSourceCollection
    };
    if (plan.sourceOnly) {
      const backup = await createLibraryUpdateBackup(plan.id, targetDir);
      try {
        const claimPath = createCleanupPathClaimer(backup);
        await claimPath(targetDir);
        await writeMetadata(targetDir, nextMetadata);
        await claimPath.recordMutation(targetDir);
        const imported = await entryFor(plan.id, targetDir);
        await setCleanupStatus(backup, "complete");
        return imported;
      } catch (error) {
        return failAfterCleanupRollback(backup, `Updating ${plan.id} source`, error);
      }
    }
    const backup = plan.replace ? await createLibraryUpdateBackup(plan.id, targetDir) : undefined;
    const claimPath = backup ? createCleanupPathClaimer(backup) : undefined;
    try {
      if (claimPath) await claimPath(targetDir);
      await replacePathAtomically(targetDir, async (stagingPath) => {
        await cp(sourcePath, stagingPath, { recursive: true, dereference: true });
        await rm(join(stagingPath, ".agentenv-owner.json"), { force: true });
        await writeMetadata(stagingPath, nextMetadata);
      }, backup ? {} : { expectedTargetHash: undefined });
      if (claimPath) await claimPath.recordMutation(targetDir);
      const imported = await entryFor(plan.id, targetDir);
      if (backup) await setCleanupStatus(backup, "complete");
      return imported;
    } catch (error) {
      if (backup) return failAfterCleanupRollback(backup, `Replacing ${plan.id}`, error);
      throw error;
    }
  };

  const removeSkill = async (
    id: string,
    managedInstallPaths: string[] = []
  ): Promise<SkillCleanupResult> => {
    const safeId = SafeIdSchema.parse(id);
    const targetLibraryDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetLibraryDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }

    const backupId = `remove-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const libraryBackupPath = join(backupDir, "library", safeId);
    const uniqueInstallPaths = [...new Set(managedInstallPaths)];
    const protectedInstallPaths = uniqueInstallPaths.flatMap((sourcePath) => [
      sourcePath,
      markerPathForFile(sourcePath)
    ]);
    const entries: SkillCleanupBackupManifest["entries"] = [];
    await mkdir(dirname(libraryBackupPath), { recursive: true });
    const libraryBackupHash = await copyPathVerified(targetLibraryDir, libraryBackupPath, {
      recursive: true,
      dereference: false
    });

    for (const [index, sourcePath] of protectedInstallPaths.entries()) {
      if (!(await pathEntryExists(sourcePath))) {
        continue;
      }
      const backupPath = join(backupDir, "locations", `${index}-${basename(sourcePath)}`);
      await copyCleanupEntry(entries, sourcePath, backupPath);
    }

    const manifest: SkillCleanupBackupManifest = {
      formatVersion: 2,
      id: backupId,
      libraryId: safeId,
      libraryCreated: false,
      libraryRemoved: true,
      libraryBackupPath,
      libraryBackupHash,
      operation: "remove",
      status: "prepared",
      createdAt: new Date().toISOString(),
      expectedPaths: await snapshotCleanupPaths([
        targetLibraryDir,
        ...protectedInstallPaths
      ]),
      entries
    };
    await writeCleanupManifest(manifest);

    try {
      const claimPath = createCleanupPathClaimer(manifest);
      for (const sourcePath of uniqueInstallPaths) {
        await claimPath(sourcePath, markerPathForFile(sourcePath));
        await removeSkillDeployment(sourcePath, {
          allowedRoot: dirname(sourcePath)
        });
        await claimPath.recordMutation(sourcePath, markerPathForFile(sourcePath));
      }
      await claimPath(targetLibraryDir);
      await rm(targetLibraryDir, { recursive: true, force: true });
      await claimPath.recordMutation(targetLibraryDir);
      await setCleanupStatus(manifest, "complete");
      return {
        backupId,
        libraryId: safeId,
        managedLocations: uniqueInstallPaths,
        operation: "remove"
      };
    } catch (error) {
      return failAfterCleanupRollback(manifest, `Removing ${safeId}`, error);
    }
  };

  const importGitHubSkill = async ({
    url,
    id,
    ref,
    remotePath,
    sourceCollection,
    expectedContentHash,
    conflictResolution
  }: GitHubSkillImportInput): Promise<SkillLibraryEntry> => {
    const source = parseGitHubSkillUrl(url, { ref, remotePath });
    const validatedSourceCollection = validateGitHubImportCollection(
      { sourceCollection },
      source
    );

    const tempDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-"));
    try {
      const [{ hasSkillMd, revision }, sourceUpdatedAt] = await Promise.all([
        materializeGitHubSkillTree(source, tempDir, { refreshFiles: true }),
        readGitHubSkillUpdatedAt(source)
      ]);
      if (!hasSkillMd) {
        throw new Error(`GitHub skill source is missing SKILL.md: ${url}`);
      }
      await validateSkillFrontmatter(tempDir);
      const previewSource: SkillImportPreviewInput = {
        kind: "github",
        input: { url, id, ref, remotePath, sourceCollection: validatedSourceCollection }
      };
      const preview = await previewDirectoryImport(
        previewSource,
        tempDir,
        id ?? source.defaultId,
        {
          sourceType: "github",
          source: source.sourceUrl,
          upstream: {
            kind: "github",
            locator: source.sourceUrl,
            ref: source.ref,
            subpath: source.remotePath,
            revision,
            updatedAt: sourceUpdatedAt
          }
        }
      );
      const plan = resolveImportPlan(preview, conflictResolution, expectedContentHash);
      if (plan.reused) {
        const existing = (await listSkills()).find((skill) => skill.id === plan.id);
        if (!existing) throw new Error(`Library skill does not exist: ${plan.id}`);
        return existing;
      }
      const targetDir = join(await libraryDir(), plan.id);
      const previousMetadata = plan.replace || plan.sourceOnly
        ? await readLibraryMetadata(targetDir)
        : undefined;
      if (plan.sourceOnly) {
        const backup = await createLibraryUpdateBackup(plan.id, targetDir);
        try {
          const claimPath = createCleanupPathClaimer(backup);
          await claimPath(targetDir);
          await writeMetadata(targetDir, {
            sourceType: "github",
            source: source.sourceUrl,
            remoteRef: source.ref,
            remotePath: source.remotePath,
            remoteRevision: revision,
            updatePolicy: "tracked",
            iconKey: previousMetadata?.iconKey,
            globallyEnabled: previousMetadata?.globallyEnabled,
            upstream: {
              kind: "github",
              locator: source.sourceUrl,
              ref: source.ref,
              subpath: source.remotePath,
              revision,
              updatedAt: sourceUpdatedAt
            },
            provenance: previousMetadata?.provenance ?? { importedVia: "agentenv" },
            sourceCollection: validatedSourceCollection
          });
          await claimPath.recordMutation(targetDir);
          const imported = await entryFor(plan.id, targetDir);
          await setCleanupStatus(backup, "complete");
          return imported;
        } catch (error) {
          return failAfterCleanupRollback(backup, `Updating ${plan.id} source`, error);
        }
      }
      const backup = plan.replace ? await createLibraryUpdateBackup(plan.id, targetDir) : undefined;
      const claimPath = backup ? createCleanupPathClaimer(backup) : undefined;
      try {
        if (claimPath) await claimPath(targetDir);
        await removeAndCopy(tempDir, targetDir, {
          expectMissing: !backup,
          prepareStaging: (stagingPath) => writeMetadata(stagingPath, {
            sourceType: "github",
            source: source.sourceUrl,
            remoteRef: source.ref,
            remotePath: source.remotePath,
            remoteRevision: revision,
            updatePolicy: "tracked",
            iconKey: previousMetadata?.iconKey,
            globallyEnabled: previousMetadata?.globallyEnabled,
            upstream: {
              kind: "github",
              locator: source.sourceUrl,
              ref: source.ref,
              subpath: source.remotePath,
              revision,
              updatedAt: sourceUpdatedAt
            },
            provenance: { importedVia: "agentenv" },
            sourceCollection: validatedSourceCollection
          })
        });
        if (claimPath) await claimPath.recordMutation(targetDir);
        const imported = await entryFor(plan.id, targetDir);
        if (backup) await setCleanupStatus(backup, "complete");
        return imported;
      } catch (error) {
        if (backup) return failAfterCleanupRollback(backup, `Replacing ${plan.id}`, error);
        throw error;
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };

  const importGitHubSkills = async (
    inputs: GitHubSkillImportInput[]
  ): Promise<GitHubSkillImportResult> => {
    const imported: SkillLibraryEntry[] = [];
    const failed: GitHubSkillImportResult["failed"] = [];
    for (const input of inputs) {
      try {
        imported.push(await importGitHubSkill(input));
      } catch (error) {
        failed.push({
          id: input.id ?? "skill",
          sourceUrl: input.url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { imported, failed };
  };

  const scanRepositorySkills = async (
    input: RepositorySkillSourceInput
  ): Promise<RepositorySkillScanResult> => {
    const result = await requireRepositorySource().scan(input, undefined, { refresh: true });
    const existingSkills = await listSkills();
    const normalizedResult = normalizeRepositorySkillScan(result, existingSkills);
    await skillSourceService.recordRepositoryScan(result.sourceScope, normalizedResult);
    return normalizedResult;
  };

  const importRepositorySkill = async (
    input: RepositorySkillImportInput
  ): Promise<SkillLibraryEntry> => {
    const tempDir = await mkdtemp(join(tmpdir(), "agentenv-repository-skill-"));
    try {
      const materialized = await requireRepositorySource().materialize(
        input,
        tempDir,
        undefined,
        { refresh: false }
      );
      const validatedSourceCollection = validateRepositoryImportCollection(input, materialized);
      const frontmatter = await validateSkillFrontmatter(tempDir);
      const requestedId =
        input.id ??
        normalizeSkillKey(frontmatter.name || basename(materialized.directory) || "skill");
      const previewSource: SkillImportPreviewInput = {
        kind: "repository",
        input: { ...input, sourceCollection: validatedSourceCollection }
      };
      const preview = await previewDirectoryImport(
        previewSource,
        tempDir,
        requestedId,
        {
          sourceType: "git",
          source: materialized.repository,
          upstream: materialized.upstream
        }
      );
      const plan = resolveImportPlan(
        preview,
        input.conflictResolution,
        input.expectedContentHash
      );
      if (plan.reused) {
        const existing = (await listSkills()).find((skill) => skill.id === plan.id);
        if (!existing) throw new Error(`Library skill does not exist: ${plan.id}`);
        return existing;
      }

      const targetDir = join(await libraryDir(), plan.id);
      const previousMetadata = plan.replace || plan.sourceOnly
        ? await readLibraryMetadata(targetDir)
        : undefined;
      const metadata: Pick<
        SkillMetadataFile,
        | "sourceType"
        | "source"
        | "remoteRef"
        | "remotePath"
        | "remoteRevision"
        | "updatePolicy"
        | "globallyEnabled"
        | "iconKey"
        | "upstream"
        | "provenance"
        | "sourceCollection"
      > = {
        sourceType: "git",
        source: materialized.repository,
        remoteRef: materialized.ref,
        remotePath: materialized.directory,
        remoteRevision: materialized.contentRevision,
        updatePolicy: "tracked",
        iconKey: previousMetadata?.iconKey,
        globallyEnabled: previousMetadata?.globallyEnabled,
        upstream: materialized.upstream,
        provenance: previousMetadata?.provenance ?? { importedVia: "agentenv" },
        sourceCollection: validatedSourceCollection
      };
      if (plan.sourceOnly) {
        const backup = await createLibraryUpdateBackup(plan.id, targetDir);
        try {
          const claimPath = createCleanupPathClaimer(backup);
          await claimPath(targetDir);
          await writeMetadata(targetDir, metadata);
          await claimPath.recordMutation(targetDir);
          const imported = await entryFor(plan.id, targetDir);
          await setCleanupStatus(backup, "complete");
          return imported;
        } catch (error) {
          return failAfterCleanupRollback(backup, `Updating ${plan.id} source`, error);
        }
      }

      const backup = plan.replace
        ? await createLibraryUpdateBackup(plan.id, targetDir)
        : undefined;
      const claimPath = backup ? createCleanupPathClaimer(backup) : undefined;
      try {
        if (claimPath) await claimPath(targetDir);
        await removeAndCopy(tempDir, targetDir, {
          expectMissing: !backup,
          prepareStaging: (stagingPath) => writeMetadata(stagingPath, metadata)
        });
        if (claimPath) await claimPath.recordMutation(targetDir);
        const imported = await entryFor(plan.id, targetDir);
        if (backup) await setCleanupStatus(backup, "complete");
        return imported;
      } catch (error) {
        if (backup) return failAfterCleanupRollback(backup, `Replacing ${plan.id}`, error);
        throw error;
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };

  const importRepositorySkills = async (
    inputs: RepositorySkillImportInput[]
  ): Promise<RepositorySkillImportResult> => {
    const imported: SkillLibraryEntry[] = [];
    const failed: RepositorySkillImportResult["failed"] = [];
    for (const input of inputs) {
      try {
        imported.push(await importRepositorySkill(input));
      } catch (error) {
        failed.push({
          id: input.id ?? "skill",
          repository: input.repository,
          ref: input.ref,
          directory: input.directory,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { imported, failed };
  };

  const {
    listSourceGroups,
    checkSourceGroup,
    checkMonitoredSourceGroups,
    setSourceName,
    setSourceMonitored,
    setSourceCandidateIgnored
  } =
    createSkillSourceGroupStore(skillSourceService, listSkills, skillSourceRegistry);
  const { preview: previewSourceMerge, merge: mergeSources } = createSkillSourceMergeService({
    appDataRoot: paths.appDataRoot,
    backupStore: safetyBackupStore,
    repositorySource,
    sourceObservationsDir: paths.skillSourceObservationsDir,
    sourceRegistryPath: paths.skillSourcesPath,
    sourceRegistry: skillSourceRegistry,
    sourceService: skillSourceService,
    listSkills,
    listSourceGroups
  });

  const deployLibrarySkill = createSkillLibraryTargetDeployer({ libraryDir, readSettings });

  const manageTargetSkill = async (input: ManageTargetSkillStoreInput): Promise<void> => {
    const targetDir = input.targetPaths.skillsDir
      ? join(input.targetPaths.skillsDir, input.targetName)
      : "";
    if (!targetDir || !(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Agent Skill does not exist: ${targetDir}`);
    }
    const backupId = `cleanup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const entries: SkillCleanupBackupManifest["entries"] = [];
    const stateFile = await targetStateRepository.read(input.targetPaths.targetId);
    for (const [index, sourcePath] of [
      targetDir,
      markerPathForFile(targetDir),
      stateFile.path
    ].entries()) {
      if (!(await pathEntryExists(sourcePath))) continue;
      const backupPath = join(backupDir, "locations", `${index}-${basename(sourcePath)}`);
      await copyCleanupEntry(entries, sourcePath, backupPath);
    }
    const manifest: SkillCleanupBackupManifest = {
      formatVersion: 2,
      id: backupId,
      libraryId: SafeIdSchema.parse(input.libraryId),
      libraryCreated: false,
      operation: "cleanup",
      status: "prepared",
      createdAt: new Date().toISOString(),
      expectedPaths: await snapshotCleanupPaths([
        targetDir,
        markerPathForFile(targetDir),
        stateFile.path
      ]),
      entries
    };
    await writeCleanupManifest(manifest);
    try {
      const claimPath = createCleanupPathClaimer(manifest);
      const previous = stateFile.state.managedResources?.find(
        (resource) => resource.kind === "skill" && resolve(resource.path) === resolve(targetDir)
      );
      const settings = await readSettings();
      const sourceDir = join(await libraryDir(), SafeIdSchema.parse(input.libraryId));
      const stats = await lstat(targetDir);
      const contentMatches = await computeContentHash(targetDir) === await computeContentHash(sourceDir);
      const topologyMatches = settings.skillSyncMethod === "symlink"
        ? stats.isSymbolicLink()
        : !stats.isSymbolicLink();
      const adopted = contentMatches && topologyMatches;
      await claimPath(
        ...(adopted ? [] : [targetDir, markerPathForFile(targetDir)]),
        stateFile.path
      );
      if (!adopted) await deployLibrarySkill(input);
      const nextResource = await createManagedSkillResource({
        id: input.targetName,
        path: targetDir,
        libraryId: SafeIdSchema.parse(input.libraryId),
        contentHash: await computeContentHash(targetDir),
        origin: previous ? managedResourceOrigin(previous) : adopted ? "adopted" : "replaced"
      });
      await targetStateRepository.write(
        input.targetPaths.targetId,
        upsertManagedSkillResource(stateFile.state, nextResource),
        { expectedPathHash: stateFile.pathHash }
      );
      await claimPath.recordMutation(
        ...(adopted ? [] : [targetDir, markerPathForFile(targetDir)]),
        stateFile.path
      );
      await setCleanupStatus(manifest, "complete");
    } catch (error) {
      return failAfterCleanupRollback(
        manifest,
        `Managing ${input.targetName} for ${input.targetPaths.targetId}`,
        error
      );
    }
  };

  const previewMerge = async (
    id: string,
    targetPaths: TargetPaths[]
  ): Promise<SkillMergePreview> => {
    const safeId = SafeIdSchema.parse(id);
    const skills = await listSkills();
    const selected = skills.find((skill) => skill.id === safeId);
    if (!selected) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const normalizedName = normalizedSkillName(selected.name);
    const matching = skills
      .filter((skill) => normalizedSkillName(skill.name) === normalizedName)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (matching.length < 2) {
      throw new Error(`${selected.name} has no same-name Library skill to merge`);
    }

    const profiles = profileStore
      ? await readAllProfilesForResourceMutation(profileStore, "Skill merge preview")
      : [];
    const inventory = targetPaths.length > 0 ? await scanInventory(targetPaths) : [];
    const entries = await Promise.all(
      matching.map(async (skill) => {
        const snapshot = await snapshotForDirectory(skill.id, skill.path, {
          sourceType: skill.sourceType,
          source: skill.source ?? skill.path,
          upstream: skill.upstream
        });
        return {
          ...snapshot,
          iconKey: skill.iconKey,
          globallyEnabled: skill.globallyEnabled !== false,
          updatePolicy: skill.updatePolicy,
          profileNames: profiles
            .filter((profile) =>
              profile.resources.skills.some((reference) => reference.libraryId === skill.id)
            )
            .map((profile) => profile.manifest.name)
            .sort(),
          installCount: inventory.filter(
            (item) => item.status === "managed" && item.libraryId === skill.id
          ).length
        };
      })
    );
    const comparisons = [];
    for (let leftIndex = 0; leftIndex < matching.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < matching.length; rightIndex += 1) {
        const left = matching[leftIndex];
        const right = matching[rightIndex];
        const identical = entries[leftIndex].contentHash === entries[rightIndex].contentHash;
        comparisons.push({
          leftId: left.id,
          rightId: right.id,
          identical,
          changes: identical ? [] : await createSkillChanges(left.path, right.path)
        });
      }
    }
    const matchingIds = new Set(matching.map((skill) => skill.id));
    return {
      name: selected.name,
      entries,
      comparisons,
      profileCount: profiles.filter((profile) =>
        profile.resources.skills.some((reference) => matchingIds.has(reference.libraryId))
      ).length,
      installCount: inventory.filter(
        (item) => item.status === "managed" && item.libraryId && matchingIds.has(item.libraryId)
      ).length
    };
  };

  const mergeSkills = async (
    input: SkillMergeInput,
    targetPaths: TargetPaths[]
  ): Promise<SkillMergeResult> => {
    const keepId = SafeIdSchema.parse(input.keepId);
    const sourceId = SafeIdSchema.parse(input.sourceId);
    const requestedIds = [...new Set(input.ids.map((id) => SafeIdSchema.parse(id)))].sort();
    if (requestedIds.length < 2 || !requestedIds.includes(keepId) || !requestedIds.includes(sourceId)) {
      throw new Error("Skill merge requires at least two reviewed entries and valid selections");
    }
    if (!profileStore) {
      throw new Error("Profile storage is required to merge Library skills safely");
    }

    const preview = await previewMerge(keepId, targetPaths);
    const currentIds = preview.entries.map((entry) => entry.id).sort();
    if (currentIds.join("\0") !== requestedIds.join("\0")) {
      throw new Error("Same-name Library skills changed after preview; review them again");
    }
    for (const entry of preview.entries) {
      if (input.expectedContentHashes[entry.id] !== entry.contentHash) {
        throw new Error(`${entry.id} changed after the merge preview; review it again`);
      }
    }

    const skills = await listSkills();
    const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
    const keepSkill = skillsById.get(keepId);
    const sourceSkill = skillsById.get(sourceId);
    if (!keepSkill || !sourceSkill) {
      throw new Error("A selected Library skill no longer exists");
    }
    const removedIds = requestedIds.filter((id) => id !== keepId);
    const removedIdSet = new Set(removedIds);
    const profileDetails = await readAllProfilesForResourceMutation(
      profileStore,
      "Skill merge"
    );
    const affectedProfiles = profileDetails.filter((profile) =>
      profile.resources.skills.some((reference) => removedIdSet.has(reference.libraryId))
    );
    const inventory = targetPaths.length > 0 ? await scanInventory(targetPaths) : [];
    const affectedInstalls = inventory.filter(
      (item) =>
        item.status === "managed" &&
        Boolean(item.libraryId && removedIdSet.has(item.libraryId)) &&
        Boolean(item.foundIn[0])
    );
    const stateFilesByTarget = await readTargetStateFiles(
      targetStateRepository,
      affectedInstalls.flatMap((install) => install.foundIn.slice(0, 1))
    );

    const backupId = `merge-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const protectedPaths = [
      ...requestedIds.map((id) => skillsById.get(id)!.path),
      ...affectedProfiles.map((profile) => profile.profileDir ?? join(paths.profilesDir, profile.id)),
      ...affectedInstalls.flatMap((install) => [install.path, markerPathForFile(install.path)]),
      ...[...stateFilesByTarget.values()].map((stateFile) => stateFile.path)
    ];
    const entries: SkillCleanupBackupManifest["entries"] = [];
    await mkdir(join(backupDir, "locations"), { recursive: true });
    for (const sourcePath of [...new Set(protectedPaths)]) {
      if (!(await pathEntryExists(sourcePath))) continue;
      const backupPath = join(
        backupDir,
        "locations",
        `${entries.length}-${basename(sourcePath)}`
      );
      await copyCleanupEntry(entries, sourcePath, backupPath);
    }
    const manifest: SkillCleanupBackupManifest = {
      formatVersion: 2,
      id: backupId,
      libraryId: keepId,
      libraryCreated: false,
      operation: "merge",
      status: "prepared",
      createdAt: new Date().toISOString(),
      expectedPaths: await snapshotCleanupPaths(protectedPaths),
      entries
    };
    await writeCleanupManifest(manifest);

    try {
      const claimPath = createCleanupPathClaimer(manifest);
      await claimPath(keepSkill.path);
      const keepMetadata = await readLibraryMetadata(keepSkill.path);
      const sourceMetadata = await readLibraryMetadata(sourceSkill.path);
      const mergedMetadata: SkillMetadataFile = {
        sourceType: sourceSkill.sourceType,
        source: sourceSkill.source,
        remoteRef: sourceMetadata.remoteRef,
        remotePath: sourceMetadata.remotePath,
        remoteRevision: sourceMetadata.remoteRevision,
        updatePolicy: sourceSkill.updatePolicy,
        updateCheckEnabled: sourceSkill.updatePolicy === "tracked",
        globallyEnabled: keepSkill.globallyEnabled !== false,
        iconKey: keepMetadata.iconKey,
        contentHash: await computeContentHash(keepSkill.path),
        updatedAt: new Date().toISOString(),
        upstream: sourceMetadata.upstream,
        provenance: sourceMetadata.provenance
      };
      await writeAtomic(
        join(keepSkill.path, ".agentenv-skill.json"),
        `${JSON.stringify(mergedMetadata, null, 2)}\n`
      );
      await claimPath.recordMutation(keepSkill.path);

      for (const profile of affectedProfiles) {
        await claimPath(profile.profileDir ?? join(paths.profilesDir, profile.id));
        const hasKeptReference = profile.resources.skills.some(
          (reference) => reference.libraryId === keepId
        );
        const mappedReferences = profile.resources.skills
          .filter((reference) => !(hasKeptReference && removedIdSet.has(reference.libraryId)))
          .map((reference) =>
            removedIdSet.has(reference.libraryId)
              ? { ...reference, libraryId: keepId }
              : reference
          );
        const nextReferences = mappedReferences.reduce<typeof mappedReferences>(
          (references, reference) => {
            const existing = references.find(
              (candidate) =>
                candidate.libraryId === reference.libraryId &&
                candidate.targetName === reference.targetName
            );
            if (!existing) {
              references.push({ ...reference });
            } else if (existing.enabled === false && reference.enabled !== false) {
              existing.enabled = reference.enabled;
            }
            return references;
          },
          []
        );
        await profileStore.saveProfile({
          manifest: profile.manifest,
          instructions: profile.instructions,
          resources: { ...profile.resources, skills: nextReferences },
          expectedContentHash: profile.contentHash
        });
        await claimPath.recordMutation(profile.profileDir ?? join(paths.profilesDir, profile.id));
      }
      for (const install of affectedInstalls) {
        await claimPath(install.path, markerPathForFile(install.path));
        const installTargetPaths = targetPaths.find(
          (candidate) => candidate.targetId === install.foundIn[0]
        );
        if (!installTargetPaths) throw new Error(`Agent path is unavailable: ${install.foundIn[0]}`);
        await deployLibrarySkill({
          libraryId: keepId,
          targetName: basename(install.path),
          targetPaths: installTargetPaths,
          targetDir: install.path
        });
        await claimPath.recordMutation(install.path, markerPathForFile(install.path));
      }
      const mergedContentHash = await computeContentHash(keepSkill.path);
      for (const stateFile of stateFilesByTarget.values()) await claimPath(stateFile.path);
      await updateMergedSkillTargetStates({
        repository: targetStateRepository,
        stateFiles: stateFilesByTarget,
        installs: affectedInstalls,
        removedIds,
        keepId,
        contentHash: mergedContentHash,
        recordMutation: claimPath.recordMutation
      });
      for (const removedId of removedIds) {
        await claimPath(skillsById.get(removedId)!.path);
        await rm(skillsById.get(removedId)!.path, { recursive: true, force: true });
        await claimPath.recordMutation(skillsById.get(removedId)!.path);
      }
      await setCleanupStatus(manifest, "complete");
      return {
        backupId,
        skill: await entryFor(keepId, keepSkill.path),
        removedIds,
        profilesUpdated: affectedProfiles.length,
        installsUpdated: affectedInstalls.length
      };
    } catch (error) {
      return failAfterCleanupRollback(manifest, `Merging ${preview.name}`, error);
    }
  };

  const consolidateSkillGroup = async ({
    skillKey,
    libraryId,
    canonicalPath,
    replaceLibrary = false,
    locations
  }: ConsolidateSkillGroupStoreInput): Promise<SkillCleanupResult> => {
    const safeSkillKey = SafeIdSchema.parse(skillKey);
    const safeLibraryId = SafeIdSchema.parse(libraryId);
    const targetLibraryDir = join(await libraryDir(), safeLibraryId);
    const libraryCreated = !(await pathExists(join(targetLibraryDir, "SKILL.md")));
    const previousLibraryMetadata = replaceLibrary
      ? await readLibraryMetadata(targetLibraryDir)
      : undefined;
    if ((libraryCreated || replaceLibrary) && !locations.some((location) => location.targetDir === canonicalPath)) {
      throw new Error("Source skill must be one of the selected cleanup locations");
    }
    if ((libraryCreated || replaceLibrary) && !(await pathExists(join(canonicalPath, "SKILL.md")))) {
      throw new Error(`Source skill is missing SKILL.md: ${canonicalPath}`);
    }
    if (libraryCreated || replaceLibrary) {
      await validateSkillFrontmatter(canonicalPath);
    }

    const uniqueLocations = [...new Map(locations.map((item) => [item.targetDir, item])).values()];
    const markerPathsFor = (location: typeof uniqueLocations[number]) =>
      protectedLegacySkillMarkerPaths(location.targetDir, location.legacyOwnershipMarkerPaths);
    const stateFilesByTarget = await readTargetStateFiles(
      targetStateRepository,
      uniqueLocations.map((location) => location.targetPaths.targetId)
    );
    const backupId = `cleanup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const entries: SkillCleanupBackupManifest["entries"] = [];
    const libraryBackupPath = replaceLibrary
      ? join(backupDir, "library", safeLibraryId)
      : undefined;
    await mkdir(backupDir, { recursive: true });

    if (libraryBackupPath) {
      await mkdir(dirname(libraryBackupPath), { recursive: true });
      await copyPathVerified(targetLibraryDir, libraryBackupPath, {
        recursive: true,
        dereference: false
      });
    }

    for (const [index, location] of uniqueLocations.entries()) {
      if (!(await pathExists(join(location.targetDir, "SKILL.md")))) {
        throw new Error(`Skill cleanup location is missing SKILL.md: ${location.targetDir}`);
      }
      const backupPath = join(backupDir, "locations", `${index}-${basename(location.targetDir)}`);
      await copyCleanupEntry(entries, location.targetDir, backupPath);
      for (const [markerIndex, markerPath] of markerPathsFor(location).entries()) {
        if (
          isPathInside(location.targetDir, markerPath) ||
          !(await pathEntryExists(markerPath))
        ) {
          continue;
        }
        await copyCleanupEntry(
          entries,
          markerPath,
          `${backupPath}.agentenv-owner-${markerIndex}.json`
        );
      }
    }
    for (const [index, stateFile] of [...stateFilesByTarget.values()].entries()) {
      if (!(await pathEntryExists(stateFile.path))) continue;
      await copyCleanupEntry(
        entries,
        stateFile.path,
        join(backupDir, "target-states", `${index}-${basename(stateFile.path)}`)
      );
    }

    const manifest: SkillCleanupBackupManifest = {
      formatVersion: 2,
      id: backupId,
      libraryId: safeLibraryId,
      libraryCreated,
      libraryRemoved: replaceLibrary,
      libraryBackupPath,
      libraryBackupHash: libraryBackupPath
        ? await hashPathEntry(libraryBackupPath)
        : undefined,
      createdAt: new Date().toISOString(),
      operation: "cleanup",
      status: "prepared",
      expectedPaths: await snapshotCleanupPaths([
        ...uniqueLocations.flatMap((location) => [
          location.targetDir,
          ...markerPathsFor(location)
        ]),
        ...[...stateFilesByTarget.values()].map((stateFile) => stateFile.path),
        ...(libraryCreated || replaceLibrary ? [targetLibraryDir] : [])
      ]),
      entries
    };
    await writeCleanupManifest(manifest);

    try {
      const claimPath = createCleanupPathClaimer(manifest);
      if (libraryCreated || replaceLibrary) {
        await claimPath(canonicalPath, targetLibraryDir);
        await removeAndCopy(canonicalPath, targetLibraryDir);
        await writeMetadata(targetLibraryDir, {
          sourceType: "local",
          source: canonicalPath,
          updatePolicy: "untracked",
          iconKey: previousLibraryMetadata?.iconKey,
          globallyEnabled: previousLibraryMetadata?.globallyEnabled,
          upstream: { kind: "local", locator: canonicalPath },
          provenance: { importedVia: "local-scan" }
        });
        await claimPath.recordMutation(targetLibraryDir);
      }
      const settings = await readSettings();
      const libraryContentHash = await computeContentHash(targetLibraryDir);
      const originsByPath = new Map<
        string,
        "adopted" | "created" | "replaced" | "unknown"
      >();
      for (const location of uniqueLocations) {
        const stateFile = stateFilesByTarget.get(location.targetPaths.targetId)!;
        const previous = stateFile.state.managedResources?.find(
          (resource) =>
            resource.kind === "skill" && resolve(resource.path) === resolve(location.targetDir)
        );
        const stats = await lstat(location.targetDir);
        const topologyMatches = settings.skillSyncMethod === "symlink"
          ? stats.isSymbolicLink()
          : !stats.isSymbolicLink();
        const contentMatches = await computeContentHash(location.targetDir) === libraryContentHash;
        const preservesLegacyTopology = await canPreserveLegacySkillTopology(
          location.targetDir,
          targetLibraryDir,
          location.legacyOwnershipMarkerPaths
        );
        if (contentMatches && (topologyMatches || preservesLegacyTopology)) {
          originsByPath.set(
            resolve(location.targetDir),
            previous ? managedResourceOrigin(previous) : "adopted"
          );
          await claimPath(
            stateFile.path,
            ...markerPathsFor(location)
          );
          continue;
        }
        await claimPath(
          location.targetDir,
          ...markerPathsFor(location),
          stateFile.path
        );
        await deployLibrarySkill({
          libraryId: safeLibraryId,
          targetName: basename(location.targetDir),
          targetPaths: location.targetPaths,
          targetDir: location.targetDir
        });
        originsByPath.set(
          resolve(location.targetDir),
          previous ? managedResourceOrigin(previous) : "replaced"
        );
        await claimPath.recordMutation(location.targetDir, markerPathForFile(location.targetDir));
      }
      await updateConsolidatedSkillTargetStates({
        repository: targetStateRepository,
        stateFiles: stateFilesByTarget,
        locations: uniqueLocations,
        libraryId: safeLibraryId,
        computeContentHash,
        originsByPath,
        recordMutation: claimPath.recordMutation
      });
      for (const markerPath of uniqueLocations.flatMap(
        (location) => location.legacyOwnershipMarkerPaths ?? []
      )) {
        await rm(markerPath, { force: true });
        await claimPath.recordMutation(markerPath);
      }
      const verificationTargets = new Map<string, TargetPaths>();
      for (const location of uniqueLocations) {
        verificationTargets.set(location.targetPaths.targetId, location.targetPaths);
      }
      const verificationInventory = await scanInventory(
        [...verificationTargets.values()],
        await listSkills()
      );
      const verificationGroup = buildSkillCleanupGroups(verificationInventory)
        .find((group) => group.skillKey === safeSkillKey);
      const verifiedPaths = new Map(
        verificationInventory.map((item) => [resolve(item.path), item])
      );
      const incompletePaths = uniqueLocations
        .map((location) => resolve(location.targetDir))
        .filter((path) => {
          const item = verifiedPaths.get(path);
          return !item ||
            item.status !== "managed" ||
            item.libraryId !== safeLibraryId ||
            item.contentMatchesLibrary !== true;
        });
      if (
        incompletePaths.length > 0 ||
        !verificationGroup ||
        verificationGroup.resolution !== "resolved" ||
        verificationGroup.state !== "managed"
      ) {
        const remainingPaths = verificationGroup?.activeItems
          .filter((item) => item.status !== "managed" || item.contentMatchesLibrary !== true)
          .map((item) => item.path) ?? incompletePaths;
        throw new Error(
          `Cleanup did not reach a stable managed state. Review or leave these locations unmanaged, then retry: ${[...new Set([...incompletePaths, ...remainingPaths])].join(", ")}`
        );
      }
      await setCleanupStatus(manifest, "complete");
      return {
        backupId,
        libraryId: safeLibraryId,
        managedLocations: uniqueLocations.map((location) => location.targetDir),
        operation: "cleanup",
        libraryCreated
      };
    } catch (error) {
      return failAfterCleanupRollback(manifest, `Skill cleanup ${safeSkillKey}`, error);
    }
  };

  const removeUnavailableSkillLinks = async ({
    skillKey,
    locations
  }: RemoveUnavailableSkillLinksStoreInput): Promise<SkillCleanupResult> =>
    removeUnavailableSkillLinksTransaction({
      skillKey,
      locations: locations.map((location) => location.targetDir),
      backupRoot: cleanupBackupRoot(),
      backupStore: safetyBackupStore
    });

  const consolidateSharedSkillGroup = async ({
    skillKey,
    libraryId,
    canonicalPath,
    replaceLibrary = false,
    sharedPaths,
    duplicatePaths
  }: ConsolidateSharedSkillGroupStoreInput): Promise<SkillCleanupResult> => {
    const safeSkillKey = SafeIdSchema.parse(skillKey);
    const safeLibraryId = SafeIdSchema.parse(libraryId);
    const uniqueSharedPaths = [...new Set(sharedPaths)];
    const uniqueDuplicatePaths = [...new Set(duplicatePaths)].filter(
      (path) => !uniqueSharedPaths.includes(path)
    );
    const affectedPaths = [...uniqueSharedPaths, ...uniqueDuplicatePaths];
    if (![...uniqueSharedPaths, ...uniqueDuplicatePaths].includes(canonicalPath)) {
      throw new Error("Source skill must be one of the selected cleanup locations");
    }
    if (uniqueSharedPaths.length === 0) {
      throw new Error("Shared skill cleanup requires a compatibility location");
    }
    for (const path of affectedPaths) {
      if (!(await pathExists(join(path, "SKILL.md")))) {
        throw new Error(`Skill cleanup location is missing SKILL.md: ${path}`);
      }
    }
    const targetLibraryDir = join(await libraryDir(), safeLibraryId);
    const libraryCreated = !(await pathExists(join(targetLibraryDir, "SKILL.md")));
    if (libraryCreated || replaceLibrary) {
      await validateSkillFrontmatter(canonicalPath);
    }
    const backupId = `cleanup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const entries: SkillCleanupBackupManifest["entries"] = [];
    const libraryBackupPath = replaceLibrary
      ? join(backupDir, "library", safeLibraryId)
      : undefined;
    await mkdir(backupDir, { recursive: true });
    await backupSharedSkillAreaState(
      sharedSkillAreaStore.path, backupDir, affectedPaths.length, entries, copyCleanupEntry);

    if (libraryBackupPath) {
      await mkdir(dirname(libraryBackupPath), { recursive: true });
      await copyPathVerified(targetLibraryDir, libraryBackupPath, {
        recursive: true,
        dereference: false
      });
    }

    for (const [index, sourcePath] of affectedPaths.entries()) {
      const backupPath = join(backupDir, "locations", `${index}-${basename(sourcePath)}`);
      await copyCleanupEntry(entries, sourcePath, backupPath);
      const markerPath = markerPathForFile(sourcePath);
      if (await pathEntryExists(markerPath)) {
        const markerBackupPath = `${backupPath}.agentenv-owner.json`;
        await copyCleanupEntry(entries, markerPath, markerBackupPath);
      }
    }

    const manifest: SkillCleanupBackupManifest = {
      formatVersion: 2,
      id: backupId,
      libraryId: safeLibraryId,
      libraryCreated,
      libraryRemoved: replaceLibrary,
      libraryBackupPath,
      libraryBackupHash: libraryBackupPath
        ? await hashPathEntry(libraryBackupPath)
        : undefined,
      createdAt: new Date().toISOString(),
      operation: "cleanup",
      status: "prepared",
      expectedPaths: await snapshotCleanupPaths([
        ...affectedPaths.flatMap((path) => [path, markerPathForFile(path)]),
        ...(libraryCreated || replaceLibrary ? [targetLibraryDir] : []),
        sharedSkillAreaStore.path
      ]),
      entries
    };
    await writeCleanupManifest(manifest);

    try {
      const claimPath = createCleanupPathClaimer(manifest);
      if (libraryCreated || replaceLibrary) {
        await claimPath(canonicalPath, targetLibraryDir);
        await removeAndCopy(canonicalPath, targetLibraryDir);
        await writeMetadata(targetLibraryDir, {
          sourceType: "local",
          source: canonicalPath,
          updatePolicy: "untracked",
          upstream: { kind: "local", locator: canonicalPath },
          provenance: { importedVia: "local-scan" }
        });
        await claimPath.recordMutation(targetLibraryDir);
      }
      const libraryContentHash = await computeContentHash(targetLibraryDir);
      const sharedReceipts = [];
      for (const sharedPath of uniqueSharedPaths) {
        await claimPath(sharedPath, markerPathForFile(sharedPath));
        const sharedContentHash = await computeContentHash(sharedPath);
        if (sharedContentHash !== libraryContentHash) {
          await removeAndCopy(targetLibraryDir, sharedPath);
        }
        await rm(join(sharedPath, ".agentenv-skill.json"), { force: true });
        await rm(join(sharedPath, ".agentenv-owner.json"), { force: true });
        await rm(markerPathForFile(sharedPath), { force: true });
        await claimPath.recordMutation(sharedPath, markerPathForFile(sharedPath));
        sharedReceipts.push(await managedSharedSkillReceipt(sharedPath, safeLibraryId, libraryContentHash));
      }
      for (const duplicatePath of uniqueDuplicatePaths) {
        await claimPath(duplicatePath, markerPathForFile(duplicatePath));
        await removeSkillDeployment(duplicatePath, {
          allowedRoot: dirname(duplicatePath)
        });
        await claimPath.recordMutation(duplicatePath, markerPathForFile(duplicatePath));
      }
      await claimPath(sharedSkillAreaStore.path);
      await sharedSkillAreaStore.recordManaged(sharedReceipts);
      await claimPath.recordMutation(sharedSkillAreaStore.path);
      await setCleanupStatus(manifest, "complete");
      return {
        backupId,
        libraryId: safeLibraryId,
        managedLocations: uniqueSharedPaths,
        operation: "cleanup",
        libraryCreated
      };
    } catch (error) {
      return failAfterCleanupRollback(manifest, `Shared skill cleanup ${safeSkillKey}`, error);
    }
  };

  const rollbackSkillCleanup = async (backupId: string): Promise<void> => {
    const { backupDir, manifest } = await readCleanupBackup(backupId);
    const targetLibraryDir = join(await libraryDir(), manifest.libraryId);
    const restoreScope = [...new Set([
      ...manifest.expectedPaths.map((entry) => entry.path),
      ...manifest.entries.map((entry) => entry.sourcePath),
      targetLibraryDir
    ])];
    const safetyBackup = await safetyBackupStore.createBackup(
      restoreScope,
      {
        operation: "rollback-safety",
        profileName: `${manifest.libraryId} before cleanup rollback`
      }
    );
    await setCleanupStatus(manifest, "rollback-prepared", {
      safetyBackupId: safetyBackup.id
    });
    try {
      await restoreCleanupBackupSafely(manifest, undefined, safetyBackup);
    } catch (rollbackError) {
      if (rollbackError instanceof BackupRecoveryError) {
        const recoveryError =
          `Cleanup rollback failed and needs recovery: ${rollbackError.message}`;
        await setCleanupStatus(manifest, "recovery-required", {
          recoveryError,
          safetyBackupId: safetyBackup.id
        }).catch(() => undefined);
        throw new Error(
          `${recoveryError}. Cleanup backup ${manifest.id} and safety backup ${safetyBackup.id} were preserved.`
        );
      }
      await setCleanupStatus(manifest, "complete", {
        safetyBackupId: safetyBackup.id
      });
      throw new Error(
        `Cleanup rollback failed; the pre-rollback state was restored from safety backup ${safetyBackup.id}. ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`
      );
    }
    await setCleanupStatus(manifest, "restored", { safetyBackupId: safetyBackup.id });
    const archiveRoot = join(paths.backupsDir, "skill-cleanup-restored");
    await mkdir(archiveRoot, { recursive: true });
    await rename(backupDir, join(archiveRoot, `${manifest.id}-${Date.now()}`));
  };

  const deleteCleanupBackup = async (backupId: string): Promise<void> => {
    const { backupDir } = await readCleanupBackup(backupId);
    await rm(backupDir, { recursive: true, force: true });
  };

  const checkUpdates = async (ids?: string[]): Promise<SkillUpdateInfo[]> => {
    const skills = await listSkills();
    const selectedIds = ids ? new Set(ids.map((id) => SafeIdSchema.parse(id))) : undefined;
    const selectedSkills = skills.filter(
      (item) =>
        (!selectedIds || selectedIds.has(item.id)) &&
        item.updatePolicy === "tracked" &&
        item.globallyEnabled &&
        Boolean(item.source)
    );
    const githubManifests = new Map<string, Promise<Array<{
      path: string;
      type: "blob" | "tree";
      sha: string;
    }> | undefined>>();
    const checkedMetadataHashes = new Map<string, string>();
    const githubManifestFor = (source: ParsedGitHubSkillSource) => {
      const key = `${source.owner}/${source.repo}\0${source.ref}`;
      const existing = githubManifests.get(key);
      if (existing) return existing;
      const request = (async () => {
        try {
          const commitUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref)}`;
          const commit = await fetchGitHubJson(commitUrl, { refresh: true }) as GitHubCommitResponse;
          const treeSha = commit.commit?.tree?.sha;
          if (!treeSha) return undefined;
          const tree = await fetchGitHubJson(
            `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
            { refresh: true }
          ) as GitHubTreeResponse;
          if (tree.truncated) return undefined;
          return (tree.tree ?? []).filter((entry): entry is {
            path: string;
            type: "blob" | "tree";
            sha: string;
          } =>
            (entry.type === "blob" || entry.type === "tree") &&
            typeof entry.path === "string" &&
            typeof entry.sha === "string"
          );
        } catch {
          return undefined;
        }
      })();
      githubManifests.set(key, request);
      return request;
    };
    const results = await Promise.all(selectedSkills.map(async (skill): Promise<SkillUpdateInfo> => {
      const metadata = await readLibraryMetadata(skill.path);
      checkedMetadataHashes.set(skill.id, metadataHash(metadata));
      if (!metadata.source) {
        return {
          id: skill.id,
          name: skill.name,
          sourceType: skill.sourceType,
          currentRevision: metadata.remoteRevision,
          updateAvailable: false,
          error: "Missing update source"
        };
      }

      try {
        if (metadata.sourceType === "local") {
          if (!(await pathExists(join(metadata.source, "SKILL.md")))) {
            throw new Error(`Skill source is missing SKILL.md: ${metadata.source}`);
          }
          const latestRevision = await computeContentHash(metadata.source);
          return {
            id: skill.id,
            name: skill.name,
            sourceType: "local",
            currentRevision: metadata.contentHash,
            latestRevision,
            updateAvailable: latestRevision !== metadata.contentHash
          };
        }
        if (metadata.sourceType === "git") {
          const latest = await requireRepositorySource().resolve({
            repository: metadata.source,
            ref: metadata.remoteRef,
            directory: metadata.remotePath,
            transport: "system-git"
          }, undefined, { refresh: true });
          return {
            id: skill.id,
            name: skill.name,
            sourceType: "git",
            currentRevision: metadata.remoteRevision,
            latestRevision: latest.contentRevision,
            latestUpdatedAt: latest.upstream.updatedAt,
            updateAvailable: latest.contentRevision !== metadata.remoteRevision
          };
        }
        if (metadata.sourceType !== "github") {
          throw new Error(`Skill update source type is not supported: ${metadata.sourceType}`);
        }
        const source = parseGitHubSkillUrl(metadata.source, {
          ref: metadata.remoteRef,
          remotePath: metadata.remotePath
        });
        const manifest = await githubManifestFor(source);
        const skillManifestPath = [source.remotePath, "SKILL.md"].filter(Boolean).join("/");
        const githubTree = manifest
          ? undefined
          : await readGitHubTree(source, undefined, { refresh: true });
        const hasSkillMd = manifest
          ? manifest.some((entry) => entry.type === "blob" && entry.path === skillManifestPath)
          : githubTree?.hasSkillMd === true;
        if (!hasSkillMd) {
          return {
            id: skill.id,
            name: skill.name,
            sourceType: "github",
            currentRevision: metadata.remoteRevision,
            updateAvailable: false,
            sourceStatus: "removed"
          };
        }
        const latestRevision = manifest
          ? githubContentsRevision(source.remotePath, manifest)
          : githubTree!.revision;
        const updateAvailable = latestRevision !== metadata.remoteRevision;
        const latestUpdatedAt = updateAvailable
          ? await readGitHubSkillUpdatedAt(source, { refresh: true })
          : metadata.upstream?.updatedAt;
        return {
          id: skill.id,
          name: skill.name,
          sourceType: "github",
          currentRevision: metadata.remoteRevision,
          latestRevision,
          latestUpdatedAt,
          updateAvailable
        };
      } catch (error) {
        if (error instanceof RepositorySkillSourceMissingError) {
          return {
            id: skill.id,
            name: skill.name,
            sourceType: metadata.sourceType ?? skill.sourceType,
            currentRevision: metadata.remoteRevision ?? metadata.contentHash,
            updateAvailable: false,
            sourceStatus: "removed"
          };
        }
        return {
          id: skill.id,
          name: skill.name,
          sourceType: metadata.sourceType ?? skill.sourceType,
          currentRevision: metadata.remoteRevision ?? metadata.contentHash,
          updateAvailable: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));
    const checkedAt = Date.now();
    for (const result of results) {
      const checkedMetadataHash = checkedMetadataHashes.get(result.id);
      if (!result.error && checkedMetadataHash) {
        recentUpdateChecks.set(result.id, {
          checkedAt,
          metadataHash: checkedMetadataHash,
          sourceStatus: result.sourceStatus
        });
      }
    }
    return results;
  };

  const prepareUpdateSourceMetadata = async ({
    sourceType,
    source,
    ref,
    directory
  }: SkillUpdateSourceInput) => {
    if (sourceType === "github") {
      const githubSource = parseGitHubSkillUrl(source);
      const sourceCollection = createSingleSkillSourceCollection(
        { repository: source, ref: githubSource.ref, directory: githubSource.remotePath },
        {
          repository: `https://github.com/${githubSource.owner}/${githubSource.repo}.git`,
          ref: githubSource.ref,
          directory: githubSource.remotePath
        }
      );
      return {
        sourceType: "github",
        source: githubSource.sourceUrl,
        remoteRef: githubSource.ref,
        remotePath: githubSource.remotePath,
        upstream: {
          kind: "github",
          locator: githubSource.sourceUrl,
          ref: githubSource.ref,
          subpath: githubSource.remotePath
        },
        sourceCollection
      } as const;
    }
    if (sourceType === "git") {
      const tempDir = await mkdtemp(join(tmpdir(), "agentenv-repository-source-"));
      try {
        const materialized = await requireRepositorySource().materialize(
          { repository: source, ref, directory, transport: "system-git" },
          tempDir
        );
        const sourceCollection = createSingleSkillSourceCollection(
          { repository: source, ref, directory, transport: "system-git" },
          materialized
        );
        return {
          sourceType: "git",
          source: materialized.repository,
          remoteRef: materialized.ref,
          remotePath: materialized.directory,
          remoteRevision: materialized.contentRevision,
          upstream: materialized.upstream,
          sourceCollection
        } as const;
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
    if (sourceType !== "local") {
      throw new Error(`Skill update source type is not supported yet: ${sourceType}`);
    }
    if (!(await pathExists(join(source, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${source}`);
    }
    const sourceRevision = await computeContentHash(source);
    return {
      sourceType: "local",
      source,
      remoteRevision: sourceRevision,
      upstream: { kind: "local", locator: source, revision: sourceRevision },
      sourceCollection: createLocalSkillSourceCollection(source, source)
    } as const;
  };

  const setUpdateSettings = async ({
    source,
    policy
  }: SkillUpdateSettingsInput): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(policy.id);
    if (source && SafeIdSchema.parse(source.id) !== safeId) {
      throw new Error("Skill update source and policy must refer to the same Skill");
    }
    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const current = await readLibraryMetadata(targetDir);
    const metadata = source
      ? await prepareUpdateSourceMetadata(source)
      : {
          sourceType: current.sourceType ?? "local",
          source: current.source,
          remoteRef: current.remoteRef,
          remotePath: current.remotePath,
          remoteRevision: current.remoteRevision,
          upstream: current.upstream,
          sourceCollection: current.sourceCollection
        };
    const sourceType = metadata.sourceType ?? "local";
    if (policy.policy === "tracked") {
      if (!metadata.source) {
        throw new Error(`Add an update source before tracking updates for ${safeId}`);
      }
      if (sourceType === "local" && !(await pathExists(join(metadata.source, "SKILL.md")))) {
        throw new Error(`Skill source is missing SKILL.md: ${metadata.source}`);
      }
      if (sourceType === "github") {
        parseGitHubSkillUrl(metadata.source, {
          ref: metadata.remoteRef,
          remotePath: metadata.remotePath
        });
      }
      if (sourceType === "git") {
        parseRepositoryLocation(metadata.source, { allowLocal: true });
      }
    }
    await writeMetadata(targetDir, {
      sourceType,
      source: metadata.source,
      remoteRef: metadata.remoteRef,
      remotePath: metadata.remotePath,
      remoteRevision: metadata.remoteRevision,
      upstream: metadata.upstream,
      sourceCollection: metadata.sourceCollection,
      updatePolicy: policy.policy
    });
    return entryFor(safeId, targetDir);
  };

  const setUpdateSource = async (
    input: SkillUpdateSourceInput
  ): Promise<SkillLibraryEntry> =>
    setUpdateSettings({
      source: input,
      policy: { id: input.id, policy: "tracked" }
    });

  const setUpdatePolicy = async (
    input: SkillUpdatePolicyInput
  ): Promise<SkillLibraryEntry> =>
    setUpdateSettings({ policy: input });

  const setAvailability = async ({
    id,
    enabled
  }: SkillAvailabilityInput): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const metadata = await readLibraryMetadata(targetDir);
    await writeMetadata(targetDir, {
      sourceType: metadata.sourceType ?? "local",
      source: metadata.source,
      remoteRef: metadata.remoteRef,
      remotePath: metadata.remotePath,
      remoteRevision: metadata.remoteRevision,
      updatePolicy: updatePolicyFor(metadata),
      globallyEnabled: enabled
    });
    return entryFor(safeId, targetDir);
  };

  const setIcon = async ({ id, iconKey }: SkillIconInput): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const metadata = await readLibraryMetadata(targetDir);
    await writeMetadata(targetDir, {
      sourceType: metadata.sourceType ?? "local",
      source: metadata.source,
      remoteRef: metadata.remoteRef,
      remotePath: metadata.remotePath,
      remoteRevision: metadata.remoteRevision,
      updatePolicy: updatePolicyFor(metadata),
      iconKey: iconKey ?? null
    });
    return entryFor(safeId, targetDir);
  };

  const skillUpdateImpact = async (id: string): Promise<SkillUpdateImpact> => {
    const profileNames = profileStore
      ? (await readAllProfilesForResourceMutation(
          profileStore,
          "Skill update preview"
        )).flatMap((profile) =>
          profile.resources.skills.some(
            (reference) => reference.libraryId === id && reference.enabled !== false
          )
            ? [profile.manifest.name]
            : []
        )
      : [];
    const inventory = await scanInventory(await targetPathsProvider(), await listSkills());
    const installs = inventory.filter(
      (item) => item.status === "managed" && item.libraryId === id
    );
    const targetIdsFor = (method: "linked" | "copied") =>
      [...new Set(
        installs
          .filter((item) => item.installMethod === method)
          .flatMap((item) => item.foundIn)
      )].sort((left, right) => left.localeCompare(right));
    return {
      profileNames: [...new Set(profileNames)].sort((left, right) => left.localeCompare(right)),
      linkedInstallCount: installs.filter((item) => item.installMethod === "linked").length,
      linkedTargetIds: targetIdsFor("linked"),
      copiedInstallCount: installs.filter((item) => item.installMethod === "copied").length,
      copiedTargetIds: targetIdsFor("copied")
    };
  };

  const previewUpdate = async (
    id: string,
    refreshSource?: boolean
  ): Promise<SkillUpdatePlan> => {
    await discardExpiredPendingUpdates();
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const skill = await entryFor(safeId, targetDir);
    const metadata = await readLibraryMetadata(targetDir);
    const recentCheck = recentUpdateChecks.getFresh(safeId, metadataHash(metadata));
    const shouldRefreshSource = refreshSource ?? !recentCheck;
    const impact = await skillUpdateImpact(safeId);
    const removedSourcePlan = () => createRemovedSourceSkillUpdatePlan({
      discardPendingUpdates: discardPendingUpdatesForSkill, impact, metadata, skill
    });
    if (
      recentCheck?.sourceStatus === "removed"
    ) {
      return removedSourcePlan();
    }
    if (skill.updatePolicy !== "tracked") {
      return {
        id: skill.id,
        name: skill.name,
        sourceType: skill.sourceType,
        source: metadata.source,
        currentRevision: metadata.remoteRevision ?? metadata.contentHash,
        updateAvailable: false,
        changes: [],
        errors: ["This skill is not tracked for updates"],
        impact
      };
    }
    if (!metadata.source) {
      return {
        id: skill.id,
        name: skill.name,
        sourceType: skill.sourceType,
        source: metadata.source,
        currentRevision: metadata.remoteRevision ?? metadata.contentHash,
        updateAvailable: false,
        changes: [],
        errors: ["Skill has no update source configured"],
        impact
      };
    }

    const finalizeCandidate = async (
      candidateDir: string,
      nextMetadata: SkillMetadataFile,
      latestRevision?: string
    ): Promise<SkillUpdatePlan> => {
      await validateSkillFrontmatter(candidateDir);
      await rm(join(candidateDir, ".agentenv-skill.json"), { force: true });
      await rm(join(candidateDir, ".agentenv-owner.json"), { force: true });
      const expectedLibraryContentHash = await computeContentHash(targetDir);
      const { changes } = await createSkillChangeSet(targetDir, candidateDir);
      if (await computeContentHash(targetDir) !== expectedLibraryContentHash) {
        throw new Error("Library skill changed while preparing the update preview; retry");
      }
      const currentMetadata = await readLibraryMetadata(targetDir);
      if (metadataHash(currentMetadata) !== metadataHash(metadata)) {
        throw new Error("Skill update settings changed while preparing the preview; retry");
      }
      const candidateContentHash = await computeContentHash(candidateDir);
      if (changes.length === 0) {
        // The source may use a different revision encoding (for example Git tree
        // versus GitHub Contents API) while the actual Skill files are identical.
        // Advance the tracking checkpoint so subsequent source checks do not keep
        // reporting an update that has already been verified as a no-op.
        await writeMetadata(targetDir, {
          ...metadata,
          remoteRevision: nextMetadata.remoteRevision,
          upstream: nextMetadata.upstream
        });
        await rm(candidateDir, { recursive: true, force: true });
        return {
          id: skill.id,
          name: skill.name,
          sourceType: skill.sourceType,
          source: metadata.source,
          currentRevision: metadata.remoteRevision ?? metadata.contentHash,
          latestRevision,
          updateAvailable: false,
          changes: [],
          errors: [],
          impact
        };
      }

      const previewId = randomUUID();
      await discardPendingUpdatesForSkill(skill.id);
      pendingUpdates.set({
        previewId,
        id: skill.id,
        candidateDir,
        candidateContentHash,
        expectedLibraryContentHash,
        expectedMetadataHash: metadataHash(currentMetadata),
        createdAt: Date.now(),
        nextMetadata
      });
      return {
        id: skill.id,
        previewId,
        name: skill.name,
        sourceType: skill.sourceType,
        source: metadata.source,
        currentRevision: metadata.remoteRevision ?? metadata.contentHash,
        latestRevision,
        updateAvailable: true,
        changes,
        errors: [],
        impact
      };
    };

    if (metadata.sourceType === "github") {
      const source = parseGitHubSkillUrl(metadata.source, {
        ref: metadata.remoteRef,
        remotePath: metadata.remotePath
      });
      const candidateDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-update-"));
      try {
        const [{ hasSkillMd, revision }, sourceUpdatedAt] = await Promise.all([
          materializeGitHubSkillTree(source, candidateDir, {
            refresh: shouldRefreshSource,
            refreshFiles: true
          }),
          readGitHubSkillUpdatedAt(source, { refresh: shouldRefreshSource }).catch(() => undefined)
        ]);
        if (!hasSkillMd) {
          return await removedSourcePlan();
        }
        return await finalizeCandidate(candidateDir, {
          ...metadata,
          sourceType: "github",
          source: metadata.source,
          remoteRef: source.ref,
          remotePath: source.remotePath,
          remoteRevision: revision,
          updatePolicy: "tracked",
          upstream: {
            kind: "github",
            locator: metadata.source,
            ref: source.ref,
            subpath: source.remotePath,
            revision,
            updatedAt: sourceUpdatedAt
          }
        }, revision);
      } catch (error) {
        if (!pendingUpdates.ownsCandidateDirectory(candidateDir)) {
          await rm(candidateDir, { recursive: true, force: true });
        }
        if (error instanceof RepositorySkillSourceMissingError) {
          return removedSourcePlan();
        }
        throw error;
      }
    }

    if (metadata.sourceType === "git") {
      const candidateDir = await mkdtemp(join(tmpdir(), "agentenv-repository-skill-update-"));
      try {
        const materialized = await requireRepositorySource().materialize(
          {
            repository: metadata.source,
            ref: metadata.remoteRef,
            directory: metadata.remotePath,
            transport: "system-git"
          },
          candidateDir,
          undefined,
          { refresh: shouldRefreshSource }
        );
        return await finalizeCandidate(candidateDir, {
          ...metadata,
          sourceType: "git",
          source: materialized.repository,
          remoteRef: materialized.ref,
          remotePath: materialized.directory,
          remoteRevision: materialized.contentRevision,
          updatePolicy: "tracked",
          upstream: materialized.upstream
        }, materialized.contentRevision);
      } catch (error) {
        if (!pendingUpdates.ownsCandidateDirectory(candidateDir)) {
          await rm(candidateDir, { recursive: true, force: true });
        }
        throw error;
      }
    }

    if (metadata.sourceType !== "local") {
      return {
        id: skill.id,
        name: skill.name,
        sourceType: skill.sourceType,
        source: metadata.source,
        currentRevision: metadata.contentHash,
        updateAvailable: false,
        changes: [],
        errors: [`Skill update source type is not supported yet: ${metadata.sourceType}`],
        impact
      };
    }
    if (!(await pathExists(join(metadata.source, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${metadata.source}`);
    }
    const sourceHashBeforeCopy = await computeContentHash(metadata.source);
    const candidateDir = await mkdtemp(join(tmpdir(), "agentenv-local-skill-update-"));
    try {
      await cp(metadata.source, candidateDir, { recursive: true, dereference: true });
      const sourceHashAfterCopy = await computeContentHash(metadata.source);
      const candidateHash = await computeContentHash(candidateDir);
      if (
        sourceHashBeforeCopy !== sourceHashAfterCopy ||
        candidateHash !== sourceHashAfterCopy
      ) {
        throw new Error("Local Skill source changed while preparing the update preview; retry");
      }
      return await finalizeCandidate(candidateDir, {
        ...metadata,
        sourceType: "local",
        source: metadata.source,
        remoteRevision: sourceHashAfterCopy,
        updatePolicy: "tracked",
        upstream: {
          ...(metadata.upstream ?? { kind: "local" as const, locator: metadata.source }),
          revision: sourceHashAfterCopy
        }
      }, sourceHashAfterCopy);
    } catch (error) {
      if (!pendingUpdates.ownsCandidateDirectory(candidateDir)) {
        await rm(candidateDir, { recursive: true, force: true });
      }
      throw error;
    }
  };

  const previewUpdates = async (ids: string[]): Promise<SkillUpdatePreviewBatchResult> => {
    const uniqueIds = [...new Set(ids.map((id) => SafeIdSchema.parse(id)))];
    const groups = new Map<string, string[]>();
    for (const id of uniqueIds) {
      const metadata: SkillMetadataFile = await readLibraryMetadata(
        join(await libraryDir(), id)
      ).catch(() => ({}));
      let key = `skill:${id}`;
      if (metadata.sourceType === "git" && metadata.source) {
        key = `git:${metadata.source}\0${metadata.remoteRef ?? ""}`;
      } else if (metadata.sourceType === "github" && metadata.source) {
        try {
          const source = parseGitHubSkillUrl(metadata.source, {
            ref: metadata.remoteRef,
            remotePath: metadata.remotePath
          });
          key = `github:${source.owner}/${source.repo}\0${source.ref}`;
        } catch {
          key = `github:${metadata.source}\0${metadata.remoteRef ?? ""}`;
        }
      }
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    const groupedResults = await mapWithConcurrency([...groups.values()], 2, async (group) => {
      const results: Array<
        { ok: true; plan: SkillUpdatePlan } | { ok: false; id: string; error: string }
      > = [];
      for (const [index, id] of group.entries()) {
        try {
          results.push({
            ok: true,
            plan: await previewUpdate(id, index === 0 ? undefined : false)
          });
        } catch (error) {
          results.push({ ok: false, id, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return results;
    });
    const results = groupedResults.flat();
    return {
      plans: results.flatMap((result) => result.ok ? [result.plan] : []),
      failed: results.flatMap((result) => result.ok ? [] : [{ id: result.id, error: result.error }])
    };
  };

  const updateSkill = async ({
    id,
    previewId,
    syncCopiedInstalls = false
  }: SkillUpdateConfirmation): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const pending = pendingUpdates.get(String(previewId));
    if (!pending || pending.id !== safeId) {
      throw new Error("Skill update preview is unavailable; review the update again");
    }
    if (pendingUpdates.isExpired(pending)) {
      await discardPendingUpdate(pending.previewId);
      throw new Error("Skill update preview expired; review the update again");
    }

    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const [currentContentHash, currentMetadata, candidateContentHash] = await Promise.all([
      computeContentHash(targetDir),
      readLibraryMetadata(targetDir),
      computeContentHash(pending.candidateDir)
    ]);
    if (
      currentContentHash !== pending.expectedLibraryContentHash ||
      metadataHash(currentMetadata) !== pending.expectedMetadataHash
    ) {
      throw new Error("Library skill changed after the update preview; review the latest version");
    }
    if (candidateContentHash !== pending.candidateContentHash) {
      await discardPendingUpdate(pending.previewId);
      throw new Error("Reviewed Skill update candidate is no longer available; review it again");
    }

    const targetPaths = await targetPathsProvider();
    const inventory = await scanInventory(targetPaths);
    const propagation = await prepareLibraryUpdatePropagation({
      inventory,
      libraryId: safeId,
      currentContentHash,
      nextContentHash: pending.candidateContentHash,
      targetStatesDir: paths.targetStatesDir,
      syncCopiedInstalls
    });
    const backup = await createLibraryUpdateBackup(
      safeId,
      targetDir,
      propagation.copiedInstalls.map((entry) => entry.path),
      propagation.stateUpdates.map((entry) => entry.path)
    );
    try {
      const claimPath = createCleanupPathClaimer(backup);
      await claimPath(targetDir);
      await removeAndCopy(pending.candidateDir, targetDir);
      await writeMetadata(targetDir, pending.nextMetadata);
      await claimPath.recordMutation(targetDir);
      const updated = await entryFor(safeId, targetDir);
      if (await computeContentHash(targetDir) !== pending.candidateContentHash) {
        throw new Error("The updated Library copy did not match the reviewed candidate");
      }
      await claimPath(
        ...propagation.copiedInstalls.flatMap((entry) => [
          entry.path,
          markerPathForFile(entry.path)
        ]),
        ...propagation.stateUpdates.map((entry) => entry.path)
      );
      await applyLibraryUpdatePropagation({
        sourceDir: targetDir,
        nextContentHash: pending.candidateContentHash,
        propagation
      });
      await claimPath.recordMutation(
        ...propagation.copiedInstalls.flatMap((entry) => [
          entry.path,
          markerPathForFile(entry.path)
        ]),
        ...propagation.stateUpdates.map((entry) => entry.path)
      );
      await setCleanupStatus(backup, "complete");
      await discardPendingUpdatesForSkill(safeId);
      return updated;
    } catch (error) {
      return failAfterCleanupRollback(backup, `Updating ${safeId}`, error);
    }
  };

  return {
    listSkills,
    scanInventory,
    findManagedInstallPaths,
    listCleanupBackups,
    previewCleanupBackup,
    recoverInterruptedCleanupBackups,
    listPendingCleanupRecoveries,
    setUnmanagedSkillLocations,
    setSkillCollectionDecision,
    scanUnmanaged,
    previewImport,
    previewMerge,
    mergeSkills,
    importSkill,
    importGitHubSkill,
    scanGitHubSkills,
    importGitHubSkills,
    scanRepositorySkills,
    scanLocalSkillSource,
    importRepositorySkill,
    importRepositorySkills,
    listSourceGroups,
    checkSourceGroup,
    checkMonitoredSourceGroups,
    setSourceName,
    setSourceMonitored,
    setSourceCandidateIgnored,
    previewSourceMerge,
    mergeSources,
    removeSkill,
    manageTargetSkill,
    deployLibrarySkill,
    consolidateSkillGroup,
    removeUnavailableSkillLinks,
    consolidateSharedSkillGroup,
    setSharedSkillRetention,
    readSharedSkillAreaState: sharedSkillAreaStore.read,
    setSharedSkillAreaMode: sharedSkillAreaStore.setMode,
    rollbackSkillCleanup,
    deleteCleanupBackup,
    checkUpdates,
    setUpdateSource,
    setUpdatePolicy,
    setUpdateSettings,
    setAvailability,
    setIcon,
    previewUpdate,
    previewUpdates,
    updateSkill
  };
};
