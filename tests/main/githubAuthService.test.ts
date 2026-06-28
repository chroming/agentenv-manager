import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFileGitHubTokenStore,
  createGitHubAuthService
} from "../../src/main/githubAuthService";
import { createPaths } from "../../src/main/paths";
import { createSettingsStore } from "../../src/main/settingsStore";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(init?.headers))
    }
  });

describe("GitHub auth service", () => {
  it("runs the OAuth device flow and stores the access token securely", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-github-auth-"));
    const paths = createPaths({ appDataRoot: root });
    const settingsStore = createSettingsStore(paths);
    await settingsStore.updateSettings({ githubOAuthClientId: "client-123" });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://github.com/login/device/code") {
        return jsonResponse({
          device_code: "device-abc",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1
        });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        return jsonResponse({ access_token: "token-xyz" });
      }
      if (url === "https://api.github.com/user") {
        return jsonResponse({
          login: "octocat",
          name: "The Octocat",
          avatar_url: "https://github.com/images/error/octocat_happy.gif"
        });
      }
      if (url === "https://api.github.com/rate_limit") {
        return jsonResponse({
          resources: {
            core: {
              limit: 5000,
              remaining: 4999,
              reset: 1783500000
            }
          }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const tokenStore = createFileGitHubTokenStore(paths, {
      decryptString: (buffer) => buffer.toString("utf8"),
      encryptString: (value) => Buffer.from(value, "utf8"),
      isEncryptionAvailable: () => true
    });
    const service = createGitHubAuthService({
      fetch: fetchMock,
      settingsStore,
      tokenStore
    });

    const login = await service.startDeviceLogin();
    expect(login).toMatchObject({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      intervalSeconds: 1
    });

    const result = await service.pollDeviceLogin(login.id);
    expect(result.state).toBe("signed-in");
    await expect(service.readAccessToken()).resolves.toBe("token-xyz");
    await expect(service.readStatus()).resolves.toMatchObject({
      state: "signed-in",
      clientId: "client-123",
      user: {
        login: "octocat",
        name: "The Octocat"
      },
      rateLimit: {
        limit: 5000,
        remaining: 4999,
        resetAt: "2026-07-08T08:40:00.000Z"
      }
    });
  });

  it("keeps a device login pending without storing a token", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-github-auth-"));
    const paths = createPaths({ appDataRoot: root });
    const settingsStore = createSettingsStore(paths);
    await settingsStore.updateSettings({ githubOAuthClientId: "client-123" });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://github.com/login/device/code") {
        return jsonResponse({
          device_code: "device-abc",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1
        });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        return jsonResponse({ error: "authorization_pending" });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const tokenStore = createFileGitHubTokenStore(paths, {
      decryptString: (buffer) => buffer.toString("utf8"),
      encryptString: (value) => Buffer.from(value, "utf8"),
      isEncryptionAvailable: () => true
    });
    const service = createGitHubAuthService({
      fetch: fetchMock,
      settingsStore,
      tokenStore
    });

    const login = await service.startDeviceLogin();
    const result = await service.pollDeviceLogin(login.id);

    expect(result).toEqual({
      state: "pending",
      message: "Waiting for GitHub authorization"
    });
    await expect(service.readAccessToken()).resolves.toBeUndefined();
  });

  it("clears the saved GitHub token on sign out", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-github-auth-"));
    const paths = createPaths({ appDataRoot: root });
    const settingsStore = createSettingsStore(paths);
    await settingsStore.updateSettings({ githubOAuthClientId: "client-123" });
    const tokenStore = createFileGitHubTokenStore(paths, {
      decryptString: (buffer) => buffer.toString("utf8"),
      encryptString: (value) => Buffer.from(value, "utf8"),
      isEncryptionAvailable: () => true
    });
    await tokenStore.writeToken("token-xyz");
    const service = createGitHubAuthService({
      fetch: vi.fn(),
      settingsStore,
      tokenStore
    });

    await service.signOut();

    await expect(service.readAccessToken()).resolves.toBeUndefined();
    await expect(service.readStatus()).resolves.toMatchObject({
      state: "configured",
      clientId: "client-123"
    });
  });
});
