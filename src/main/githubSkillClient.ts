import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import { writeAtomic } from "./fileUtils";

export type GitHubFetch = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers?: Pick<Headers, "get">;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ParsedGitHubSkillSource {
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

export interface GitHubCommitResponse {
  commit?: {
    tree?: { sha?: string };
    author?: { date?: string };
    committer?: { date?: string };
  };
}

export interface GitHubTreeResponse {
  truncated?: boolean;
  tree?: Array<{ path?: string; type?: string; sha?: string; mode?: string }>;
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
type GitHubRequestOptions = { refresh?: boolean };

const RESPONSE_CACHE_TTL_MS = 2 * 60 * 1_000;
const RESPONSE_CACHE_MAX_ENTRIES = 1_024;

export const mapWithConcurrency = async <Input, Output>(
  values: readonly Input[],
  limit: number,
  mapValue: (value: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapValue(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
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

export const githubSkillSourceUrl = (
  owner: string,
  repo: string,
  ref: string,
  remotePath: string
) => `https://github.com/${owner}/${repo}/tree/${ref}${remotePath ? `/${remotePath}` : ""}`;

export const skillIdFrom = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SafeIdSchema.safeParse(normalized).success ? normalized : "skill";
};

export const parseGitHubSkillUrl = (
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

export const encodeGitHubPath = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const relativeGitHubPath = (rootPath: string, childPath: string) => {
  if (!rootPath) return childPath;
  if (childPath === rootPath) return "";
  return childPath.startsWith(`${rootPath}/`) ? childPath.slice(rootPath.length + 1) : childPath;
};

const assertGitHubContentItems = (value: unknown, url: string): GitHubContentItem[] => {
  if (!Array.isArray(value)) {
    throw new Error(`GitHub source is not a directory: ${url}`);
  }
  return value.filter((item): item is GitHubContentItem => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return (
      (record.type === "file" || record.type === "dir") &&
      typeof record.name === "string" &&
      typeof record.path === "string" &&
      typeof record.sha === "string"
    );
  });
};

export const createGitHubSkillClient = ({
  fetchImpl,
  authTokenProvider
}: {
  fetchImpl: GitHubFetch;
  authTokenProvider?: () => Promise<string | undefined>;
}) => {
  const responseCache = new Map<string, { value: unknown; fetchedAt: number }>();
  const responseInflight = new Map<string, Promise<unknown>>();

  const requestContext = async (): Promise<{
    cacheScope: string;
    init?: RequestInit;
  }> => {
    const token = await authTokenProvider?.();
    if (!token) return { cacheScope: "anonymous" };
    return {
      cacheScope: createHash("sha256").update(token).digest("hex").slice(0, 16),
      init: {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    };
  };

  const requestError = async (response: Awaited<ReturnType<GitHubFetch>>, url: string) => {
    const detail = await response.text().catch(() => "");
    const rateLimited =
      response.status === 429 ||
      response.headers?.get("x-ratelimit-remaining") === "0" ||
      /rate limit/i.test(detail);
    return rateLimited
      ? new Error(`GitHub API rate limit reached (${response.status} ${response.statusText})`)
      : new Error(`GitHub request failed (${response.status} ${response.statusText}): ${url}`);
  };

  const cachedRequest = async <T>(
    key: string,
    load: () => Promise<T>,
    refresh = false
  ): Promise<T> => {
    const inflightKey = `${refresh ? "refresh" : "reuse"}:${key}`;
    const inflight = responseInflight.get(inflightKey) as Promise<T> | undefined;
    if (inflight) return inflight;
    const cached = responseCache.get(key);
    if (!refresh && cached && Date.now() - cached.fetchedAt <= RESPONSE_CACHE_TTL_MS) {
      return cached.value as T;
    }
    const request = load().then((value) => {
      const fetchedAt = Date.now();
      for (const [cachedKey, cachedValue] of responseCache) {
        if (fetchedAt - cachedValue.fetchedAt > RESPONSE_CACHE_TTL_MS) {
          responseCache.delete(cachedKey);
        }
      }
      responseCache.set(key, { value, fetchedAt });
      while (responseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
        const oldestKey = responseCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        responseCache.delete(oldestKey);
      }
      return value;
    });
    responseInflight.set(inflightKey, request);
    void request.then(
      () => responseInflight.delete(inflightKey),
      () => responseInflight.delete(inflightKey)
    );
    return request;
  };

  const fetchJson = async (url: string, options: GitHubRequestOptions = {}) => {
    const context = await requestContext();
    return cachedRequest(`${context.cacheScope}:json:${url}`, async () => {
      const response = await fetchImpl(url, context.init);
      if (!response.ok) throw await requestError(response, url);
      return response.json();
    }, options.refresh);
  };

  const fetchText = async (url: string, options: GitHubRequestOptions = {}) => {
    const context = await requestContext();
    return cachedRequest(`${context.cacheScope}:text:${url}`, async () => {
      const response = await fetchImpl(url, context.init);
      if (!response.ok) throw await requestError(response, url);
      return response.text();
    }, options.refresh);
  };

  const tryFetchJson = async <T>(
    url: string,
    options: GitHubRequestOptions = {}
  ): Promise<T | undefined> => {
    const context = await requestContext();
    return cachedRequest(`${context.cacheScope}:optional-json:${url}`, async () => {
      const response = await fetchImpl(url, context.init);
      if (response.status === 404 || response.status === 422) return undefined;
      if (!response.ok) throw await requestError(response, url);
      return (await response.json()) as T;
    }, options.refresh);
  };

  const resolveLocation = async (rawUrl: string, options: GitHubRequestOptions = {}) => {
    const location = parseGitHubLocation(rawUrl);
    let ref: string;
    let rootPath: string;
    let commit: GitHubCommitResponse | undefined;

    if (location.kind === "repository") {
      const repository = await fetchJson(
        `https://api.github.com/repos/${location.owner}/${location.repo}`,
        options
      ) as GitHubRepositoryResponse;
      if (!repository.default_branch) {
        throw new Error("GitHub repository response is missing a default branch");
      }
      ref = repository.default_branch;
      rootPath = "";
      commit = await tryFetchJson<GitHubCommitResponse>(
        `https://api.github.com/repos/${location.owner}/${location.repo}/commits/${encodeURIComponent(ref)}`,
        options
      );
    } else {
      const segments =
        location.kind === "blob" && location.pathSegments.at(-1) === "SKILL.md"
          ? location.pathSegments.slice(0, -1)
          : location.pathSegments;
      let resolvedLength = 0;
      for (let length = 1; length <= segments.length; length += 1) {
        const candidateRef = segments.slice(0, length).join("/");
        const candidateCommit = await tryFetchJson<GitHubCommitResponse>(
          `https://api.github.com/repos/${location.owner}/${location.repo}/commits/${encodeURIComponent(candidateRef)}`,
          options
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
    if (!treeSha) throw new Error(`GitHub commit could not be resolved: ${ref}`);
    return { ...location, ref, rootPath, treeSha };
  };

  const readTree = async (
    source: ParsedGitHubSkillSource,
    writeRoot?: string,
    options: GitHubRequestOptions = {}
  ) => {
    const revisionHash = createHash("sha1");
    let hasSkillMd = false;
    const walk = async (remotePath: string) => {
      const encodedPath = encodeGitHubPath(remotePath);
      const contentsPath = encodedPath ? `/contents/${encodedPath}` : "/contents";
      const url = `https://api.github.com/repos/${source.owner}/${source.repo}${contentsPath}?ref=${encodeURIComponent(source.ref)}`;
      const items = assertGitHubContentItems(await fetchJson(url, options), url).sort((a, b) =>
        a.path.localeCompare(b.path)
      );
      for (const item of items) {
        revisionHash.update(`${item.type}:${item.path}:${item.sha}\n`);
        if (item.type === "dir") {
          await walk(item.path);
          continue;
        }
        if (item.type !== "file") continue;
        const relativePath = relativeGitHubPath(source.remotePath, item.path);
        if (relativePath === "SKILL.md") hasSkillMd = true;
        if (!writeRoot) continue;
        if (!item.download_url) {
          throw new Error(`GitHub file is missing a download URL: ${item.path}`);
        }
        const filePath = join(writeRoot, ...relativePath.split("/"));
        await mkdir(dirname(filePath), { recursive: true });
        await writeAtomic(filePath, await fetchText(item.download_url, options));
      }
    };
    await walk(source.remotePath);
    return { hasSkillMd, revision: revisionHash.digest("hex") };
  };

  const readSkillUpdatedAt = async (
    source: ParsedGitHubSkillSource,
    options: GitHubRequestOptions = {}
  ): Promise<string | undefined> => {
    const query = new URLSearchParams({ sha: source.ref, per_page: "1" });
    if (source.remotePath) query.set("path", source.remotePath);
    try {
      const commits = await fetchJson(
        `https://api.github.com/repos/${source.owner}/${source.repo}/commits?${query.toString()}`,
        options
      ) as GitHubCommitResponse[];
      const value = commits[0]?.commit?.committer?.date ?? commits[0]?.commit?.author?.date;
      return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;
    } catch {
      return undefined;
    }
  };

  return { fetchJson, fetchText, resolveLocation, readTree, readSkillUpdatedAt };
};
