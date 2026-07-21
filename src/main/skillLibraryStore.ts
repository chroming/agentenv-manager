import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
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
  SkillCleanupIgnoreRule,
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
  SkillUpdateSourceInput,
  SkillRuntimeObservation,
  SkillRuntimeSnapshot,
  SkillSourceCheckAllResult,
  SkillSourceCollectionRef,
  SkillSourceGroupView,
  SkillSourceMergePreview, SkillSourceMergePreviewInput, SkillSourceMergeResult, SkillSourceScope,
  TargetSkillLocationRole,
  TargetSkillLocation,
  TargetPaths,
  UnmanagedSkillEntry,
  SharedSkillRetentionInput
} from "../shared/types";
import { normalizeSkillKey } from "../shared/skillIdentity";
import { pathEntryExists, pathExists, replacePathAtomically, replacePathWithCopy, writeAtomic } from "./fileUtils";
import {
  createOwnerMarkerContent,
  isAgentEnvOwnedDir,
  markerPathFor,
  markerPathForFile
} from "./ownershipMarkers";
import type { AgentEnvPaths } from "./paths";
import type { ProfileStore } from "./profileStore";
import { resolveSkillsLibraryDir, type SettingsStore } from "./settingsStore";
import { parseSkillFrontmatter } from "./skillFrontmatter";
import { inspectSkillsCliLocks } from "./skillsCliInspector";
import { deploySkillDirectory, removeSkillDeployment } from "./skillDeployment";
import { createTargetRegistry } from "./targets/registry";
import { createFilesystemSkillDriver } from "./targets/shared/skillRuntime";
import type { GitCliSkillSource } from "./skillSources/contract";
import { parseRepositoryLocation } from "./skillSources/repositoryLocation";
import { readAllProfilesForResourceMutation } from "./profileSafety";
import { createSkillChanges } from "./skillFileChanges";
import { hashSkillContent } from "./skillContentHash";
import { removeUnavailableSkillLinksTransaction } from "./skillUnavailableCleanup";
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
import { createSingleSkillSourceCollection } from "./skillSourceScope";
import { createSkillSourceMergeService } from "./skillSourceMergeService";
import { githubContentsRevision } from "./skillSources/revisionCompatibility";

interface SkillCleanupBackupManifest {
  id: string;
  libraryId: string;
  libraryCreated: boolean;
  libraryRemoved?: boolean;
  libraryBackupPath?: string;
  createdAt: string;
  operation?: "cleanup" | "remove" | "retire" | "update" | "merge";
  entries: Array<{ sourcePath: string; backupPath: string }>;
}

const skillLocationAuthority = (
  role: TargetSkillLocationRole | undefined,
  shared: boolean | undefined
): number => {
  if (!role && shared === undefined) return -1;
  const roleRank: Record<TargetSkillLocationRole, number> = {
    "preferred-runtime": 4,
    "alternate-runtime": 3,
    "compatibility-runtime": 2,
    "discovery-only": 1
  };
  return (shared === false ? 10 : 0) + (role ? roleRank[role] : 0);
};

const mergeInventoryLocation = (
  entry: SkillInventoryEntry,
  targetId: string,
  location: TargetSkillLocation | undefined,
  observation?: SkillRuntimeObservation
): void => {
  const replacesLocation =
    skillLocationAuthority(location?.role, location?.shared) >
    skillLocationAuthority(entry.locationRole, entry.sharedLocation);

  if (replacesLocation) {
    entry.locationRole = location?.role;
    entry.sharedLocation = location?.shared;
    entry.runtimeScope = location?.scope ?? (location?.shared ? "shared" : "user");
    entry.legacyLocation = location?.management === "legacy";
    if (observation) {
      entry.runtimeAvailability = observation.availability;
      entry.runtimeConfidence = observation.confidence;
    }
    entry.foundIn = [targetId, ...entry.foundIn.filter((item) => item !== targetId)];
  } else if (!entry.foundIn.includes(targetId)) {
    entry.foundIn.push(targetId);
  }
  if (observation) {
    entry.runtimeStates = [
      ...(entry.runtimeStates ?? []).filter((state) => state.targetId !== targetId),
      {
        targetId,
        availability: observation.availability,
        confidence: observation.confidence,
        issues: observation.issues
      }
    ];
    entry.runtimeIssues = [...new Map(
      (entry.runtimeStates ?? []).flatMap((state) => state.issues)
        .map((issue) => [`${issue.code}:${issue.message}`, issue])
    ).values()];
  }
};

export interface ImportSkillStoreInput extends SkillImportInput {
  sourceType?: SkillSourceType;
}

export interface ManageTargetSkillStoreInput {
  targetPaths: TargetPaths;
  targetName: string;
  libraryId: string;
}

export interface DeployLibrarySkillStoreInput extends ManageTargetSkillStoreInput {
  profileId: string;
}

export interface ConsolidateSkillGroupStoreInput {
  skillKey: string;
  libraryId: string;
  canonicalPath: string;
  replaceLibrary?: boolean;
  locations: Array<{ targetPaths: TargetPaths; targetDir: string }>;
}

export interface ConsolidateSharedSkillGroupStoreInput {
  skillKey: string;
  libraryId: string;
  canonicalPath: string;
  replaceLibrary?: boolean;
  sharedPaths: string[];
  duplicatePaths: string[];
}

export interface RemoveUnavailableSkillLinksStoreInput {
  skillKey: string;
  locations: Array<{ targetPaths: TargetPaths; targetDir: string }>;
}

export interface SkillLibraryStore {
  listSkills(): Promise<SkillLibraryEntry[]>;
  scanInventory(
    targetPaths: TargetPaths[],
    librarySkills?: SkillLibraryEntry[]
  ): Promise<SkillInventoryEntry[]>;
  findManagedInstallPaths(libraryId: string, targetPaths: TargetPaths[]): Promise<string[]>;
  listCleanupBackups(): Promise<SkillCleanupBackupSummary[]>;
  ignoreSkillGroup(skillKey: string): Promise<SkillCleanupIgnoreRule>;
  unignoreSkillGroup(skillKey: string): Promise<void>;
  scanUnmanaged(targetPaths: TargetPaths[]): Promise<UnmanagedSkillEntry[]>;
  previewImport(input: SkillImportPreviewInput): Promise<SkillImportPreview>;
  previewMerge(id: string, targetPaths: TargetPaths[]): Promise<SkillMergePreview>;
  mergeSkills(input: SkillMergeInput, targetPaths: TargetPaths[]): Promise<SkillMergeResult>;
  importSkill(input: ImportSkillStoreInput): Promise<SkillLibraryEntry>;
  importGitHubSkill(input: GitHubSkillImportInput): Promise<SkillLibraryEntry>;
  scanGitHubSkills(url: string): Promise<GitHubSkillScanResult>;
  importGitHubSkills(inputs: GitHubSkillImportInput[]): Promise<GitHubSkillImportResult>;
  scanRepositorySkills(input: RepositorySkillSourceInput): Promise<RepositorySkillScanResult>;
  importRepositorySkill(input: RepositorySkillImportInput): Promise<SkillLibraryEntry>;
  importRepositorySkills(inputs: RepositorySkillImportInput[]): Promise<RepositorySkillImportResult>;
  listSourceGroups(): Promise<SkillSourceGroupView[]>;
  checkSourceGroup(canonicalLink: string): Promise<SkillSourceGroupView>;
  checkAllSourceGroups(): Promise<SkillSourceCheckAllResult>;
  setSourceName(input: import("../shared/types").SkillSourceNameInput): Promise<SkillSourceGroupView>;
  previewSourceMerge(input: SkillSourceMergePreviewInput): Promise<SkillSourceMergePreview>;
  mergeSources(previewId: string): Promise<SkillSourceMergeResult>;
  removeSkill(id: string, managedInstallPaths?: string[]): Promise<SkillCleanupResult>;
  manageTargetSkill(input: ManageTargetSkillStoreInput): Promise<void>;
  deployLibrarySkill(input: DeployLibrarySkillStoreInput): Promise<void>;
  consolidateSkillGroup(input: ConsolidateSkillGroupStoreInput): Promise<SkillCleanupResult>;
  removeUnavailableSkillLinks(
    input: RemoveUnavailableSkillLinksStoreInput
  ): Promise<SkillCleanupResult>;
  consolidateSharedSkillGroup(
    input: ConsolidateSharedSkillGroupStoreInput
  ): Promise<SkillCleanupResult>;
  setSharedSkillRetention(input: SharedSkillRetentionInput): Promise<void>;
  rollbackSkillCleanup(backupId: string): Promise<void>;
  deleteCleanupBackup(backupId: string): Promise<void>;
  checkUpdates(ids?: string[]): Promise<SkillUpdateInfo[]>;
  setUpdateSource(input: SkillUpdateSourceInput): Promise<SkillLibraryEntry>;
  setUpdatePolicy(input: SkillUpdatePolicyInput): Promise<SkillLibraryEntry>;
  setAvailability(input: SkillAvailabilityInput): Promise<SkillLibraryEntry>;
  setIcon(input: SkillIconInput): Promise<SkillLibraryEntry>;
  previewUpdate(id: string): Promise<SkillUpdatePlan>;
  updateSkill(input: SkillUpdateConfirmation): Promise<SkillLibraryEntry>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers?: Pick<Headers, "get">;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

interface SkillLibraryStoreOptions {
  authTokenProvider?: () => Promise<string | undefined>;
  fetch?: FetchLike;
  skillsCliLockPaths?: string[];
  profileStore?: Pick<ProfileStore, "listProfiles" | "readProfile" | "saveProfile">;
  targetPathsProvider?: () => TargetPaths[];
  runtimeSnapshotProvider?: (targetPaths: TargetPaths) => Promise<SkillRuntimeSnapshot>;
  repositorySource?: GitCliSkillSource;
}

interface PendingSkillUpdate {
  previewId: string;
  id: string;
  candidateDir: string;
  candidateContentHash: string;
  expectedLibraryContentHash: string;
  expectedMetadataHash: string;
  createdAt: number;
  nextMetadata: SkillMetadataFile;
}

const SKILL_UPDATE_PREVIEW_TTL_MS = 30 * 60 * 1000;

interface ParsedGitHubSkillSource {
  owner: string;
  repo: string;
  ref: string;
  remotePath: string;
  sourceUrl: string;
  defaultId: string;
}

interface ParsedGitHubLocation {
  owner: string;
  repo: string;
  kind: "repository" | "tree" | "blob";
  pathSegments: string[];
}

interface GitHubRepositoryResponse {
  default_branch?: string;
}

interface GitHubCommitResponse {
  commit?: {
    tree?: { sha?: string };
    author?: { date?: string };
    committer?: { date?: string };
  };
}

interface GitHubTreeResponse {
  truncated?: boolean;
  tree?: Array<{ path?: string; type?: string; sha?: string }>;
}

interface GitHubContentBase {
  type: string;
  name: string;
  path: string;
  sha: string;
}

interface GitHubContentFile extends GitHubContentBase {
  type: "file";
  download_url: string | null;
}

interface GitHubContentDir extends GitHubContentBase {
  type: "dir";
}

type GitHubContentItem = GitHubContentFile | GitHubContentDir;

const DEFAULT_SETTINGS: AgentEnvSettings = {
  locale: "system",
  skillSyncMethod: "symlink",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60,
  backupRetentionDays: null
};

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

const removeAndCopy = async (source: string, destination: string) => {
  await replacePathAtomically(destination, async (stagingPath) => {
    await cp(source, stagingPath, { recursive: true, dereference: true });
    await rm(join(stagingPath, ".agentenv-owner.json"), { force: true });
  });
};

const parseGitHubLocation = (rawUrl: string): ParsedGitHubLocation => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("GitHub skill URL is invalid");
  }

  if (url.hostname !== "github.com") {
    throw new Error("GitHub skill URL must use github.com");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const [owner, rawRepo, rawKind, ...pathSegments] = segments;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo) {
    throw new Error("GitHub URL must point to a repository");
  }

  const kind = rawKind === "tree" || rawKind === "blob" ? rawKind : "repository";
  if (rawKind && kind === "repository") {
    throw new Error("GitHub URL must point to a repository, directory, or SKILL.md");
  }
  return { owner, repo, kind, pathSegments };
};

const githubSkillSourceUrl = (owner: string, repo: string, ref: string, remotePath: string) =>
  `https://github.com/${owner}/${repo}/tree/${ref}${remotePath ? `/${remotePath}` : ""}`;

const skillIdFrom = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SafeIdSchema.safeParse(normalized).success ? normalized : "skill";
};

const parseGitHubSkillUrl = (
  rawUrl: string,
  resolved?: { ref?: string; remotePath?: string }
): ParsedGitHubSkillSource => {
  const location = parseGitHubLocation(rawUrl);
  const [urlRef, ...rest] = location.pathSegments;
  const ref = resolved?.ref ?? urlRef;
  if (!ref) {
    throw new Error("GitHub skill URL must include a branch or resolved ref");
  }

  const pathSegments =
    location.kind === "blob" && rest.at(-1) === "SKILL.md" ? rest.slice(0, -1) : rest;
  const remotePath = resolved?.remotePath ?? pathSegments.join("/");
  const defaultId = pathSegments.at(-1) ?? location.repo;
  return {
    owner: location.owner,
    repo: location.repo,
    ref,
    remotePath,
    sourceUrl: githubSkillSourceUrl(location.owner, location.repo, ref, remotePath),
    defaultId: skillIdFrom(resolved?.remotePath?.split("/").at(-1) ?? defaultId)
  };
};

const encodeGitHubPath = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const relativeGitHubPath = (rootPath: string, childPath: string) => {
  if (!rootPath) {
    return childPath;
  }
  if (childPath === rootPath) {
    return "";
  }
  return childPath.startsWith(`${rootPath}/`) ? childPath.slice(rootPath.length + 1) : childPath;
};

const assertGitHubContentItems = (value: unknown, url: string): GitHubContentItem[] => {
  if (!Array.isArray(value)) {
    throw new Error(`GitHub source is not a directory: ${url}`);
  }
  return value.filter((item): item is GitHubContentItem => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const record = item as Record<string, unknown>;
    return (
      (record.type === "file" || record.type === "dir") &&
      typeof record.name === "string" &&
      typeof record.path === "string" &&
      typeof record.sha === "string"
    );
  });
};

export const createSkillLibraryStore = (
  paths: AgentEnvPaths,
  settingsStore?: Pick<SettingsStore, "readSettings">,
  options: SkillLibraryStoreOptions = {}
): SkillLibraryStore => {
  const readSettings = () => settingsStore?.readSettings() ?? Promise.resolve(DEFAULT_SETTINGS);
  const libraryDir = async () => resolveSkillsLibraryDir(paths, await readSettings());
  const ignoreRulesPath = join(paths.appDataRoot, "skill-cleanup-ignore-rules.json");
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
  const targetPathsProvider = options.targetPathsProvider ?? (() =>
    createTargetRegistry().listAdapters().map((adapter) =>
      adapter.createTargetPaths({
        homeDir: paths.homeDir,
        fakeHomeRoot: paths.fakeHomeRoot
      })
    ));
  const runtimeSnapshotProvider = options.runtimeSnapshotProvider ?? ((targetPaths) =>
    createFilesystemSkillDriver({ targetId: targetPaths.targetId }).inspectRuntime(targetPaths));
  const pendingUpdates = new Map<string, PendingSkillUpdate>();
  const skillSourceRegistry = createSkillSourceRegistry(paths.skillSourcesPath);
  const skillSourceService = createLibrarySkillSourceService(
    paths.skillSourceObservationsDir,
    repositorySource
  );

  const metadataHash = (metadata: SkillMetadataFile) =>
    createHash("sha256").update(JSON.stringify(metadata)).digest("hex");

  const discardPendingUpdate = async (previewId: string) => {
    const pending = pendingUpdates.get(previewId);
    if (!pending) return;
    pendingUpdates.delete(previewId);
    await rm(pending.candidateDir, { recursive: true, force: true });
  };

  const discardPendingUpdatesForSkill = async (id: string, exceptPreviewId?: string) => {
    await Promise.all(
      [...pendingUpdates.values()]
        .filter((pending) => pending.id === id && pending.previewId !== exceptPreviewId)
        .map((pending) => discardPendingUpdate(pending.previewId))
    );
  };

  const discardExpiredPendingUpdates = async () => {
    const cutoff = Date.now() - SKILL_UPDATE_PREVIEW_TTL_MS;
    await Promise.all(
      [...pendingUpdates.values()]
        .filter((pending) => pending.createdAt < cutoff)
        .map((pending) => discardPendingUpdate(pending.previewId))
    );
  };

  const readIgnoreRules = async () =>
    (await readJsonIfExists<SkillCleanupIgnoreRule[]>(ignoreRulesPath))?.filter(
      (rule) =>
        rule &&
        (rule.scope === "group" || rule.scope === "location") &&
        (typeof rule.skillKey === "string" || typeof rule.path === "string")
    ) ?? [];

  const writeIgnoreRules = async (rules: SkillCleanupIgnoreRule[]) => {
    await writeAtomic(ignoreRulesPath, `${JSON.stringify(rules, null, 2)}\n`);
  };

  const findIgnoreRule = (
    rules: SkillCleanupIgnoreRule[],
    input: { skillKey: string; path: string }
  ) =>
    rules.find((rule) =>
      rule.scope === "location"
        ? rule.path === input.path
        : rule.skillKey === input.skillKey
    );

  const ignoreSkillGroup = async (skillKey: string): Promise<SkillCleanupIgnoreRule> => {
    const normalized = normalizeSkillKey(skillKey);
    if (!normalized) {
      throw new Error("Skill key is required");
    }
    const rules = await readIgnoreRules();
    const existing = rules.find((rule) => rule.scope === "group" && rule.skillKey === normalized);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const rule: SkillCleanupIgnoreRule = {
      id: `ignore-${normalized}`,
      scope: "group",
      skillKey: normalized,
      createdAt: now,
      updatedAt: now
    };
    await writeIgnoreRules([...rules, rule]);
    return rule;
  };

  const unignoreSkillGroup = async (skillKey: string): Promise<void> => {
    const normalized = normalizeSkillKey(skillKey);
    const rules = await readIgnoreRules();
    const relatedRuleIds = new Set<string>();
    if (!rules.some((rule) => rule.scope === "group" && rule.skillKey === normalized)) {
      const inventory = await scanInventory(await targetPathsProvider());
      for (const entry of inventory) {
        if (entry.skillKey === normalized && entry.ignoreRuleId) {
          relatedRuleIds.add(entry.ignoreRuleId);
        }
      }
    }
    await writeIgnoreRules(
      rules.filter(
        (rule) =>
          !(
            rule.scope === "group" &&
            (rule.skillKey === normalized || relatedRuleIds.has(rule.id))
          )
      )
    );
  };

  const setSharedSkillRetention = async ({
    skillKey,
    paths: retainedPaths,
    retained
  }: SharedSkillRetentionInput): Promise<void> => {
    const normalized = normalizeSkillKey(skillKey);
    const pathsToUpdate = new Set(retainedPaths);
    const rules = await readIgnoreRules();
    const nextRules = rules.filter(
      (rule) =>
        !(rule.scope === "location" && rule.path && pathsToUpdate.has(rule.path) && rule.reason === "keep-shared")
    );
    if (retained) {
      const now = new Date().toISOString();
      for (const path of pathsToUpdate) {
        nextRules.push({
          id: `keep-shared-${normalized}-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`,
          scope: "location",
          skillKey: normalized,
          path,
          reason: "keep-shared",
          createdAt: now,
          updatedAt: now
        });
      }
    }
    await writeIgnoreRules(nextRules);
  };

  const githubRequestInit = async (): Promise<RequestInit | undefined> => {
    const token = await authTokenProvider?.();
    if (!token) {
      return undefined;
    }
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    };
  };

  const githubRequestError = async (
    response: Awaited<ReturnType<FetchLike>>,
    url: string
  ) => {
    const detail = await response.text().catch(() => "");
    const rateLimited =
      response.status === 429 ||
      response.headers?.get("x-ratelimit-remaining") === "0" ||
      /rate limit/i.test(detail);
    if (rateLimited) {
      return new Error(`GitHub API rate limit reached (${response.status} ${response.statusText})`);
    }
    return new Error(`GitHub request failed (${response.status} ${response.statusText}): ${url}`);
  };

  const fetchGitHubJson = async (url: string) => {
    const response = await fetchImpl(url, await githubRequestInit());
    if (!response.ok) {
      throw await githubRequestError(response, url);
    }
    return response.json();
  };

  const fetchGitHubText = async (url: string) => {
    const response = await fetchImpl(url, await githubRequestInit());
    if (!response.ok) {
      throw await githubRequestError(response, url);
    }
    return response.text();
  };

  const tryFetchGitHubJson = async <T>(url: string): Promise<T | undefined> => {
    const response = await fetchImpl(url, await githubRequestInit());
    if (response.status === 404 || response.status === 422) {
      return undefined;
    }
    if (!response.ok) {
      throw await githubRequestError(response, url);
    }
    return (await response.json()) as T;
  };

  const resolveGitHubLocation = async (rawUrl: string) => {
    const location = parseGitHubLocation(rawUrl);
    let ref: string;
    let rootPath: string;
    let commit: GitHubCommitResponse | undefined;

    if (location.kind === "repository") {
      const repository = await fetchGitHubJson(
        `https://api.github.com/repos/${location.owner}/${location.repo}`
      ) as GitHubRepositoryResponse;
      if (!repository.default_branch) {
        throw new Error("GitHub repository response is missing a default branch");
      }
      ref = repository.default_branch;
      rootPath = "";
      commit = await tryFetchGitHubJson<GitHubCommitResponse>(
        `https://api.github.com/repos/${location.owner}/${location.repo}/commits/${encodeURIComponent(ref)}`
      );
    } else {
      const segments =
        location.kind === "blob" && location.pathSegments.at(-1) === "SKILL.md"
          ? location.pathSegments.slice(0, -1)
          : location.pathSegments;
      let resolvedLength = 0;
      for (let length = 1; length <= segments.length; length += 1) {
        const candidateRef = segments.slice(0, length).join("/");
        const candidateCommit = await tryFetchGitHubJson<GitHubCommitResponse>(
          `https://api.github.com/repos/${location.owner}/${location.repo}/commits/${encodeURIComponent(candidateRef)}`
        );
        if (candidateCommit?.commit?.tree?.sha) {
          ref = candidateRef;
          commit = candidateCommit;
          resolvedLength = length;
        }
      }
      if (!commit || !resolvedLength) {
        throw new Error("GitHub branch or commit could not be resolved");
      }
      ref = segments.slice(0, resolvedLength).join("/");
      rootPath = segments.slice(resolvedLength).join("/");
    }

    const treeSha = commit?.commit?.tree?.sha;
    if (!treeSha) {
      throw new Error(`GitHub commit could not be resolved: ${ref}`);
    }
    return { ...location, ref, rootPath, treeSha };
  };

  const githubContentsUrl = (source: ParsedGitHubSkillSource, remotePath = source.remotePath) => {
    const encodedPath = encodeGitHubPath(remotePath);
    const contentsPath = encodedPath ? `/contents/${encodedPath}` : "/contents";
    return `https://api.github.com/repos/${source.owner}/${source.repo}${contentsPath}?ref=${encodeURIComponent(source.ref)}`;
  };

  const readGitHubTree = async (source: ParsedGitHubSkillSource, writeRoot?: string) => {
    const revisionHash = createHash("sha1");
    let hasSkillMd = false;

    const walk = async (remotePath: string) => {
      const url = githubContentsUrl(source, remotePath);
      const items = assertGitHubContentItems(await fetchGitHubJson(url), url).sort((a, b) =>
        a.path.localeCompare(b.path)
      );
      for (const item of items) {
        revisionHash.update(`${item.type}:${item.path}:${item.sha}\n`);
        if (item.type === "dir") {
          await walk(item.path);
          continue;
        }
        if (item.type !== "file") {
          continue;
        }
        const relativePath = relativeGitHubPath(source.remotePath, item.path);
        if (relativePath === "SKILL.md") {
          hasSkillMd = true;
        }
        if (!writeRoot) {
          continue;
        }
        if (!item.download_url) {
          throw new Error(`GitHub file is missing a download URL: ${item.path}`);
        }
        const filePath = join(writeRoot, ...relativePath.split("/"));
        await mkdir(dirname(filePath), { recursive: true });
        await writeAtomic(filePath, await fetchGitHubText(item.download_url));
      }
    };

    await walk(source.remotePath);
    return {
      hasSkillMd,
      revision: revisionHash.digest("hex")
    };
  };

  const readGitHubSkillUpdatedAt = async (
    source: ParsedGitHubSkillSource
  ): Promise<string | undefined> => {
    const query = new URLSearchParams({ sha: source.ref, per_page: "1" });
    if (source.remotePath) query.set("path", source.remotePath);
    try {
      const commits = await fetchGitHubJson(
        `https://api.github.com/repos/${source.owner}/${source.repo}/commits?${query.toString()}`
      ) as GitHubCommitResponse[];
      const value = commits[0]?.commit?.committer?.date ?? commits[0]?.commit?.author?.date;
      return value && !Number.isNaN(Date.parse(value))
        ? new Date(value).toISOString()
        : undefined;
    } catch {
      return undefined;
    }
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
    return { source, incoming, conflicts };
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
              source: sourceDir,
              upstream: source.input.upstream ?? { kind: "local", locator: sourceDir }
            }
      );
    }

    if (source.kind === "repository") {
      const tempDir = await mkdtemp(join(tmpdir(), "agentenv-repository-skill-preview-"));
      try {
        const materialized = await requireRepositorySource().materialize(
          source.input,
          tempDir
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
        readGitHubTree(parsedSource, tempDir),
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
    const source = await resolveGitHubLocation(rawUrl);
    const sourceScope = createGitHubSourceScope(rawUrl, source);
    const treeUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(source.treeSha)}?recursive=1`;
    const treeResponse = await fetchGitHubJson(treeUrl) as GitHubTreeResponse;
    const treeItems = (treeResponse.tree ?? []).filter(
      (item): item is { path: string; type: string; sha: string } =>
        typeof item.path === "string" &&
        typeof item.type === "string" &&
        typeof item.sha === "string"
    );
    const skillFiles = treeItems
      .filter(
        (item) =>
          item.type === "blob" &&
          (item.path === "SKILL.md" || item.path.endsWith("/SKILL.md")) &&
          (!source.rootPath ||
            item.path === `${source.rootPath}/SKILL.md` ||
            item.path.startsWith(`${source.rootPath}/`))
      )
      .sort((a, b) => a.path.localeCompare(b.path));
    const directSkillPath = source.rootPath ? `${source.rootPath}/SKILL.md` : "SKILL.md";
    const boundedSkillFiles = skillFiles.some((item) => item.path === directSkillPath)
      ? skillFiles.filter((item) => item.path === directSkillPath)
      : skillFiles.filter((item, index, items) => {
          const candidateDir = dirname(item.path) === "." ? "" : dirname(item.path);
          return !items.slice(0, index).some((parent) => {
            const parentDir = dirname(parent.path) === "." ? "" : dirname(parent.path);
            return parentDir && candidateDir.startsWith(`${parentDir}/`);
          });
        });
    const existingSkills = await listSkills();
    const candidates: GitHubSkillCandidate[] = [];

    for (const skillFile of boundedSkillFiles.slice(0, 500)) {
      const remotePath = dirname(skillFile.path) === "." ? "" : dirname(skillFile.path);
      const sourceUrl = githubSkillSourceUrl(
        source.owner,
        source.repo,
        source.ref,
        remotePath
      );
      const rawSkillUrl = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${encodeURIComponent(source.ref)}/${encodeGitHubPath(skillFile.path)}`;
      const content = await fetchGitHubText(rawSkillUrl);
      const revisionEntries = treeItems
        .filter((item): item is { path: string; type: "blob" | "tree"; sha: string } =>
          item.type === "blob" || item.type === "tree");
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
      candidates.push({
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
      });
    }

    const result: GitHubSkillScanResult = {
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      rootPath: source.rootPath,
      sourceScope,
      truncated: Boolean(treeResponse.truncated) || boundedSkillFiles.length > 500,
      candidates
    };
    await skillSourceService.recordGitHubScan(sourceScope, result);
    return result;
  };

  const ownedLibraryId = async (skillDir: string) => {
    const skillStats = await lstat(skillDir).catch(() => undefined);
    const marker = await readJsonIfExists<Record<string, unknown>>(
      skillStats?.isSymbolicLink() ? markerPathForFile(skillDir) : markerPathFor(skillDir)
    );
    if (
      marker?.owner === "agentenv-manager" &&
      marker.kind === "skill" &&
      typeof marker.source === "string" &&
      marker.source.startsWith("skills-library/")
    ) {
      return marker.source.slice("skills-library/".length);
    }
    return undefined;
  };

  const scanInventory = async (
    targetPaths: TargetPaths[],
    knownLibrarySkills?: SkillLibraryEntry[]
  ): Promise<SkillInventoryEntry[]> => {
    const librarySkills = knownLibrarySkills ?? await listSkills();
    const libraryIds = new Set(librarySkills.map((skill) => skill.id));
    const libraryById = new Map(librarySkills.map((skill) => [skill.id, skill]));
    const libraryBySkillKey = new Map<string, SkillLibraryEntry[]>();
    for (const skill of librarySkills) {
      const key = normalizeSkillKey(skill.name || skill.id);
      libraryBySkillKey.set(key, [...(libraryBySkillKey.get(key) ?? []), skill]);
    }
    const ignoreRules = await readIgnoreRules();
    const skillsCliEvidence = (
      await inspectSkillsCliLocks(paths.homeDir, options.skillsCliLockPaths)
    ).evidenceBySkillKey;
    const byKey = new Map<string, SkillInventoryEntry>();
    const snapshots = await Promise.all(targetPaths.map(async (target) => ({
      target,
      snapshot: await runtimeSnapshotProvider(target)
    })));
    for (const { target, snapshot } of snapshots) {
      for (const observation of snapshot.observations) {
        const deploymentName = observation.deploymentName;
        const skillDir = observation.path;
        const deploymentKey = normalizeSkillKey(deploymentName);
        const skillKey = normalizeSkillKey(observation.runtimeName);
        const evidence = skillsCliEvidence.get(skillKey) ?? skillsCliEvidence.get(deploymentKey);
        const location = target.skillLocations?.find(
          (item) => resolve(item.path) === resolve(observation.locationPath)
        );
        const unreadable = observation.issues.some((issue) => issue.code === "unreadable-skill");
        if (unreadable) {
          const ignoreRule = findIgnoreRule(ignoreRules, { skillKey, path: skillDir });
          const externalOwnership = evidence
            ? { ...evidence, confidence: "confirmed" as const, state: "broken-link" as const }
            : observation.externalOwnership;
          const status = ignoreRule ? "ignored" : externalOwnership ? "external" : "unmanaged";
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
            foundIn: [target.targetId],
            status,
            libraryId: libraryIds.has(deploymentName) ? deploymentName : undefined,
            skillKey,
            runtimeName: observation.runtimeName,
            deploymentName,
            runtimeScope: observation.scope,
            runtimeOwner: externalOwnership ? "external" : observation.owner,
            managedByTarget: false,
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
            ignoreRuleId: ignoreRule?.id,
            ignoreReason: ignoreRule?.reason,
            locationRole: observation.locationRole,
            sharedLocation: observation.shared,
            legacyLocation: observation.legacy,
            externalOwnership
          });
          continue;
        }

        const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
        const frontmatter = parseSkillFrontmatter(content);
        const ownedId = await ownedLibraryId(skillDir);
        const markerId = ownedId && libraryIds.has(ownedId) ? ownedId : undefined;
        const agentEnvOwned = await isAgentEnvOwnedDir(skillDir, {
          targetId: target.targetId,
          kind: "skill"
        });
        const managedByAgentEnv = agentEnvOwned || Boolean(markerId);
        const ignoreRule =
          findIgnoreRule(ignoreRules, { skillKey, path: skillDir }) ??
          (skillKey !== deploymentKey
            ? findIgnoreRule(ignoreRules, { skillKey: deploymentKey, path: skillDir })
            : undefined);
        let externalOwnership = managedByAgentEnv
          ? undefined
          : evidence ?? observation.externalOwnership;
        if (externalOwnership) {
          let confidence = externalOwnership.confidence;
          try {
            if (
              skillDir === externalOwnership.canonicalPath ||
              (await realpath(skillDir)) === (await realpath(externalOwnership.canonicalPath))
            ) {
              confidence = "confirmed";
            }
          } catch {
            // The lock is still useful evidence when its canonical copy is unavailable.
          }
          externalOwnership = { ...externalOwnership, confidence, state: "healthy" };
        }
        const contentHash = await computeContentHash(skillDir);
        const externalLibraryId = externalOwnership
          ? librarySkills.find((skill) => skill.contentHash === contentHash)?.id
          : undefined;
        const runtimeLibraryCandidates = libraryBySkillKey.get(skillKey) ?? [];
        const runtimeLibraryId =
          runtimeLibraryCandidates.find((skill) => skill.contentHash === contentHash)?.id ??
          (runtimeLibraryCandidates.length === 1 ? runtimeLibraryCandidates[0].id : undefined);
        const localLibraryId = libraryIds.has(deploymentName)
          ? deploymentName
          : runtimeLibraryId;
        const status = managedByAgentEnv
          ? "managed"
          : ignoreRule
            ? "ignored"
            : externalOwnership
              ? "external"
              : localLibraryId
                ? "library"
                : "unmanaged";
        const libraryId = markerId ?? externalLibraryId ?? localLibraryId;
        const key = `${status}:${libraryId ?? deploymentName}:${skillDir}`;
        const existing = byKey.get(key);
        if (existing) {
          mergeInventoryLocation(existing, target.targetId, location, observation);
          continue;
        }
        const skillDirStats = await lstat(skillDir);
        const skillFileStats = await lstat(join(skillDir, "SKILL.md"));
        byKey.set(key, {
          id: deploymentName,
          name: observation.runtimeName,
          description: frontmatter.description,
          path: skillDir,
          foundIn: [target.targetId],
          status,
          libraryId,
          skillKey,
          runtimeName: observation.runtimeName,
          deploymentName,
          runtimeScope: observation.scope,
          runtimeOwner: managedByAgentEnv
            ? "agentenv"
            : externalOwnership
              ? "external"
              : observation.owner,
          managedByTarget: agentEnvOwned,
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
          ignoreRuleId: ignoreRule?.id,
          ignoreReason: ignoreRule?.reason,
          installMethod: managedByAgentEnv
            ? skillDirStats.isSymbolicLink() || skillFileStats.isSymbolicLink()
              ? "linked"
              : "copied"
            : undefined,
          contentMatchesLibrary: markerId
            ? libraryById.get(markerId)?.contentHash === contentHash
            : libraryId
              ? libraryById.get(libraryId)?.contentHash === contentHash
              : undefined,
          externalOwnership,
          locationRole: observation.locationRole,
          sharedLocation: observation.shared,
          legacyLocation: observation.legacy
        });
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const findManagedInstallPaths = async (
    libraryId: string,
    targetPaths: TargetPaths[]
  ): Promise<string[]> => {
    const safeId = SafeIdSchema.parse(libraryId);
    const matches = new Set<string>();
    for (const target of targetPaths) {
      const scanRoots = [
        ...new Set([target.skillsDir, ...(target.skillScanDirs ?? [])].filter(Boolean))
      ];
      for (const scanRoot of scanRoots) {
        if (!scanRoot || !(await pathExists(scanRoot))) {
          continue;
        }
        const entries = await readdir(scanRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".")) {
            continue;
          }
          const skillDir = join(scanRoot, entry.name);
          if ((await ownedLibraryId(skillDir)) === safeId) {
            matches.add(skillDir);
          }
        }
      }
    }
    return [...matches].sort();
  };

  const scanUnmanaged = async (targetPaths: TargetPaths[]) => {
    const inventory = await scanInventory(targetPaths);
    return inventory
      .filter((skill) => skill.status === "unmanaged")
      .map(({ id, name, description, path, foundIn }) => ({
        id,
        name,
        description,
        path,
        foundIn
      }));
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
    conflictResolution
  }: ImportSkillStoreInput): Promise<SkillLibraryEntry> => {
    if (!(await pathExists(join(sourcePath, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${sourcePath}`);
    }
    await validateSkillFrontmatter(sourcePath);
    const preview = await previewImport({
      kind: "local",
      input: { sourcePath, id, provenance, upstream }
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
    if (plan.sourceOnly) {
      await writeMetadata(targetDir, {
        sourceType: githubSource ? "github" : sourceType,
        source: githubSource?.sourceUrl ?? sourcePath,
        remoteRef: githubSource?.ref,
        remotePath: githubSource?.remotePath,
        remoteRevision: githubSource ? upstream?.revision : undefined,
        updatePolicy: githubSource ? "tracked" : "untracked",
        iconKey: previousMetadata?.iconKey,
        globallyEnabled: previousMetadata?.globallyEnabled,
        upstream: upstream ?? { kind: "local", locator: sourcePath },
        provenance: provenance ?? previousMetadata?.provenance ?? { importedVia: "agentenv" }
      });
      return entryFor(plan.id, targetDir);
    }
    const backup = plan.replace ? await createLibraryUpdateBackup(plan.id, targetDir) : undefined;
    try {
      await removeAndCopy(sourcePath, targetDir);
    } catch (error) {
      if (backup) return failAfterCleanupRollback(backup, `Replacing ${plan.id}`, error);
      throw error;
    }
    try {
      await writeMetadata(targetDir, {
        sourceType: githubSource ? "github" : sourceType,
        source: githubSource?.sourceUrl ?? sourcePath,
        remoteRef: githubSource?.ref,
        remotePath: githubSource?.remotePath,
        remoteRevision: githubSource ? upstream?.revision : undefined,
        updatePolicy: githubSource ? "tracked" : "untracked",
        iconKey: previousMetadata?.iconKey,
        globallyEnabled: previousMetadata?.globallyEnabled,
        upstream: upstream ?? {
          kind: "local",
          locator: sourcePath
        },
        provenance: provenance ?? { importedVia: "agentenv" }
      });
      return entryFor(plan.id, targetDir);
    } catch (error) {
      if (backup) return failAfterCleanupRollback(backup, `Replacing ${plan.id}`, error);
      await rm(targetDir, { recursive: true, force: true });
      throw error;
    }
  };

  const cleanupBackupRoot = () => join(paths.backupsDir, "skill-cleanup");

  const trustedSkillRoots = async (): Promise<string[]> => {
    const targetRoots = targetPathsProvider().flatMap((target) => [
      target.skillsDir,
      ...(target.skillScanDirs ?? []),
      ...(target.skillLocations ?? []).map((location) => location.path)
    ]);
    return [
      await libraryDir(),
      paths.profilesDir,
      paths.userSkillsDir,
      ...targetRoots
    ]
      .filter((path): path is string => Boolean(path))
      .map((path) => resolve(path))
      .filter((path, index, roots) => roots.indexOf(path) === index);
  };

  const readCleanupBackup = async (backupId: string) => {
    const safeId = SafeIdSchema.parse(backupId);
    const backupDir = join(cleanupBackupRoot(), safeId);
    const manifest = JSON.parse(
      await readFile(join(backupDir, "manifest.json"), "utf8")
    ) as SkillCleanupBackupManifest;
    const safeLibraryId = SafeIdSchema.parse(manifest.libraryId);
    if (manifest.id !== safeId || !Array.isArray(manifest.entries)) {
      throw new Error(`Invalid Skill cleanup backup: ${safeId}`);
    }
    const allowedRoots = await trustedSkillRoots();
    const backupLocationsRoot = resolve(backupDir, "locations");
    const seenBackupPaths = new Set<string>();
    for (const entry of manifest.entries) {
      if (
        !entry ||
        typeof entry.sourcePath !== "string" ||
        typeof entry.backupPath !== "string"
      ) {
        throw new Error(`Invalid Skill cleanup backup entry: ${safeId}`);
      }
      const sourcePath = resolve(entry.sourcePath);
      const backupPath = resolve(entry.backupPath);
      const sourceAllowed = allowedRoots.some(
        (root) => dirname(sourcePath) === root && relative(root, sourcePath).length > 0
      );
      const backupAllowed = relative(backupLocationsRoot, backupPath);
      const backupNameMatch = basename(backupPath).match(/^\d+-(.+)$/);
      if (
        !sourceAllowed ||
        dirname(backupPath) !== backupLocationsRoot ||
        backupNameMatch?.[1] !== basename(sourcePath) ||
        seenBackupPaths.has(backupPath) ||
        backupAllowed.startsWith("..") ||
        backupAllowed.includes("/../")
      ) {
        throw new Error(`Skill cleanup backup contains an unsafe path: ${safeId}`);
      }
      seenBackupPaths.add(backupPath);
    }
    if (manifest.libraryBackupPath) {
      const expected = resolve(backupDir, "library", safeLibraryId);
      if (resolve(manifest.libraryBackupPath) !== expected) {
        throw new Error(`Skill cleanup backup contains an unsafe Library path: ${safeId}`);
      }
    }
    return { backupDir, manifest };
  };

  const listCleanupBackups = async (): Promise<SkillCleanupBackupSummary[]> => {
    let entries: string[];
    try {
      entries = await readdir(cleanupBackupRoot());
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const summaries = await Promise.all(
      entries.map(async (entry): Promise<SkillCleanupBackupSummary | undefined> => {
        try {
          const { manifest } = await readCleanupBackup(entry);
          return {
            id: manifest.id,
            libraryId: manifest.libraryId,
            createdAt: manifest.createdAt,
            locationCount:
              manifest.operation === "update"
                ? 1
                : manifest.entries.filter(
                    (item) => !item.sourcePath.endsWith(".agentenv-owner.json")
                  ).length,
            operation: manifest.operation
          };
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return undefined;
          }
          throw error;
        }
      })
    );

    return summaries
      .filter((item): item is SkillCleanupBackupSummary => Boolean(item))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  };

  const restoreCleanupBackup = async (manifest: SkillCleanupBackupManifest) => {
    const failures: string[] = [];
    const attempt = async (label: string, operation: () => Promise<void>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const backedUpPaths = new Set(manifest.entries.map((entry) => resolve(entry.sourcePath)));
    for (const entry of manifest.entries) {
      if (entry.sourcePath.endsWith(".agentenv-owner.json")) continue;
      const markerPath = markerPathForFile(entry.sourcePath);
      if (!backedUpPaths.has(resolve(markerPath))) {
        await attempt(`remove marker ${markerPath}`, () => rm(markerPath, { force: true }));
      }
    }
    for (const entry of manifest.entries) {
      await attempt(`restore ${entry.sourcePath}`, () =>
        replacePathWithCopy(entry.backupPath, entry.sourcePath, {
          dereference: false
        })
      );
    }
    if (manifest.libraryCreated) {
      const createdLibraryPath = join(await libraryDir(), manifest.libraryId);
      await attempt(`remove created Library copy ${createdLibraryPath}`, () =>
        rm(createdLibraryPath, { recursive: true, force: true })
      );
    }
    if (manifest.libraryRemoved && manifest.libraryBackupPath) {
      const targetLibraryDir = join(await libraryDir(), manifest.libraryId);
      await attempt(`restore Library copy ${targetLibraryDir}`, () =>
        replacePathWithCopy(manifest.libraryBackupPath!, targetLibraryDir, {
          dereference: false
        })
      );
    }
    if (failures.length > 0) {
      throw new Error(`Backup ${manifest.id} could not restore every path: ${failures.join("; ")}`);
    }
  };

  const failAfterCleanupRollback = async (
    manifest: SkillCleanupBackupManifest,
    label: string,
    operationError: unknown
  ): Promise<never> => {
    const operationMessage = operationError instanceof Error
      ? operationError.message
      : String(operationError);
    try {
      await restoreCleanupBackup(manifest);
    } catch (rollbackError) {
      throw new Error(
        `${label} failed: ${operationMessage}. Rollback incomplete: ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`
      );
    }
    throw new Error(`${label} failed and was rolled back: ${operationMessage}`);
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
    await cp(targetLibraryDir, libraryBackupPath, { recursive: true, dereference: false });

    for (const [index, sourcePath] of protectedInstallPaths.entries()) {
      if (!(await pathEntryExists(sourcePath))) {
        continue;
      }
      const backupPath = join(backupDir, "locations", `${index}-${basename(sourcePath)}`);
      await mkdir(dirname(backupPath), { recursive: true });
      await cp(sourcePath, backupPath, { recursive: true, dereference: false });
      entries.push({ sourcePath, backupPath });
    }

    const manifest: SkillCleanupBackupManifest = {
      id: backupId,
      libraryId: safeId,
      libraryCreated: false,
      libraryRemoved: true,
      libraryBackupPath,
      operation: "remove",
      createdAt: new Date().toISOString(),
      entries
    };
    await writeAtomic(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    try {
      for (const sourcePath of uniqueInstallPaths) {
        await removeSkillDeployment(sourcePath);
      }
      await rm(targetLibraryDir, { recursive: true, force: true });
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
        readGitHubTree(source, tempDir),
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
        return entryFor(plan.id, targetDir);
      }
      const backup = plan.replace ? await createLibraryUpdateBackup(plan.id, targetDir) : undefined;
      try {
        await removeAndCopy(tempDir, targetDir);
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
          provenance: { importedVia: "agentenv" },
          sourceCollection: validatedSourceCollection
        });
        return entryFor(plan.id, targetDir);
      } catch (error) {
        if (backup) return failAfterCleanupRollback(backup, `Replacing ${plan.id}`, error);
        await rm(targetDir, { recursive: true, force: true });
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
    const result = await requireRepositorySource().scan(input);
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
      const materialized = await requireRepositorySource().materialize(input, tempDir);
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
        await writeMetadata(targetDir, metadata);
        return entryFor(plan.id, targetDir);
      }

      const backup = plan.replace
        ? await createLibraryUpdateBackup(plan.id, targetDir)
        : undefined;
      try {
        await removeAndCopy(tempDir, targetDir);
        await writeMetadata(targetDir, metadata);
        return entryFor(plan.id, targetDir);
      } catch (error) {
        if (backup) return failAfterCleanupRollback(backup, `Replacing ${plan.id}`, error);
        await rm(targetDir, { recursive: true, force: true });
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

  const { listSourceGroups, checkSourceGroup, checkAllSourceGroups, setSourceName } =
    createSkillSourceGroupStore(skillSourceService, listSkills, skillSourceRegistry);
  const { preview: previewSourceMerge, merge: mergeSources } = createSkillSourceMergeService({
    appDataRoot: paths.appDataRoot,
    repositorySource,
    sourceRegistry: skillSourceRegistry,
    sourceService: skillSourceService,
    listSkills,
    listSourceGroups
  });

  const deployLibrarySkill = async ({
    targetPaths,
    targetName,
    libraryId,
    profileId
  }: DeployLibrarySkillStoreInput): Promise<void> => {
    if (!targetPaths.skillsDir) {
      throw new Error("Agent does not expose a Skills directory");
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(targetName)) {
      throw new Error(`Invalid target skill name: ${targetName}`);
    }

    const safeLibraryId = SafeIdSchema.parse(libraryId);
    const sourceDir = join(await libraryDir(), safeLibraryId);
    if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeLibraryId}`);
    }

    const targetDir = join(targetPaths.skillsDir, targetName);
    const settings = await readSettings();
    await deploySkillDirectory({
      sourceDir,
      targetDir,
      syncMethod: settings.skillSyncMethod,
      markerContent: createOwnerMarkerContent({
        profileId,
        targetId: targetPaths.targetId,
        kind: "skill",
        source: `skills-library/${safeLibraryId}`
      })
    });
  };

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
    for (const [index, sourcePath] of [targetDir, markerPathForFile(targetDir)].entries()) {
      if (!(await pathEntryExists(sourcePath))) continue;
      const backupPath = join(backupDir, "locations", `${index}-${basename(sourcePath)}`);
      await mkdir(dirname(backupPath), { recursive: true });
      await cp(sourcePath, backupPath, { recursive: true, dereference: false });
      entries.push({ sourcePath, backupPath });
    }
    const manifest: SkillCleanupBackupManifest = {
      id: backupId,
      libraryId: SafeIdSchema.parse(input.libraryId),
      libraryCreated: false,
      operation: "cleanup",
      createdAt: new Date().toISOString(),
      entries
    };
    await writeAtomic(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    try {
      await deployLibrarySkill({ ...input, profileId: "library-management" });
    } catch (error) {
      return failAfterCleanupRollback(
        manifest,
        `Managing ${input.targetName} for ${input.targetPaths.targetId}`,
        error
      );
    }
  };

  const replaceTargetSkill = async ({
    libraryId,
    targetDir,
    targetId
  }: {
    libraryId: string;
    targetDir: string;
    targetId: string;
  }) => {
    const sourceDir = join(await libraryDir(), libraryId);
    const settings = await readSettings();
    await deploySkillDirectory({
      sourceDir,
      targetDir,
      syncMethod: settings.skillSyncMethod,
      markerContent: createOwnerMarkerContent({
        profileId: "library-cleanup",
        targetId,
        kind: "skill",
        source: `skills-library/${libraryId}`
      })
    });
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

    const backupId = `merge-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const protectedPaths = [
      ...requestedIds.map((id) => skillsById.get(id)!.path),
      ...affectedProfiles.map((profile) => profile.profileDir ?? join(paths.profilesDir, profile.id)),
      ...affectedInstalls.flatMap((install) => [install.path, markerPathForFile(install.path)])
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
      await cp(sourcePath, backupPath, { recursive: true, dereference: false });
      entries.push({ sourcePath, backupPath });
    }
    const manifest: SkillCleanupBackupManifest = {
      id: backupId,
      libraryId: keepId,
      libraryCreated: false,
      operation: "merge",
      createdAt: new Date().toISOString(),
      entries
    };
    await writeAtomic(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    try {
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

      for (const profile of affectedProfiles) {
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
          resources: { ...profile.resources, skills: nextReferences }
        });
      }
      for (const install of affectedInstalls) {
        await replaceTargetSkill({
          libraryId: keepId,
          targetDir: install.path,
          targetId: install.foundIn[0]
        });
      }
      for (const removedId of removedIds) {
        await rm(skillsById.get(removedId)!.path, { recursive: true, force: true });
      }
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
    const backupId = `cleanup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const entries: SkillCleanupBackupManifest["entries"] = [];
    const libraryBackupPath = replaceLibrary
      ? join(backupDir, "library", safeLibraryId)
      : undefined;
    await mkdir(backupDir, { recursive: true });

    if (libraryBackupPath) {
      await mkdir(dirname(libraryBackupPath), { recursive: true });
      await cp(targetLibraryDir, libraryBackupPath, { recursive: true, dereference: false });
    }

    for (const [index, location] of uniqueLocations.entries()) {
      if (!(await pathExists(join(location.targetDir, "SKILL.md")))) {
        throw new Error(`Skill cleanup location is missing SKILL.md: ${location.targetDir}`);
      }
      const backupPath = join(backupDir, "locations", `${index}-${basename(location.targetDir)}`);
      await mkdir(dirname(backupPath), { recursive: true });
      await cp(location.targetDir, backupPath, { recursive: true, dereference: false });
      entries.push({ sourcePath: location.targetDir, backupPath });
      const markerPath = markerPathForFile(location.targetDir);
      if (await pathEntryExists(markerPath)) {
        const markerBackupPath = `${backupPath}.agentenv-owner.json`;
        await cp(markerPath, markerBackupPath, { dereference: false });
        entries.push({ sourcePath: markerPath, backupPath: markerBackupPath });
      }
    }

    const manifest: SkillCleanupBackupManifest = {
      id: backupId,
      libraryId: safeLibraryId,
      libraryCreated,
      libraryRemoved: replaceLibrary,
      libraryBackupPath,
      createdAt: new Date().toISOString(),
      operation: "cleanup",
      entries
    };
    await writeAtomic(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    try {
      if (libraryCreated || replaceLibrary) {
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
      }
      for (const location of uniqueLocations) {
        await replaceTargetSkill({
          libraryId: safeLibraryId,
          targetDir: location.targetDir,
          targetId: location.targetPaths.targetId
        });
      }
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
      backupRoot: cleanupBackupRoot()
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
    if (!affectedPaths.includes(canonicalPath)) {
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

    if (libraryBackupPath) {
      await mkdir(dirname(libraryBackupPath), { recursive: true });
      await cp(targetLibraryDir, libraryBackupPath, { recursive: true, dereference: false });
    }

    for (const [index, sourcePath] of affectedPaths.entries()) {
      const backupPath = join(backupDir, "locations", `${index}-${basename(sourcePath)}`);
      await mkdir(dirname(backupPath), { recursive: true });
      await cp(sourcePath, backupPath, { recursive: true, dereference: false });
      entries.push({ sourcePath, backupPath });
      const markerPath = markerPathForFile(sourcePath);
      if (await pathEntryExists(markerPath)) {
        const markerBackupPath = `${backupPath}.agentenv-owner.json`;
        await cp(markerPath, markerBackupPath, { dereference: false });
        entries.push({ sourcePath: markerPath, backupPath: markerBackupPath });
      }
    }

    const manifest: SkillCleanupBackupManifest = {
      id: backupId,
      libraryId: safeLibraryId,
      libraryCreated,
      libraryRemoved: replaceLibrary,
      libraryBackupPath,
      createdAt: new Date().toISOString(),
      operation: "cleanup",
      entries
    };
    await writeAtomic(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    try {
      if (libraryCreated || replaceLibrary) {
        await removeAndCopy(canonicalPath, targetLibraryDir);
        await writeMetadata(targetLibraryDir, {
          sourceType: "local",
          source: canonicalPath,
          updatePolicy: "untracked",
          upstream: { kind: "local", locator: canonicalPath },
          provenance: { importedVia: "local-scan" }
        });
      }
      for (const sharedPath of uniqueSharedPaths) {
        await removeAndCopy(targetLibraryDir, sharedPath);
        await rm(join(sharedPath, ".agentenv-skill.json"), { force: true });
        await rm(join(sharedPath, ".agentenv-owner.json"), { force: true });
        await rm(markerPathForFile(sharedPath), { force: true });
      }
      for (const duplicatePath of uniqueDuplicatePaths) {
        await removeSkillDeployment(duplicatePath);
      }
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
    await restoreCleanupBackup(manifest);
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
    return Promise.all(selectedSkills.map(async (skill): Promise<SkillUpdateInfo> => {
      const metadata = await readLibraryMetadata(skill.path);
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
          });
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
        const [latest, latestUpdatedAt] = await Promise.all([
          readGitHubTree(source),
          readGitHubSkillUpdatedAt(source)
        ]);
        return {
          id: skill.id,
          name: skill.name,
          sourceType: "github",
          currentRevision: metadata.remoteRevision,
          latestRevision: latest.revision,
          latestUpdatedAt,
          updateAvailable: latest.revision !== metadata.remoteRevision
        };
      } catch (error) {
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
  };

  const setUpdateSource = async ({
    id,
    sourceType,
    source,
    ref,
    directory
  }: SkillUpdateSourceInput): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
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
      await writeMetadata(targetDir, {
        sourceType: "github",
        source: githubSource.sourceUrl,
        remoteRef: githubSource.ref,
        remotePath: githubSource.remotePath,
        updatePolicy: "tracked",
        upstream: {
          kind: "github",
          locator: githubSource.sourceUrl,
          ref: githubSource.ref,
          subpath: githubSource.remotePath
        },
        sourceCollection
      });
      return entryFor(safeId, targetDir);
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
        await writeMetadata(targetDir, {
          sourceType: "git",
          source: materialized.repository,
          remoteRef: materialized.ref,
          remotePath: materialized.directory,
          remoteRevision: materialized.contentRevision,
          updatePolicy: "tracked",
          upstream: materialized.upstream,
          sourceCollection
        });
        return entryFor(safeId, targetDir);
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
    await writeMetadata(targetDir, {
      sourceType: "local",
      source,
      updatePolicy: "tracked",
      upstream: { kind: "local", locator: source },
      sourceCollection: null
    });
    return entryFor(safeId, targetDir);
  };

  const setUpdatePolicy = async ({
    id,
    policy
  }: SkillUpdatePolicyInput): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const metadata = await readLibraryMetadata(targetDir);
    const sourceType = metadata.sourceType ?? "local";
    if (policy === "tracked") {
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
      updatePolicy: policy
    });
    return entryFor(safeId, targetDir);
  };

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
    const inventory = await scanInventory(targetPathsProvider(), await listSkills());
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

  const previewUpdate = async (id: string): Promise<SkillUpdatePlan> => {
    await discardExpiredPendingUpdates();
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const skill = await entryFor(safeId, targetDir);
    const metadata = await readLibraryMetadata(targetDir);
    const impact = await skillUpdateImpact(safeId);
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
      const changes = await createSkillChanges(targetDir, candidateDir);
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
      pendingUpdates.set(previewId, {
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
          readGitHubTree(source, candidateDir),
          readGitHubSkillUpdatedAt(source)
        ]);
        if (!hasSkillMd) {
          throw new Error(`GitHub skill source is missing SKILL.md: ${metadata.source}`);
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
        if (![...pendingUpdates.values()].some((pending) => pending.candidateDir === candidateDir)) {
          await rm(candidateDir, { recursive: true, force: true });
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
          candidateDir
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
        if (![...pendingUpdates.values()].some((pending) => pending.candidateDir === candidateDir)) {
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
        updatePolicy: "tracked",
        upstream: metadata.upstream ?? { kind: "local", locator: metadata.source }
      }, sourceHashAfterCopy);
    } catch (error) {
      if (![...pendingUpdates.values()].some((pending) => pending.candidateDir === candidateDir)) {
        await rm(candidateDir, { recursive: true, force: true });
      }
      throw error;
    }
  };

  const createLibraryUpdateBackup = async (
    libraryId: string,
    targetLibraryDir: string
  ): Promise<SkillCleanupBackupManifest> => {
    const backupId = `update-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const libraryBackupPath = join(backupDir, "library", libraryId);
    await mkdir(dirname(libraryBackupPath), { recursive: true });
    await cp(targetLibraryDir, libraryBackupPath, {
      recursive: true,
      dereference: false
    });
    const manifest: SkillCleanupBackupManifest = {
      id: backupId,
      libraryId,
      libraryCreated: false,
      libraryRemoved: true,
      libraryBackupPath,
      operation: "update",
      createdAt: new Date().toISOString(),
      entries: []
    };
    await writeAtomic(
      join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    return manifest;
  };

  const updateSkill = async ({
    id,
    previewId
  }: SkillUpdateConfirmation): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const pending = pendingUpdates.get(String(previewId));
    if (!pending || pending.id !== safeId) {
      throw new Error("Skill update preview is unavailable; review the update again");
    }
    if (Date.now() - pending.createdAt > SKILL_UPDATE_PREVIEW_TTL_MS) {
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

    const backup = await createLibraryUpdateBackup(safeId, targetDir);
    try {
      await removeAndCopy(pending.candidateDir, targetDir);
      await writeMetadata(targetDir, pending.nextMetadata);
      const updated = await entryFor(safeId, targetDir);
      if (await computeContentHash(targetDir) !== pending.candidateContentHash) {
        throw new Error("The updated Library copy did not match the reviewed candidate");
      }
      await discardPendingUpdatesForSkill(safeId);
      return updated;
    } catch (error) {
      await restoreCleanupBackup(backup);
      throw new Error(
        `Updating ${safeId} failed and restored the previous Library version: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  return {
    listSkills,
    scanInventory,
    findManagedInstallPaths,
    listCleanupBackups,
    ignoreSkillGroup,
    unignoreSkillGroup,
    scanUnmanaged,
    previewImport,
    previewMerge,
    mergeSkills,
    importSkill,
    importGitHubSkill,
    scanGitHubSkills,
    importGitHubSkills,
    scanRepositorySkills,
    importRepositorySkill,
    importRepositorySkills,
    listSourceGroups,
    checkSourceGroup,
    checkAllSourceGroups,
    setSourceName,
    previewSourceMerge,
    mergeSources,
    removeSkill,
    manageTargetSkill,
    deployLibrarySkill,
    consolidateSkillGroup,
    removeUnavailableSkillLinks,
    consolidateSharedSkillGroup,
    setSharedSkillRetention,
    rollbackSkillCleanup,
    deleteCleanupBackup,
    checkUpdates,
    setUpdateSource,
    setUpdatePolicy,
    setAvailability,
    setIcon,
    previewUpdate,
    updateSkill
  };
};
