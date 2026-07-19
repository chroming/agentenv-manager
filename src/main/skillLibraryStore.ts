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
  PlannedFileChange,
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
  SkillUpdatePolicy,
  SkillUpdatePolicyInput,
  SkillUpdatePlan,
  SkillUpdateSourceInput,
  TargetSkillLocationRole,
  TargetPaths,
  UnmanagedSkillEntry,
  SharedSkillRetentionInput
} from "../shared/types";
import { createUnifiedDiff } from "./diff";
import { pathEntryExists, pathExists, replacePathAtomically, replacePathWithCopy, writeAtomic } from "./fileUtils";
import { createOwnerMarkerContent, markerPathFor, markerPathForFile } from "./ownershipMarkers";
import type { AgentEnvPaths } from "./paths";
import type { ProfileStore } from "./profileStore";
import { resolveSkillsLibraryDir, type SettingsStore } from "./settingsStore";
import { parseSkillFrontmatter } from "./skillFrontmatter";
import { inspectSkillsCliLocks } from "./skillsCliInspector";
import { deploySkillDirectory, removeSkillDeployment } from "./skillDeployment";
import { createTargetRegistry } from "./targets/registry";
import type { GitCliSkillSource } from "./skillSources/contract";
import { parseRepositoryLocation } from "./skillSources/repositoryLocation";

interface SkillMetadataFile {
  sourceType?: SkillSourceType;
  source?: string;
  remoteRef?: string;
  remotePath?: string;
  remoteRevision?: string;
  updateCheckEnabled?: boolean;
  updatePolicy?: SkillUpdatePolicy;
  globallyEnabled?: boolean;
  iconKey?: ResourceIconKey;
  contentHash?: string;
  updatedAt?: string;
  upstream?: SkillUpstream;
  provenance?: SkillProvenance;
}

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
  location: { role: TargetSkillLocationRole; shared: boolean } | undefined
): void => {
  const replacesLocation =
    skillLocationAuthority(location?.role, location?.shared) >
    skillLocationAuthority(entry.locationRole, entry.sharedLocation);

  if (replacesLocation) {
    entry.locationRole = location?.role;
    entry.sharedLocation = location?.shared;
    entry.foundIn = [targetId, ...entry.foundIn.filter((item) => item !== targetId)];
    return;
  }
  if (!entry.foundIn.includes(targetId)) {
    entry.foundIn.push(targetId);
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
  removeSkill(id: string, managedInstallPaths?: string[]): Promise<SkillCleanupResult>;
  manageTargetSkill(input: ManageTargetSkillStoreInput): Promise<void>;
  deployLibrarySkill(input: DeployLibrarySkillStoreInput): Promise<void>;
  consolidateSkillGroup(input: ConsolidateSkillGroupStoreInput): Promise<SkillCleanupResult>;
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
  updateSkill(id: string): Promise<SkillLibraryEntry>;
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
  repositorySource?: GitCliSkillSource;
}

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
  commit?: { tree?: { sha?: string } };
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

export const normalizeSkillKey = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

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

const hashPath = async (
  path: string,
  hash = createHash("sha256"),
  ancestorPaths = new Set<string>()
) => {
  const canonicalPath = await realpath(path);
  if (ancestorPaths.has(canonicalPath)) {
    throw new Error(`Skill contains a symbolic link cycle: ${path}`);
  }
  const nextAncestors = new Set(ancestorPaths).add(canonicalPath);
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".agentenv-skill.json" || entry.name === ".agentenv-owner.json") {
      continue;
    }
    const child = join(path, entry.name);
    hash.update(entry.name);
    const childStats = entry.isSymbolicLink() ? await stat(child) : undefined;
    if (entry.isDirectory() || childStats?.isDirectory()) {
      await hashPath(child, hash, nextAncestors);
    } else if (entry.isFile() || childStats?.isFile()) {
      hash.update(await readFile(child));
    }
  }
  return hash;
};

const computeContentHash = async (path: string) => (await hashPath(path)).digest("hex");

const validateSkillFrontmatter = async (skillDir: string) => {
  const frontmatter = parseSkillFrontmatter(await readFile(join(skillDir, "SKILL.md"), "utf8"));
  if (frontmatter.errors.length > 0) {
    throw new Error(`Skill frontmatter is invalid: ${frontmatter.errors.join("; ")}`);
  }
  return frontmatter;
};

const readSkillFiles = async (root: string) => {
  const files = new Map<string, string>();

  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".agentenv-skill.json") {
        continue;
      }
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      files.set(relative(root, child), await readFile(child, "utf8"));
    }
  };

  await walk(root);
  return files;
};

const createSkillChanges = async (currentDir: string, nextDir: string): Promise<PlannedFileChange[]> => {
  const currentFiles = await readSkillFiles(currentDir);
  const nextFiles = await readSkillFiles(nextDir);
  const filePaths = [...new Set([...currentFiles.keys(), ...nextFiles.keys()])].sort((a, b) => {
    if (a === "SKILL.md") {
      return -1;
    }
    if (b === "SKILL.md") {
      return 1;
    }
    return a.localeCompare(b);
  });
  return filePaths
    .map((path) => {
      const before = currentFiles.get(path) ?? "";
      const after = nextFiles.get(path) ?? "";
      if (before === after) {
        return undefined;
      }
      return {
        path,
        before,
        after,
        diff: createUnifiedDiff(path, before, after)
      };
    })
    .filter((change): change is PlannedFileChange => Boolean(change));
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
    await writeIgnoreRules(
      rules.filter((rule) => !(rule.scope === "group" && rule.skillKey === normalized))
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

  const entryFor = async (id: string, skillDir: string): Promise<SkillLibraryEntry> => {
    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const frontmatter = parseSkillFrontmatter(content);
    const metadata =
      (await readJsonIfExists<SkillMetadataFile>(join(skillDir, ".agentenv-skill.json"))) ?? {};
    const contentHash = await computeContentHash(skillDir);
    const stats = await stat(join(skillDir, "SKILL.md"));
    return {
      id,
      name: frontmatter.name || id,
      description: frontmatter.description,
      version: frontmatter.version,
      versionSource: frontmatter.versionSource,
      iconKey: metadata.iconKey,
      path: skillDir,
      sourceType: metadata.sourceType ?? "local",
      source: metadata.source,
      globallyEnabled: metadata.globallyEnabled !== false,
      updatePolicy: updatePolicyFor(metadata),
      remoteRef: metadata.remoteRef,
      remoteRevision: metadata.remoteRevision,
      contentHash: metadata.contentHash ?? contentHash,
      updatedAt: metadata.updatedAt ?? stats.mtime.toISOString(),
      upstream: metadata.upstream,
      provenance: metadata.provenance
    };
  };

  const normalizedSkillName = (name: string) => name.normalize("NFKC").trim().toLowerCase();

  const snapshotForDirectory = async (
    id: string,
    skillDir: string,
    source: Pick<SkillImportSnapshot, "sourceType" | "source" | "upstream">
  ): Promise<SkillImportSnapshot> => {
    const frontmatter = await validateSkillFrontmatter(skillDir);
    return {
      id,
      name: frontmatter.name || id,
      description: frontmatter.description,
      version: frontmatter.version,
      versionSource: frontmatter.versionSource,
      contentHash: await computeContentHash(skillDir),
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
    const usedIds = new Set(skills.map((skill) => skill.id));
    let suggestedId = safeRequestedId;
    for (let suffix = 2; usedIds.has(suggestedId); suffix += 1) {
      suggestedId = `${safeRequestedId}-${suffix}`;
    }
    return { source, incoming, conflicts, suggestedId };
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
      const { hasSkillMd } = await readGitHubTree(parsedSource, tempDir);
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
            subpath: parsedSource.remotePath
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
    > & { iconKey?: ResourceIconKey }
  ) => {
    const current = await readLibraryMetadata(skillDir);
    const sourceType = metadata.sourceType ?? "local";
    const contentHash = await computeContentHash(skillDir);
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
          iconKey: metadata.iconKey ?? current.iconKey,
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
    const reservedIds = new Set(existingSkills.map((skill) => skill.id));
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
      const subtree = treeItems
        .filter((item) => !remotePath || item.path.startsWith(`${remotePath}/`))
        .map((item) => ({
          ...item,
          relativePath: relativeGitHubPath(remotePath, item.path)
        }))
        .filter(
          (item) =>
            item.relativePath &&
            !boundedSkillFiles.some((nested) => {
              const nestedDir = dirname(nested.path) === "." ? "" : dirname(nested.path);
              return nestedDir !== remotePath && item.path.startsWith(`${nestedDir}/`);
            })
        )
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const revision = createHash("sha1")
        .update(subtree.map((item) => `${item.type}:${item.relativePath}:${item.sha}\n`).join(""))
        .digest("hex");
      const existingSource = existingSkills.find(
        (skill) => skill.source?.replace(/\/$/, "") === sourceUrl.replace(/\/$/, "")
      );
      const duplicate = existingSkills.find(
        (skill) => !existingSource && skill.remoteRevision === revision
      );
      const pathName = remotePath.split("/").filter(Boolean).at(-1) ?? source.repo;
      const baseId = skillIdFrom(pathName);
      let id = existingSource?.id ?? duplicate?.id ?? baseId;
      if (!existingSource && !duplicate && reservedIds.has(id)) {
        const parentName = remotePath.split("/").filter(Boolean).at(-2) ?? source.repo;
        id = skillIdFrom(`${parentName}-${baseId}`);
      }
      let suffix = 2;
      const unsuffixedId = id;
      while (!existingSource && !duplicate && reservedIds.has(id)) {
        id = `${unsuffixedId}-${suffix}`;
        suffix += 1;
      }
      if (!existingSource && !duplicate) {
        reservedIds.add(id);
      }
      const frontmatter = parseSkillFrontmatter(content);
      candidates.push({
        id,
        name: frontmatter.name || pathName,
        description: frontmatter.description,
        remotePath,
        sourceUrl,
        ref: source.ref,
        revision,
        status: existingSource ? "already-imported" : duplicate ? "duplicate" : "ready",
        existingLibraryId: existingSource?.id ?? duplicate?.id
      });
    }

    return {
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      rootPath: source.rootPath,
      truncated: Boolean(treeResponse.truncated) || boundedSkillFiles.length > 500,
      candidates
    };
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
    const ignoreRules = await readIgnoreRules();
    const skillsCliEvidence = (
      await inspectSkillsCliLocks(paths.homeDir, options.skillsCliLockPaths)
    ).evidenceBySkillKey;
    const byKey = new Map<string, SkillInventoryEntry>();
    for (const target of targetPaths) {
      const scanRoots = [...new Set([target.skillsDir, ...(target.skillScanDirs ?? [])].filter(Boolean))];
      for (const scanRoot of scanRoots) {
        if (!scanRoot || !(await pathExists(scanRoot))) {
          continue;
        }
        const entries = await readdir(scanRoot, { withFileTypes: true });
        const resolvedScanRoot = resolve(scanRoot);
        const location = target.skillLocations?.find(
          (item) => resolve(item.path) === resolvedScanRoot
        ) ??
          (target.skillsDir && resolve(target.skillsDir) === resolvedScanRoot
            ? { path: scanRoot, role: "preferred-runtime" as const, shared: false }
            : undefined);
        for (const entry of entries) {
          if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith(".")) {
            continue;
          }
          const skillDir = join(scanRoot, entry.name);
          const skillKey = normalizeSkillKey(entry.name);
          const evidence = skillsCliEvidence.get(skillKey);
          let directoryStats;
          try {
            directoryStats = await stat(skillDir);
          } catch (error) {
            if (entry.isSymbolicLink() && evidence && isMissingFileError(error)) {
              const ignoreRule = findIgnoreRule(ignoreRules, { skillKey, path: skillDir });
              const externalOwnership = {
                ...evidence,
                confidence: "confirmed" as const,
                state: "broken-link" as const
              };
              const key = `external:${entry.name}:${skillDir}`;
              const existing = byKey.get(key);
              if (existing) {
                mergeInventoryLocation(existing, target.targetId, location);
                continue;
              }
              byKey.set(key, {
                id: entry.name,
                name: entry.name,
                description: "External Skill link target is missing.",
                path: skillDir,
                foundIn: [target.targetId],
                status: ignoreRule ? "ignored" : "external",
                libraryId: libraryIds.has(entry.name) ? entry.name : undefined,
                skillKey,
                contentHash: "",
                ignoreRuleId: ignoreRule?.id,
                ignoreReason: ignoreRule?.reason,
                locationRole: location?.role,
                sharedLocation: location?.shared,
                externalOwnership
              });
              continue;
            }
            throw error;
          }
          if (!directoryStats.isDirectory() || !(await pathExists(join(skillDir, "SKILL.md")))) {
            continue;
          }
          const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
          const frontmatter = parseSkillFrontmatter(content);
          const ownedId = await ownedLibraryId(skillDir);
          const markerId = ownedId && libraryIds.has(ownedId) ? ownedId : undefined;
          const ignoreRule = findIgnoreRule(ignoreRules, { skillKey, path: skillDir });
          let externalOwnership = evidence;
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
          const status = markerId
            ? "managed"
            : ignoreRule
              ? "ignored"
              : externalOwnership
                ? "external"
                : libraryIds.has(entry.name)
                  ? "library"
                  : "unmanaged";
          const libraryId = markerId ?? externalLibraryId ?? (libraryIds.has(entry.name) ? entry.name : undefined);
          const key = `${status}:${libraryId ?? entry.name}:${skillDir}`;
          const existing = byKey.get(key);
          if (existing) {
            mergeInventoryLocation(existing, target.targetId, location);
            continue;
          }
          const skillDirStats = await lstat(skillDir);
          const skillFileStats = await lstat(join(skillDir, "SKILL.md"));
          byKey.set(key, {
            id: entry.name,
            name: frontmatter.name || entry.name,
            description: frontmatter.description,
            path: skillDir,
            foundIn: [target.targetId],
            status,
            libraryId,
            skillKey,
            contentHash,
            ignoreRuleId: ignoreRule?.id,
            ignoreReason: ignoreRule?.reason,
            installMethod: markerId
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
            locationRole: location?.role,
            sharedLocation: location?.shared
          });
        }
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
    expectedContentHash,
    conflictResolution
  }: GitHubSkillImportInput): Promise<SkillLibraryEntry> => {
    const source = parseGitHubSkillUrl(url, { ref, remotePath });

    const tempDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-"));
    try {
      const { hasSkillMd, revision } = await readGitHubTree(source, tempDir);
      if (!hasSkillMd) {
        throw new Error(`GitHub skill source is missing SKILL.md: ${url}`);
      }
      await validateSkillFrontmatter(tempDir);
      const previewSource: SkillImportPreviewInput = {
        kind: "github",
        input: { url, id, ref, remotePath }
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
            revision
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
            revision
          },
          provenance: previousMetadata?.provenance ?? { importedVia: "agentenv" }
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
            revision
          },
          provenance: { importedVia: "agentenv" }
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
    const reservedIds = new Set(existingSkills.map((skill) => skill.id));
    return {
      ...result,
      candidates: result.candidates.map((candidate) => {
        const existingSource = existingSkills.find(
          (skill) =>
            skill.sourceType === "git" &&
            skill.source === candidate.source.locator &&
            skill.remoteRef === candidate.source.ref &&
            (skill.upstream?.subpath ?? "") === (candidate.source.subpath ?? "")
        );
        const duplicate = existingSkills.find(
          (skill) => !existingSource && skill.remoteRevision === candidate.contentRevision
        );
        let id = existingSource?.id ?? duplicate?.id ?? candidate.id;
        const baseId = id;
        for (
          let suffix = 2;
          !existingSource && !duplicate && reservedIds.has(id);
          suffix += 1
        ) {
          id = `${baseId}-${suffix}`;
        }
        if (!existingSource && !duplicate) reservedIds.add(id);
        return {
          ...candidate,
          id,
          status: existingSource ? "already-imported" : duplicate ? "duplicate" : "ready",
          existingLibraryId: existingSource?.id ?? duplicate?.id
        };
      })
    };
  };

  const importRepositorySkill = async (
    input: RepositorySkillImportInput
  ): Promise<SkillLibraryEntry> => {
    const tempDir = await mkdtemp(join(tmpdir(), "agentenv-repository-skill-"));
    try {
      const materialized = await requireRepositorySource().materialize(input, tempDir);
      const frontmatter = await validateSkillFrontmatter(tempDir);
      const requestedId =
        input.id ??
        normalizeSkillKey(frontmatter.name || basename(materialized.directory) || "skill");
      const previewSource: SkillImportPreviewInput = { kind: "repository", input };
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
        provenance: previousMetadata?.provenance ?? { importedVia: "agentenv" }
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

  const deployLibrarySkill = async ({
    targetPaths,
    targetName,
    libraryId,
    profileId
  }: DeployLibrarySkillStoreInput): Promise<void> => {
    if (!targetPaths.skillsDir) {
      throw new Error("Target does not expose a skills directory");
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
      throw new Error(`Target skill does not exist: ${targetDir}`);
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
      ? await Promise.all(
          (await profileStore.listProfiles()).map((profile) => profileStore.readProfile(profile.id))
        )
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
              profile.assetPolicy.skillRefs.some((reference) => reference.libraryId === skill.id)
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
        profile.assetPolicy.skillRefs.some((reference) => matchingIds.has(reference.libraryId))
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
    const profileDetails = await Promise.all(
      (await profileStore.listProfiles()).map((profile) => profileStore.readProfile(profile.id))
    );
    const affectedProfiles = profileDetails.filter((profile) =>
      profile.assetPolicy.skillRefs.some((reference) => removedIdSet.has(reference.libraryId))
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
        const hasKeptReference = profile.assetPolicy.skillRefs.some(
          (reference) => reference.libraryId === keepId
        );
        const mappedReferences = profile.assetPolicy.skillRefs
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
          configText: profile.configText,
          assetPolicy: { ...profile.assetPolicy, skillRefs: nextReferences }
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
        const latest = await readGitHubTree(source);
        return {
          id: skill.id,
          name: skill.name,
          sourceType: "github",
          currentRevision: metadata.remoteRevision,
          latestRevision: latest.revision,
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
        }
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
        await writeMetadata(targetDir, {
          sourceType: "git",
          source: materialized.repository,
          remoteRef: materialized.ref,
          remotePath: materialized.directory,
          remoteRevision: materialized.contentRevision,
          updatePolicy: "tracked",
          upstream: materialized.upstream
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
      upstream: { kind: "local", locator: source }
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
      iconKey
    });
    return entryFor(safeId, targetDir);
  };

  const previewUpdate = async (id: string): Promise<SkillUpdatePlan> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    const skill = await entryFor(safeId, targetDir);
    const metadata = await readLibraryMetadata(targetDir);
    if (skill.updatePolicy !== "tracked") {
      return {
        id: skill.id,
        name: skill.name,
        sourceType: skill.sourceType,
        source: metadata.source,
        currentRevision: metadata.remoteRevision ?? metadata.contentHash,
        updateAvailable: false,
        changes: [],
        errors: ["This skill is not tracked for updates"]
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
        errors: ["Skill has no update source configured"]
      };
    }

    if (metadata.sourceType === "github") {
      const source = parseGitHubSkillUrl(metadata.source, {
        ref: metadata.remoteRef,
        remotePath: metadata.remotePath
      });
      const tempDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-preview-"));
      try {
        const { hasSkillMd, revision } = await readGitHubTree(source, tempDir);
        if (!hasSkillMd) {
          throw new Error(`GitHub skill source is missing SKILL.md: ${metadata.source}`);
        }
        const changes = await createSkillChanges(targetDir, tempDir);
        return {
          id: skill.id,
          name: skill.name,
          sourceType: "github",
          source: metadata.source,
          currentRevision: metadata.remoteRevision,
          latestRevision: revision,
          updateAvailable: changes.length > 0,
          changes,
          errors: []
        };
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    if (metadata.sourceType === "git") {
      const tempDir = await mkdtemp(join(tmpdir(), "agentenv-repository-skill-preview-"));
      try {
        const materialized = await requireRepositorySource().materialize(
          {
            repository: metadata.source,
            ref: metadata.remoteRef,
            directory: metadata.remotePath,
            transport: "system-git"
          },
          tempDir
        );
        const changes = await createSkillChanges(targetDir, tempDir);
        return {
          id: skill.id,
          name: skill.name,
          sourceType: "git",
          source: metadata.source,
          currentRevision: metadata.remoteRevision,
          latestRevision: materialized.contentRevision,
          updateAvailable: changes.length > 0,
          changes,
          errors: []
        };
      } finally {
        await rm(tempDir, { recursive: true, force: true });
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
        errors: [`Skill update source type is not supported yet: ${metadata.sourceType}`]
      };
    }
    if (!(await pathExists(join(metadata.source, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${metadata.source}`);
    }
    const latestRevision = await computeContentHash(metadata.source);
    const changes = await createSkillChanges(targetDir, metadata.source);
    return {
      id: skill.id,
      name: skill.name,
      sourceType: "local",
      source: metadata.source,
      currentRevision: metadata.contentHash,
      latestRevision,
      updateAvailable: changes.length > 0,
      changes,
      errors: []
    };
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

  const updateSkill = async (id: string): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    const metadata = await readLibraryMetadata(targetDir);
    if (updatePolicyFor(metadata) !== "tracked") {
      throw new Error(`${safeId} is not tracked for updates`);
    }
    if (metadata.sourceType === "github" && metadata.source) {
      const source = parseGitHubSkillUrl(metadata.source, {
        ref: metadata.remoteRef,
        remotePath: metadata.remotePath
      });
      const tempDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-"));
      try {
        const { hasSkillMd, revision } = await readGitHubTree(source, tempDir);
        if (!hasSkillMd) {
          throw new Error(`GitHub skill source is missing SKILL.md: ${metadata.source}`);
        }
        const backup = await createLibraryUpdateBackup(safeId, targetDir);
        try {
          await removeAndCopy(tempDir, targetDir);
          await writeMetadata(targetDir, {
            sourceType: "github",
            source: metadata.source,
            remoteRef: source.ref,
            remotePath: source.remotePath,
            remoteRevision: revision,
            updatePolicy: "tracked",
            iconKey: metadata.iconKey,
            upstream: {
              kind: "github",
              locator: metadata.source,
              ref: source.ref,
              subpath: source.remotePath,
              revision
            },
            provenance: metadata.provenance
          });
        } catch (error) {
          await restoreCleanupBackup(backup);
          throw new Error(
            `Updating ${safeId} failed and restored the previous Library version: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        return entryFor(safeId, targetDir);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
    if (metadata.sourceType === "git" && metadata.source) {
      const tempDir = await mkdtemp(join(tmpdir(), "agentenv-repository-skill-"));
      try {
        const materialized = await requireRepositorySource().materialize(
          {
            repository: metadata.source,
            ref: metadata.remoteRef,
            directory: metadata.remotePath,
            transport: "system-git"
          },
          tempDir
        );
        const backup = await createLibraryUpdateBackup(safeId, targetDir);
        try {
          await removeAndCopy(tempDir, targetDir);
          await writeMetadata(targetDir, {
            sourceType: "git",
            source: materialized.repository,
            remoteRef: materialized.ref,
            remotePath: materialized.directory,
            remoteRevision: materialized.contentRevision,
            updatePolicy: "tracked",
            iconKey: metadata.iconKey,
            upstream: materialized.upstream,
            provenance: metadata.provenance
          });
        } catch (error) {
          await restoreCleanupBackup(backup);
          throw new Error(
            `Updating ${safeId} failed and restored the previous Library version: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        return entryFor(safeId, targetDir);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
    if (metadata.sourceType !== "local" || !metadata.source) {
      throw new Error(`Skill ${safeId} cannot be updated without a local source`);
    }
    if (!(await pathExists(join(metadata.source, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${metadata.source}`);
    }
    const backup = await createLibraryUpdateBackup(safeId, targetDir);
    try {
      await removeAndCopy(metadata.source, targetDir);
      await writeMetadata(targetDir, {
        sourceType: "local",
        source: metadata.source,
        updatePolicy: "tracked",
        iconKey: metadata.iconKey,
        upstream: metadata.upstream ?? { kind: "local", locator: metadata.source },
        provenance: metadata.provenance
      });
    } catch (error) {
      await restoreCleanupBackup(backup);
      throw new Error(
        `Updating ${safeId} failed and restored the previous Library version: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return entryFor(safeId, targetDir);
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
    removeSkill,
    manageTargetSkill,
    deployLibrarySkill,
    consolidateSkillGroup,
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
