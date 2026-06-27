import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type {
  AgentEnvSettings,
  GitHubSkillImportInput,
  SkillLibraryEntry,
  SkillSourceType,
  SkillUpdateInfo,
  TargetPaths,
  UnmanagedSkillEntry
} from "../shared/types";
import { pathExists } from "./fileUtils";
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

export interface ImportSkillInput {
  sourcePath: string;
  id?: string;
  sourceType?: SkillSourceType;
}

export interface SkillLibraryStore {
  listSkills(): Promise<SkillLibraryEntry[]>;
  scanUnmanaged(targetPaths: TargetPaths[]): Promise<UnmanagedSkillEntry[]>;
  importSkill(input: ImportSkillInput): Promise<SkillLibraryEntry>;
  importGitHubSkill(input: GitHubSkillImportInput): Promise<SkillLibraryEntry>;
  checkUpdates(): Promise<SkillUpdateInfo[]>;
  updateSkill(id: string): Promise<SkillLibraryEntry>;
}

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

interface SkillLibraryStoreOptions {
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
  skillStorageLocation: "appData"
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
    if (entry.name === ".agentenv-skill.json") {
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

const removeAndCopy = async (source: string, destination: string) => {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
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
  const fetchImpl = options.fetch ?? fetch;

  const fetchGitHubJson = async (url: string) => {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`GitHub request failed (${response.status} ${response.statusText}): ${url}`);
    }
    return response.json();
  };

  const fetchGitHubText = async (url: string) => {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`GitHub file download failed (${response.status} ${response.statusText}): ${url}`);
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

  const scanUnmanaged = async (targetPaths: TargetPaths[]) => {
    const libraryIds = new Set((await listSkills()).map((skill) => skill.id));
    const byId = new Map<string, UnmanagedSkillEntry>();
    for (const target of targetPaths) {
      if (!target.skillsDir || !(await pathExists(target.skillsDir))) {
        continue;
      }
      const entries = await readdir(target.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || libraryIds.has(entry.name)) {
          continue;
        }
        const skillDir = join(target.skillsDir, entry.name);
        if (!(await pathExists(join(skillDir, "SKILL.md")))) {
          continue;
        }
        const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
        const existing = byId.get(entry.name);
        if (existing) {
          existing.foundIn.push(target.targetId);
          continue;
        }
        byId.set(entry.name, {
          id: entry.name,
          name: metadataValue(content, "name") || entry.name,
          description: metadataValue(content, "description"),
          path: skillDir,
          foundIn: [target.targetId]
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
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
    await writeMetadata(targetDir, { sourceType, source: sourcePath });
    return entryFor(safeId, targetDir);
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

  const checkUpdates = async (): Promise<SkillUpdateInfo[]> => {
    const skills = await listSkills();
    const updates: SkillUpdateInfo[] = [];
    for (const skill of skills.filter((item) => item.sourceType === "github")) {
      const metadata =
        (await readJsonIfExists<SkillMetadataFile>(join(skill.path, ".agentenv-skill.json"))) ?? {};
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
        const source = parseGitHubSkillUrl(metadata.source);
        const latest = await readGitHubTree(source);
        updates.push({
          id: skill.id,
          name: skill.name,
          sourceType: "github",
          currentRevision: metadata.remoteRevision,
          latestRevision: latest.revision,
          updateAvailable: Boolean(metadata.remoteRevision && latest.revision !== metadata.remoteRevision)
        });
      } catch (error) {
        updates.push({
          id: skill.id,
          name: skill.name,
          sourceType: "github",
          currentRevision: metadata.remoteRevision,
          updateAvailable: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return updates;
  };

  const updateSkill = async (id: string): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    const metadata =
      (await readJsonIfExists<SkillMetadataFile>(join(targetDir, ".agentenv-skill.json"))) ?? {};
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

  return { listSkills, scanUnmanaged, importSkill, importGitHubSkill, checkUpdates, updateSkill };
};
