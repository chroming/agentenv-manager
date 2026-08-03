import type { AppUpdateRelease } from "../../shared/appUpdates";

const REPOSITORY = "chroming/agentenv-manager";
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASE_ORIGIN = `https://github.com/${REPOSITORY}/`;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
  size?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  body?: unknown;
  assets?: unknown;
}

export interface TrustedRelease extends AppUpdateRelease {
  asset: {
    name: string;
    url: string;
    sha256: string;
    size: number;
  };
}

export interface ReleaseClient {
  readLatest(input: { platform: NodeJS.Platform; arch: string }): Promise<TrustedRelease>;
  isNewer(candidate: string, current: string): boolean;
}

const parseVersion = (value: string) => {
  const match = SEMVER.exec(value);
  if (!match) throw new Error(`Release versions must use stable SemVer: ${value}`);
  return match.slice(1).map(Number);
};

const isNewer = (candidate: string, current: string) => {
  const next = parseVersion(candidate);
  const active = parseVersion(current);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== active[index]) return next[index]! > active[index]!;
  }
  return false;
};

const assetNameFor = (version: string, platform: NodeJS.Platform, arch: string) => {
  if (platform === "darwin") {
    if (arch !== "arm64" && arch !== "x64") throw new Error(`Unsupported macOS architecture: ${arch}`);
    return `AgentEnv-Manager-${version}-mac-${arch}.dmg`;
  }
  if (platform === "win32") return `AgentEnv-Manager-${version}-windows-${arch}.exe`;
  if (platform === "linux") return `AgentEnv-Manager-${version}-linux-${arch}.AppImage`;
  throw new Error(`Application updates are unavailable on ${platform}`);
};

const requireString = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Latest Release has no valid ${label}`);
  return value;
};

const parseRelease = (
  raw: GitHubRelease,
  platform: NodeJS.Platform,
  arch: string
): TrustedRelease => {
  if (raw.draft || raw.prerelease) throw new Error("Latest Release is not a stable public release");
  const tag = requireString(raw.tag_name, "tag");
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("Latest Release tag is not stable SemVer");
  const version = tag.slice(1);
  parseVersion(version);
  const releaseUrl = requireString(raw.html_url, "URL");
  if (!releaseUrl.startsWith(`${RELEASE_ORIGIN}releases/tag/${tag}`)) {
    throw new Error("Latest Release URL is outside the official repository");
  }
  const expectedName = assetNameFor(version, platform, arch);
  const asset = Array.isArray(raw.assets)
    ? (raw.assets as GitHubAsset[]).find((candidate) => candidate.name === expectedName)
    : undefined;
  if (!asset) throw new Error(`Latest Release is missing ${expectedName}`);
  const url = requireString(asset.browser_download_url, "asset URL");
  const expectedUrl = `${RELEASE_ORIGIN}releases/download/${tag}/${expectedName}`;
  if (url !== expectedUrl) throw new Error("Latest Release asset URL is not immutable and official");
  const digest = requireString(asset.digest, "asset digest");
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Latest Release asset has no SHA-256 digest");
  if (typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error("Latest Release asset has no valid size");
  }
  return {
    version,
    tag,
    releaseUrl,
    publishedAt: requireString(raw.published_at, "publication time"),
    ...(typeof raw.body === "string" && raw.body.trim() ? { notes: raw.body } : {}),
    asset: {
      name: expectedName,
      url,
      sha256: digest.slice("sha256:".length),
      size: asset.size
    }
  };
};

export const createReleaseClient = (options: {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
} = {}): ReleaseClient => {
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  return {
    isNewer,
    readLatest: async ({ platform, arch }) => {
      const response = await request(RELEASE_API, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "AgentEnv-Manager"
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`Update service returned HTTP ${response.status}`);
      return parseRelease(await response.json() as GitHubRelease, platform, arch);
    }
  };
};
