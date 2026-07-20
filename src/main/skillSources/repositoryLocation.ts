import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, normalize } from "node:path";

export type RepositoryLocationKind = "https" | "ssh" | "scp" | "file";

export interface RepositoryLocation {
  kind: RepositoryLocationKind;
  transportLocator: string;
  displayLocator: string;
  cacheKeyLocator: string;
  sshFallbackLocator?: string;
  host?: string;
  webUrl?: string;
  inferredRef?: string;
  inferredDirectory?: string;
}

export interface ParseRepositoryLocationOptions {
  allowLocal?: boolean;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCP_LIKE = /^([A-Za-z0-9._-]+)@(\[[^\]]+\]|[A-Za-z0-9.-]+):(.+)$/;

const withoutGitSuffix = (value: string) => value.replace(/\.git$/i, "");

const trimRepositoryPath = (value: string) => value.replace(/\/+$/, "");

const assertSafeCommonInput = (input: string): string => {
  if (CONTROL_CHARACTERS.test(input)) {
    throw new Error("Repository locator contains control characters");
  }
  const value = input.trim();
  if (!value) {
    throw new Error("Repository locator is required");
  }
  if (value.startsWith("-")) {
    throw new Error("Repository locator must not start with a command option");
  }
  if (value.toLowerCase().startsWith("ext::")) {
    throw new Error("Git remote helpers are not supported");
  }
  return value;
};

const assertSafeRepositoryPath = (value: string): void => {
  if (!value || value.startsWith("-") || value.includes("\\")) {
    throw new Error("Repository path is unsafe");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Repository path must not contain traversal segments");
  }
};

const decodedSegments = (pathname: string): string[] =>
  pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (!decoded || decoded === "." || decoded === ".." || /[\\/]/.test(decoded)) {
        throw new Error("Repository URL contains an unsafe path segment");
      }
      return decoded;
    });

const parseLocalLocation = (value: string, allowLocal: boolean): RepositoryLocation | undefined => {
  if (!value.startsWith("file:") && !isAbsolute(value)) {
    return undefined;
  }
  if (!allowLocal) {
    throw new Error("Local repository paths are not enabled");
  }
  let localPath: string;
  try {
    localPath = normalize(value.startsWith("file:") ? fileURLToPath(value) : value);
  } catch {
    throw new Error("Local repository URL is invalid");
  }
  if (!isAbsolute(localPath)) {
    throw new Error("Local repository path must be absolute");
  }
  const cacheKeyLocator = pathToFileURL(localPath).toString();
  return {
    kind: "file",
    transportLocator: localPath,
    displayLocator: localPath,
    cacheKeyLocator
  };
};

const parseScpLocation = (value: string): RepositoryLocation | undefined => {
  const match = SCP_LIKE.exec(value);
  if (!match) {
    return undefined;
  }
  const [, user, rawHost, rawPath] = match;
  const host = rawHost.toLowerCase();
  const path = trimRepositoryPath(rawPath);
  assertSafeRepositoryPath(path);
  const transportLocator = `${user}@${host}:${path}`;
  const displayLocator = `${user}@${host}:${withoutGitSuffix(path)}`;
  return {
    kind: "scp",
    transportLocator,
    displayLocator,
    cacheKeyLocator: displayLocator,
    host: host.replace(/^\[|\]$/g, "")
  };
};

const parseUrlLocation = (value: string): RepositoryLocation => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Repository locator is not a valid URL or SCP-style clone address");
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "ssh:") {
    throw new Error(`Repository protocol is not supported: ${url.protocol}`);
  }
  if (url.password || (protocol === "https:" && url.username)) {
    throw new Error("Repository locator must not contain embedded credentials");
  }
  if (!url.hostname) {
    throw new Error("Repository host is required");
  }

  const host = url.hostname.toLowerCase();
  const authority = `${url.username ? `${url.username}@` : ""}${url.host.toLowerCase()}`;
  const segments = decodedSegments(url.pathname);
  if (segments.length === 0) {
    throw new Error("Repository path is required");
  }

  if (protocol === "https:" && host === "github.com" && segments.length >= 2) {
    const [owner, rawRepo, marker, ref, ...directory] = segments;
    const repo = withoutGitSuffix(rawRepo);
    const repositoryPath = `/${owner}/${repo}`;
    const isTreeUrl = marker === "tree" && Boolean(ref);
    const webPath = isTreeUrl
      ? `${repositoryPath}/tree/${ref}${directory.length > 0 ? `/${directory.join("/")}` : ""}`
      : repositoryPath;
    return {
      kind: "https",
      transportLocator: `https://${url.host.toLowerCase()}${repositoryPath}.git`,
      displayLocator: `https://${url.host.toLowerCase()}${repositoryPath}`,
      cacheKeyLocator: `https://${url.host.toLowerCase()}${repositoryPath}`,
      sshFallbackLocator: `git@github.com:${owner}/${repo}.git`,
      host,
      webUrl: `https://${url.host.toLowerCase()}${webPath}`,
      inferredRef: isTreeUrl ? ref : undefined,
      inferredDirectory: isTreeUrl && directory.length > 0 ? directory.join("/") : undefined
    };
  }

  const path = trimRepositoryPath(url.pathname);
  assertSafeRepositoryPath(path);
  const transportLocator = `${protocol}//${authority}${path}`;
  const displayLocator = `${protocol}//${authority}${withoutGitSuffix(path)}`;
  return {
    kind: protocol === "https:" ? "https" : "ssh",
    transportLocator,
    displayLocator,
    cacheKeyLocator: displayLocator,
    host,
    ...(protocol === "https:" ? { webUrl: displayLocator } : {})
  };
};

export const parseRepositoryLocation = (
  input: string,
  options: ParseRepositoryLocationOptions = {}
): RepositoryLocation => {
  const value = assertSafeCommonInput(input);
  const local = parseLocalLocation(value, options.allowLocal === true);
  if (local) {
    return local;
  }
  const scp = parseScpLocation(value);
  if (scp) {
    return scp;
  }
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    throw new Error("Repository locator must be an HTTPS, SSH, SCP-style, or absolute local address");
  }
  return parseUrlLocation(value);
};
