import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type {
  AgentEnvSettings,
  GitHubSkillImportInput,
  PlannedFileChange,
  SkillCleanupIgnoreRule,
  SkillCleanupBackupSummary,
  SkillCleanupResult,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillSourceType,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput,
  TargetPaths,
  UnmanagedSkillEntry
} from "../shared/types";
import { createUnifiedDiff } from "./diff";
import { pathExists } from "./fileUtils";
import { createOwnerMarkerContent, markerPathFor } from "./ownershipMarkers";
import type { AgentEnvPaths } from "./paths";
import { resolveSkillsLibraryDir, type SettingsStore } from "./settingsStore";

interface SkillMetadataFile {
  sourceType?: SkillSourceType;
  source?: string;
  remoteRef?: string;
  remotePath?: string;
  remoteRevision?: string;
  contentHash?: string;
  updatedAt?: string;
}

interface SkillCleanupBackupManifest {
  id: string;
  libraryId: string;
  libraryCreated: boolean;
  createdAt: string;
  entries: Array<{ sourcePath: string; backupPath: string }>;
}

export interface ImportSkillInput {
  sourcePath: string;
  id?: string;
  sourceType?: SkillSourceType;
}

export interface ManageTargetSkillStoreInput {
  targetPaths: TargetPaths;
  targetName: string;
  libraryId: string;
}

export interface ConsolidateSkillGroupStoreInput {
  skillKey: string;
  libraryId: string;
  canonicalPath: string;
  locations: Array<{ targetPaths: TargetPaths; targetDir: string }>;
}

export interface SkillLibraryStore {
  listSkills(): Promise<SkillLibraryEntry[]>;
  scanInventory(targetPaths: TargetPaths[]): Promise<SkillInventoryEntry[]>;
  listCleanupBackups(): Promise<SkillCleanupBackupSummary[]>;
  ignoreSkillGroup(skillKey: string): Promise<SkillCleanupIgnoreRule>;
  unignoreSkillGroup(skillKey: string): Promise<void>;
  scanUnmanaged(targetPaths: TargetPaths[]): Promise<UnmanagedSkillEntry[]>;
  importSkill(input: ImportSkillInput): Promise<SkillLibraryEntry>;
  importGitHubSkill(input: GitHubSkillImportInput): Promise<SkillLibraryEntry>;
  removeSkill(id: string): Promise<void>;
  manageTargetSkill(input: ManageTargetSkillStoreInput): Promise<void>;
  consolidateSkillGroup(input: ConsolidateSkillGroupStoreInput): Promise<SkillCleanupResult>;
  rollbackSkillCleanup(backupId: string): Promise<void>;
  checkUpdates(): Promise<SkillUpdateInfo[]>;
  setUpdateSource(input: SkillUpdateSourceInput): Promise<SkillLibraryEntry>;
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
}

interface ParsedGitHubSkillSource {
  owner: string;
  repo: string;
  ref: string;
  remotePath: string;
  sourceUrl: string;
  defaultId: string;
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
  skillSyncMethod: "symlink",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60
};

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const metadataValue = (content: string, key: "name" | "description") => {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
};

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

const hashPath = async (path: string, hash = createHash("sha256")) => {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".agentenv-skill.json" || entry.name === ".agentenv-owner.json") {
      continue;
    }
    const child = join(path, entry.name);
    hash.update(entry.name);
    if (entry.isDirectory()) {
      await hashPath(child, hash);
    } else if (entry.isFile()) {
      hash.update(await readFile(child));
    }
  }
  return hash;
};

const computeContentHash = async (path: string) => (await hashPath(path)).digest("hex");

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
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
};

const copySkillEntries = async (sourceDir: string, targetDir: string) => {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".agentenv-skill.json") {
      continue;
    }
    await cp(join(sourceDir, entry.name), join(targetDir, entry.name), {
      recursive: true,
      dereference: true
    });
  }
};

const symlinkSkillEntries = async (sourceDir: string, targetDir: string) => {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".agentenv-skill.json") {
      continue;
    }
    await symlink(
      join(sourceDir, entry.name),
      join(targetDir, entry.name),
      entry.isDirectory() ? "dir" : "file"
    );
  }
};

const parseGitHubSkillUrl = (rawUrl: string): ParsedGitHubSkillSource => {
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
  const [owner, repo, kind, ref, ...rest] = segments;
  if (!owner || !repo || (kind !== "tree" && kind !== "blob") || !ref) {
    throw new Error("GitHub skill URL must point to a repository tree directory");
  }

  const pathSegments = kind === "blob" && rest.at(-1) === "SKILL.md" ? rest.slice(0, -1) : rest;
  const remotePath = pathSegments.join("/");
  const defaultId = pathSegments.at(-1) ?? repo;
  return {
    owner,
    repo,
    ref,
    remotePath,
    sourceUrl: rawUrl,
    defaultId
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

  const readIgnoreRules = async () =>
    (await readJsonIfExists<SkillCleanupIgnoreRule[]>(ignoreRulesPath))?.filter(
      (rule) =>
        rule &&
        (rule.scope === "group" || rule.scope === "location") &&
        (typeof rule.skillKey === "string" || typeof rule.path === "string")
    ) ?? [];

  const writeIgnoreRules = async (rules: SkillCleanupIgnoreRule[]) => {
    await mkdir(dirname(ignoreRulesPath), { recursive: true });
    await writeFile(ignoreRulesPath, `${JSON.stringify(rules, null, 2)}\n`, "utf8");
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
        await writeFile(filePath, await fetchGitHubText(item.download_url), "utf8");
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
    const metadata =
      (await readJsonIfExists<SkillMetadataFile>(join(skillDir, ".agentenv-skill.json"))) ?? {};
    const contentHash = await computeContentHash(skillDir);
    const stats = await stat(join(skillDir, "SKILL.md"));
    return {
      id,
      name: metadataValue(content, "name") || id,
      description: metadataValue(content, "description"),
      path: skillDir,
      sourceType: metadata.sourceType ?? "local",
      source: metadata.source,
      remoteRef: metadata.remoteRef,
      remoteRevision: metadata.remoteRevision,
      contentHash: metadata.contentHash ?? contentHash,
      updatedAt: metadata.updatedAt ?? stats.mtime.toISOString()
    };
  };

  const readLibraryMetadata = async (skillDir: string) =>
    (await readJsonIfExists<SkillMetadataFile>(join(skillDir, ".agentenv-skill.json"))) ?? {};

  const writeMetadata = async (
    skillDir: string,
    metadata: Pick<
      SkillMetadataFile,
      "sourceType" | "source" | "remoteRef" | "remotePath" | "remoteRevision"
    >
  ) => {
    const contentHash = await computeContentHash(skillDir);
    await writeFile(
      join(skillDir, ".agentenv-skill.json"),
      `${JSON.stringify(
        {
          sourceType: metadata.sourceType ?? "local",
          source: metadata.source,
          remoteRef: metadata.remoteRef,
          remotePath: metadata.remotePath,
          remoteRevision: metadata.remoteRevision,
          contentHash,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
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

  const markerLibraryId = async (skillDir: string, target: TargetPaths) => {
    const marker = await readJsonIfExists<Record<string, unknown>>(markerPathFor(skillDir));
    if (
      marker?.owner === "agentenv-manager" &&
      marker.targetId === target.targetId &&
      marker.kind === "skill" &&
      typeof marker.source === "string" &&
      marker.source.startsWith("skills-library/")
    ) {
      return marker.source.slice("skills-library/".length);
    }
    return undefined;
  };

  const scanInventory = async (targetPaths: TargetPaths[]): Promise<SkillInventoryEntry[]> => {
    const librarySkills = await listSkills();
    const libraryIds = new Set(librarySkills.map((skill) => skill.id));
    const libraryById = new Map(librarySkills.map((skill) => [skill.id, skill]));
    const ignoreRules = await readIgnoreRules();
    const byKey = new Map<string, SkillInventoryEntry>();
    for (const target of targetPaths) {
      const scanRoots = [...new Set([target.skillsDir, ...(target.skillScanDirs ?? [])].filter(Boolean))];
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
          if (!(await pathExists(join(skillDir, "SKILL.md")))) {
            continue;
          }
          const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
          const markerId = await markerLibraryId(skillDir, target);
          const skillKey = normalizeSkillKey(entry.name);
          const ignoreRule = findIgnoreRule(ignoreRules, { skillKey, path: skillDir });
          const status = markerId
            ? "managed"
            : ignoreRule
              ? "ignored"
              : libraryIds.has(entry.name)
                ? "library"
                : "unmanaged";
          const libraryId = markerId ?? (status === "library" ? entry.name : undefined);
          const key = `${status}:${libraryId ?? entry.name}:${skillDir}`;
          const existing = byKey.get(key);
          if (existing) {
            if (!existing.foundIn.includes(target.targetId)) {
              existing.foundIn.push(target.targetId);
            }
            continue;
          }
          const contentHash = await computeContentHash(skillDir);
          const skillFileStats = await lstat(join(skillDir, "SKILL.md"));
          byKey.set(key, {
            id: entry.name,
            name: metadataValue(content, "name") || entry.name,
            description: metadataValue(content, "description"),
            path: skillDir,
            foundIn: [target.targetId],
            status,
            libraryId,
            skillKey,
            contentHash,
            ignoreRuleId: ignoreRule?.id,
            installMethod: markerId ? (skillFileStats.isSymbolicLink() ? "linked" : "copied") : undefined,
            contentMatchesLibrary: markerId
              ? libraryById.get(markerId)?.contentHash === contentHash
              : undefined
          });
        }
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
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

  const importSkill = async ({
    sourcePath,
    id,
    sourceType = "local"
  }: ImportSkillInput): Promise<SkillLibraryEntry> => {
    if (!(await pathExists(join(sourcePath, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${sourcePath}`);
    }
    const safeId = SafeIdSchema.parse(id ?? basename(sourcePath));
    const targetDir = join(await libraryDir(), safeId);
    if (await pathExists(targetDir)) {
      throw new Error(`Library skill already exists: ${safeId}`);
    }
    await removeAndCopy(sourcePath, targetDir);
    await writeMetadata(
      targetDir,
      sourceType === "local" ? { sourceType: "local" } : { sourceType, source: sourcePath }
    );
    return entryFor(safeId, targetDir);
  };

  const removeSkill = async (id: string): Promise<void> => {
    const safeId = SafeIdSchema.parse(id);
    await rm(join(await libraryDir(), safeId), { recursive: true, force: true });
  };

  const cleanupBackupRoot = () => join(paths.backupsDir, "skill-cleanup");

  const readCleanupBackup = async (backupId: string) => {
    const safeId = SafeIdSchema.parse(backupId);
    const backupDir = join(cleanupBackupRoot(), safeId);
    const manifest = JSON.parse(
      await readFile(join(backupDir, "manifest.json"), "utf8")
    ) as SkillCleanupBackupManifest;
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
            locationCount: manifest.entries.length
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
    for (const entry of manifest.entries) {
      await rm(entry.sourcePath, { recursive: true, force: true });
      await mkdir(dirname(entry.sourcePath), { recursive: true });
      await cp(entry.backupPath, entry.sourcePath, { recursive: true, dereference: false });
    }
    if (manifest.libraryCreated) {
      await rm(join(await libraryDir(), manifest.libraryId), { recursive: true, force: true });
    }
  };

  const importGitHubSkill = async ({
    url,
    id
  }: GitHubSkillImportInput): Promise<SkillLibraryEntry> => {
    const source = parseGitHubSkillUrl(url);
    const safeId = SafeIdSchema.parse(id ?? source.defaultId);
    const targetDir = join(await libraryDir(), safeId);
    if (await pathExists(targetDir)) {
      throw new Error(`Library skill already exists: ${safeId}`);
    }

    const tempDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-"));
    try {
      const { hasSkillMd, revision } = await readGitHubTree(source, tempDir);
      if (!hasSkillMd) {
        throw new Error(`GitHub skill source is missing SKILL.md: ${url}`);
      }
      await removeAndCopy(tempDir, targetDir);
      await writeMetadata(targetDir, {
        sourceType: "github",
        source: source.sourceUrl,
        remoteRef: source.ref,
        remotePath: source.remotePath,
        remoteRevision: revision
      });
      return entryFor(safeId, targetDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };

  const manageTargetSkill = async ({
    targetPaths,
    targetName,
    libraryId
  }: ManageTargetSkillStoreInput): Promise<void> => {
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
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Target skill does not exist: ${targetDir}`);
    }

    const settings = await readSettings();
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    if (settings.skillSyncMethod === "copy") {
      await copySkillEntries(sourceDir, targetDir);
    } else if (settings.skillSyncMethod === "auto") {
      try {
        await symlinkSkillEntries(sourceDir, targetDir);
      } catch {
        await rm(targetDir, { recursive: true, force: true });
        await mkdir(targetDir, { recursive: true });
        await copySkillEntries(sourceDir, targetDir);
      }
    } else {
      await symlinkSkillEntries(sourceDir, targetDir);
    }
    await writeFile(
      markerPathFor(targetDir),
      createOwnerMarkerContent({
        profileId: "library-management",
        targetId: targetPaths.targetId,
        kind: "skill",
        source: `skills-library/${safeLibraryId}`
      }),
      "utf8"
    );
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
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    if (settings.skillSyncMethod === "copy") {
      await copySkillEntries(sourceDir, targetDir);
    } else if (settings.skillSyncMethod === "auto") {
      try {
        await symlinkSkillEntries(sourceDir, targetDir);
      } catch {
        await rm(targetDir, { recursive: true, force: true });
        await mkdir(targetDir, { recursive: true });
        await copySkillEntries(sourceDir, targetDir);
      }
    } else {
      await symlinkSkillEntries(sourceDir, targetDir);
    }
    await writeFile(
      markerPathFor(targetDir),
      createOwnerMarkerContent({
        profileId: "library-cleanup",
        targetId,
        kind: "skill",
        source: `skills-library/${libraryId}`
      }),
      "utf8"
    );
  };

  const consolidateSkillGroup = async ({
    skillKey,
    libraryId,
    canonicalPath,
    locations
  }: ConsolidateSkillGroupStoreInput): Promise<SkillCleanupResult> => {
    const safeSkillKey = SafeIdSchema.parse(skillKey);
    const safeLibraryId = SafeIdSchema.parse(libraryId);
    if (!locations.some((location) => location.targetDir === canonicalPath)) {
      throw new Error("Canonical skill must be one of the scanned cleanup locations");
    }
    if (!(await pathExists(join(canonicalPath, "SKILL.md")))) {
      throw new Error(`Canonical skill is missing SKILL.md: ${canonicalPath}`);
    }

    const uniqueLocations = [...new Map(locations.map((item) => [item.targetDir, item])).values()];
    const targetLibraryDir = join(await libraryDir(), safeLibraryId);
    const libraryCreated = !(await pathExists(join(targetLibraryDir, "SKILL.md")));
    const backupId = `cleanup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDir = join(cleanupBackupRoot(), backupId);
    const entries: SkillCleanupBackupManifest["entries"] = [];
    await mkdir(backupDir, { recursive: true });

    for (const [index, location] of uniqueLocations.entries()) {
      if (!(await pathExists(join(location.targetDir, "SKILL.md")))) {
        throw new Error(`Skill cleanup location is missing SKILL.md: ${location.targetDir}`);
      }
      const backupPath = join(backupDir, "locations", `${index}-${basename(location.targetDir)}`);
      await mkdir(dirname(backupPath), { recursive: true });
      await cp(location.targetDir, backupPath, { recursive: true, dereference: false });
      entries.push({ sourcePath: location.targetDir, backupPath });
    }

    const manifest: SkillCleanupBackupManifest = {
      id: backupId,
      libraryId: safeLibraryId,
      libraryCreated,
      createdAt: new Date().toISOString(),
      entries
    };
    await writeFile(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    try {
      if (libraryCreated) {
        await removeAndCopy(canonicalPath, targetLibraryDir);
        await writeMetadata(targetLibraryDir, { sourceType: "local" });
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
        managedLocations: uniqueLocations.map((location) => location.targetDir)
      };
    } catch (error) {
      await restoreCleanupBackup(manifest);
      throw new Error(
        `Skill cleanup ${safeSkillKey} failed and was rolled back: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const rollbackSkillCleanup = async (backupId: string): Promise<void> => {
    const { backupDir, manifest } = await readCleanupBackup(backupId);
    await restoreCleanupBackup(manifest);
    await rm(backupDir, { recursive: true, force: true });
  };

  const checkUpdates = async (): Promise<SkillUpdateInfo[]> => {
    const skills = await listSkills();
    const updates: SkillUpdateInfo[] = [];
    for (const skill of skills.filter((item) => Boolean(item.source))) {
      const metadata = await readLibraryMetadata(skill.path);
      if (!metadata.source) {
        updates.push({
          id: skill.id,
          name: skill.name,
          sourceType: skill.sourceType,
          currentRevision: metadata.remoteRevision,
          updateAvailable: false,
          error: "Missing GitHub source URL"
        });
        continue;
      }

      try {
        if (metadata.sourceType === "local") {
          if (!(await pathExists(join(metadata.source, "SKILL.md")))) {
            throw new Error(`Skill source is missing SKILL.md: ${metadata.source}`);
          }
          const latestRevision = await computeContentHash(metadata.source);
          updates.push({
            id: skill.id,
            name: skill.name,
            sourceType: "local",
            currentRevision: metadata.contentHash,
            latestRevision,
            updateAvailable: latestRevision !== metadata.contentHash
          });
          continue;
        }
        const source = parseGitHubSkillUrl(metadata.source);
        const latest = await readGitHubTree(source);
        updates.push({
          id: skill.id,
          name: skill.name,
          sourceType: "github",
          currentRevision: metadata.remoteRevision,
          latestRevision: latest.revision,
          updateAvailable: latest.revision !== metadata.remoteRevision
        });
      } catch (error) {
        updates.push({
          id: skill.id,
          name: skill.name,
          sourceType: metadata.sourceType ?? skill.sourceType,
          currentRevision: metadata.remoteRevision ?? metadata.contentHash,
          updateAvailable: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return updates;
  };

  const setUpdateSource = async ({
    id,
    sourceType,
    source
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
        remotePath: githubSource.remotePath
      });
      return entryFor(safeId, targetDir);
    }
    if (sourceType !== "local") {
      throw new Error(`Skill update source type is not supported yet: ${sourceType}`);
    }
    if (!(await pathExists(join(source, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${source}`);
    }
    await writeMetadata(targetDir, { sourceType: "local", source });
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
      const source = parseGitHubSkillUrl(metadata.source);
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

  const updateSkill = async (id: string): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    const metadata = await readLibraryMetadata(targetDir);
    if (metadata.sourceType === "github" && metadata.source) {
      const source = parseGitHubSkillUrl(metadata.source);
      const tempDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-"));
      try {
        const { hasSkillMd, revision } = await readGitHubTree(source, tempDir);
        if (!hasSkillMd) {
          throw new Error(`GitHub skill source is missing SKILL.md: ${metadata.source}`);
        }
        await removeAndCopy(tempDir, targetDir);
        await writeMetadata(targetDir, {
          sourceType: "github",
          source: metadata.source,
          remoteRef: source.ref,
          remotePath: source.remotePath,
          remoteRevision: revision
        });
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
    await removeAndCopy(metadata.source, targetDir);
    await writeMetadata(targetDir, { sourceType: "local", source: metadata.source });
    return entryFor(safeId, targetDir);
  };

  return {
    listSkills,
    scanInventory,
    listCleanupBackups,
    ignoreSkillGroup,
    unignoreSkillGroup,
    scanUnmanaged,
    importSkill,
    importGitHubSkill,
    removeSkill,
    manageTargetSkill,
    consolidateSkillGroup,
    rollbackSkillCleanup,
    checkUpdates,
    setUpdateSource,
    previewUpdate,
    updateSkill
  };
};
