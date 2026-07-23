import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  GitHubAuthStatus,
  GitHubAuthUser,
  GitHubDeviceLogin,
  GitHubDeviceLoginResult,
  GitHubRateLimit
} from "../shared/types";
import type { AgentEnvPaths } from "./paths";
import { DEFAULT_GITHUB_OAUTH_CLIENT_ID } from "./githubConfig";
import { writeAtomic } from "./fileUtils";

interface TokenFile {
  token: string;
}

interface GitHubDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface GitHubAccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

interface GitHubUserResponse {
  login?: string;
  name?: string | null;
  avatar_url?: string | null;
}

interface GitHubRateLimitResponse {
  resources?: {
    core?: {
      limit?: number;
      remaining?: number;
      reset?: number;
    };
  };
}

interface PendingDeviceLogin {
  deviceCode: string;
  expiresAtMs: number;
  intervalSeconds: number;
  nextPollAtMs: number;
}

export interface GitHubTokenCipher {
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  isEncryptionAvailable(): boolean;
}

export interface GitHubTokenStore {
  readToken(): Promise<string | undefined>;
  writeToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

export interface GitHubAuthService {
  readAccessToken(): Promise<string | undefined>;
  readStatus(): Promise<GitHubAuthStatus>;
  startDeviceLogin(): Promise<GitHubDeviceLogin>;
  pollDeviceLogin(id: string): Promise<GitHubDeviceLoginResult>;
  signOut(): Promise<GitHubAuthStatus>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface GitHubAuthServiceOptions {
  fetch?: FetchLike;
  tokenStore: GitHubTokenStore;
}

const tokenPathFor = (paths: AgentEnvPaths) => join(paths.appDataRoot, "github-auth.json");

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded"
};

class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}

const readJsonResponse = async <T>(response: Response): Promise<T> => {
  const value = (await response.json()) as T;
  if (!response.ok) {
    const error = value as { error?: string; error_description?: string };
    throw new GitHubRequestError(
      error.error_description ??
        error.error ??
        `GitHub auth request failed (${response.status} ${response.statusText})`,
      response.status
    );
  }
  return value;
};

const toUser = (value: GitHubUserResponse): GitHubAuthUser => {
  if (!value.login) {
    throw new Error("GitHub user response is missing login");
  }
  return {
    login: value.login,
    name: value.name ?? undefined,
    avatarUrl: value.avatar_url ?? undefined
  };
};

const toRateLimit = (value: GitHubRateLimitResponse): GitHubRateLimit | undefined => {
  const core = value.resources?.core;
  if (
    typeof core?.limit !== "number" ||
    typeof core.remaining !== "number" ||
    typeof core.reset !== "number"
  ) {
    return undefined;
  }
  return {
    limit: core.limit,
    remaining: core.remaining,
    resetAt: new Date(core.reset * 1000).toISOString()
  };
};

export const createFileGitHubTokenStore = (
  paths: AgentEnvPaths,
  cipher: GitHubTokenCipher
): GitHubTokenStore => {
  const path = tokenPathFor(paths);

  const readToken = async () => {
    try {
      const file = JSON.parse(await readFile(path, "utf8")) as TokenFile;
      if (!file.token) {
        return undefined;
      }
      return cipher.decryptString(Buffer.from(file.token, "base64"));
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    }
  };

  const writeToken = async (token: string) => {
    if (!cipher.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable on this Mac");
    }
    const encrypted = cipher.encryptString(token).toString("base64");
    await writeAtomic(path, `${JSON.stringify({ token: encrypted }, null, 2)}\n`);
  };

  const clearToken = async () => {
    await rm(path, { force: true });
  };

  return { clearToken, readToken, writeToken };
};

export const createGitHubAuthService = ({
  fetch: fetchImpl = fetch,
  tokenStore
}: GitHubAuthServiceOptions): GitHubAuthService => {
  const pendingLogins = new Map<string, PendingDeviceLogin>();

  const readAccessToken = () => tokenStore.readToken();

  const fetchGitHubJson = async <T>(url: string, token: string): Promise<T> => {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    return readJsonResponse<T>(response);
  };

  const readStatus = async (): Promise<GitHubAuthStatus> => {
    let token: string | undefined;
    try {
      token = await tokenStore.readToken();
    } catch {
      await tokenStore.clearToken().catch(() => undefined);
      return {
        state: "configured",
        clientId: DEFAULT_GITHUB_OAUTH_CLIENT_ID,
        error: "Saved GitHub sign-in was invalid and has been cleared. Sign in again to reconnect."
      };
    }
    if (!token) {
      return { state: "configured", clientId: DEFAULT_GITHUB_OAUTH_CLIENT_ID };
    }

    try {
      const [user, rateLimit] = await Promise.all([
        fetchGitHubJson<GitHubUserResponse>("https://api.github.com/user", token).then(toUser),
        fetchGitHubJson<GitHubRateLimitResponse>("https://api.github.com/rate_limit", token).then(
          toRateLimit
        )
      ]);
      return {
        state: "signed-in",
        verification: "verified",
        clientId: DEFAULT_GITHUB_OAUTH_CLIENT_ID,
        user,
        rateLimit
      };
    } catch (error) {
      if (error instanceof GitHubRequestError && error.status === 401) {
        await tokenStore.clearToken().catch(() => undefined);
        return {
          state: "configured",
          clientId: DEFAULT_GITHUB_OAUTH_CLIENT_ID,
          error: "Saved GitHub sign-in was invalid and has been cleared. Sign in again to reconnect."
        };
      }
      return {
        state: "signed-in",
        verification: "unavailable",
        clientId: DEFAULT_GITHUB_OAUTH_CLIENT_ID,
        error: `GitHub sign-in is saved, but its status could not be verified: ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
  };

  const startDeviceLogin = async (): Promise<GitHubDeviceLogin> => {
    const response = await fetchImpl("https://github.com/login/device/code", {
      body: new URLSearchParams({ client_id: DEFAULT_GITHUB_OAUTH_CLIENT_ID }),
      headers: jsonHeaders,
      method: "POST"
    });
    const payload = await readJsonResponse<GitHubDeviceCodeResponse>(response);
    if (payload.error) {
      throw new Error(payload.error_description ?? payload.error);
    }
    if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
      throw new Error("GitHub device login response is incomplete");
    }

    const id = randomUUID();
    const expiresAtMs = Date.now() + (payload.expires_in ?? 900) * 1000;
    const intervalSeconds = payload.interval ?? 5;
    pendingLogins.set(id, {
      deviceCode: payload.device_code,
      expiresAtMs,
      intervalSeconds,
      nextPollAtMs: 0
    });

    return {
      id,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      expiresAt: new Date(expiresAtMs).toISOString(),
      intervalSeconds
    };
  };

  const pollDeviceLogin = async (id: string): Promise<GitHubDeviceLoginResult> => {
    const pending = pendingLogins.get(id);
    if (!pending) {
      return {
        state: "expired",
        message: "GitHub login session has expired"
      };
    }
    if (Date.now() >= pending.expiresAtMs) {
      pendingLogins.delete(id);
      return {
        state: "expired",
        message: "GitHub login code expired"
      };
    }

    const now = Date.now();
    if (now < pending.nextPollAtMs) {
      return {
        state: "pending",
        message: "Waiting for GitHub authorization",
        retryAfterSeconds: Math.max(1, Math.ceil((pending.nextPollAtMs - now) / 1000))
      };
    }

    // Reserve the next poll window before awaiting fetch so overlapping renderer calls cannot race.
    pending.nextPollAtMs = now + pending.intervalSeconds * 1000;

    const response = await fetchImpl("https://github.com/login/oauth/access_token", {
      body: new URLSearchParams({
        client_id: DEFAULT_GITHUB_OAUTH_CLIENT_ID,
        device_code: pending.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }),
      headers: jsonHeaders,
      method: "POST"
    });
    const payload = await readJsonResponse<GitHubAccessTokenResponse>(response);
    if (payload.error === "authorization_pending") {
      return {
        state: "pending",
        message: "Waiting for GitHub authorization",
        retryAfterSeconds: pending.intervalSeconds
      };
    }
    if (payload.error === "slow_down") {
      pending.intervalSeconds = Math.max(
        pending.intervalSeconds + 5,
        payload.interval ?? 0
      );
      pending.nextPollAtMs = now + pending.intervalSeconds * 1000;
      return {
        state: "pending",
        message: "Waiting for GitHub authorization",
        retryAfterSeconds: pending.intervalSeconds
      };
    }
    if (payload.error === "expired_token") {
      pendingLogins.delete(id);
      return {
        state: "expired",
        message: "GitHub login code expired"
      };
    }
    if (payload.error === "access_denied") {
      pendingLogins.delete(id);
      return {
        state: "denied",
        message: "GitHub authorization was denied"
      };
    }
    if (payload.error) {
      throw new Error(payload.error_description ?? payload.error);
    }
    if (!payload.access_token) {
      throw new Error("GitHub access token response is missing access_token");
    }

    await tokenStore.writeToken(payload.access_token);
    pendingLogins.delete(id);
    return {
      state: "signed-in",
      status: await readStatus()
    };
  };

  const signOut = async () => {
    await tokenStore.clearToken();
    pendingLogins.clear();
    return readStatus();
  };

  return {
    pollDeviceLogin,
    readAccessToken,
    readStatus,
    signOut,
    startDeviceLogin
  };
};
