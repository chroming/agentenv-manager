import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFileGitHubTokenStore,
  createGitHubAuthService
} from "../../src/main/githubAuthService";
import { createPaths } from "../../src/main/paths";

let root = "";

afterEach(async () => {
  vi.useRealTimers();
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
  it("clears an unreadable saved token without blocking local app startup", async () => {
    const clearToken = vi.fn(async () => undefined);
    const service = createGitHubAuthService({
      tokenStore: {
        clearToken,
        readToken: vi.fn(async () => {
          throw new Error("Error while decrypting ciphertext");
        }),
        writeToken: vi.fn()
      }
    });

    await expect(service.readStatus()).resolves.toEqual({
      state: "configured",
      clientId: "Ov23liOAxChYXPhAjVh8",
      error: "Saved GitHub sign-in was invalid and has been cleared. Sign in again to reconnect."
    });
    expect(clearToken).toHaveBeenCalledTimes(1);
  });

  it("uses the bundled OAuth Client ID", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-github-auth-"));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "https://github.com/login/device/code") {
        throw new Error(`Unexpected URL: ${url}`);
      }
      expect(init?.body?.toString()).toBe("client_id=Ov23liOAxChYXPhAjVh8");
      return jsonResponse({
        device_code: "device-abc",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5
      });
    });
    const service = createGitHubAuthService({
      fetch: fetchMock,
      tokenStore: {
        clearToken: vi.fn(),
        readToken: vi.fn(async () => undefined),
        writeToken: vi.fn()
      }
    });

    await expect(service.readStatus()).resolves.toEqual({
      state: "configured",
      clientId: "Ov23liOAxChYXPhAjVh8"
    });
    await expect(service.startDeviceLogin()).resolves.toMatchObject({
      userCode: "ABCD-1234"
    });
  });

  it("keeps a saved token when GitHub is temporarily unavailable", async () => {
    const clearToken = vi.fn(async () => undefined);
    const service = createGitHubAuthService({
      fetch: vi.fn(async () => {
        throw new Error("network offline");
      }),
      tokenStore: {
        clearToken,
        readToken: vi.fn(async () => "token-xyz"),
        writeToken: vi.fn()
      }
    });

    await expect(service.readStatus()).resolves.toMatchObject({
      state: "signed-in",
      verification: "unavailable",
      error: expect.stringContaining("network offline")
    });
    expect(clearToken).not.toHaveBeenCalled();
  });

  it("clears a saved token only when GitHub rejects its credentials", async () => {
    const clearToken = vi.fn(async () => undefined);
    const service = createGitHubAuthService({
      fetch: vi.fn(async () => jsonResponse(
        { message: "Bad credentials" },
        { status: 401, statusText: "Unauthorized" }
      )),
      tokenStore: {
        clearToken,
        readToken: vi.fn(async () => "revoked-token"),
        writeToken: vi.fn()
      }
    });

    await expect(service.readStatus()).resolves.toMatchObject({
      state: "configured",
      error: expect.stringContaining("invalid")
    });
    expect(clearToken).toHaveBeenCalledTimes(1);
  });

  it("runs the OAuth device flow and stores the access token securely", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-github-auth-"));
    const paths = createPaths({ appDataRoot: root });
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
      clientId: "Ov23liOAxChYXPhAjVh8",
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
      tokenStore
    });

    const login = await service.startDeviceLogin();
    const result = await service.pollDeviceLogin(login.id);

    expect(result).toEqual({
      state: "pending",
      message: "Waiting for GitHub authorization",
      retryAfterSeconds: 1
    });
    await expect(service.readAccessToken()).resolves.toBeUndefined();
  });

  it("backs off after GitHub slow_down and prevents overlapping token requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T00:00:00.000Z"));
    const tokenResponses = [
      { error: "slow_down", interval: 8 },
      { access_token: "token-after-wait" }
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://github.com/login/device/code") {
        return jsonResponse({
          device_code: "device-abc",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 2
        });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        return jsonResponse(tokenResponses.shift());
      }
      if (url === "https://api.github.com/user") {
        return jsonResponse({ login: "octocat" });
      }
      if (url === "https://api.github.com/rate_limit") {
        return jsonResponse({ resources: { core: { limit: 5000, remaining: 4999 } } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const writeToken = vi.fn(async () => undefined);
    const service = createGitHubAuthService({
      fetch: fetchMock,
      tokenStore: {
        clearToken: vi.fn(),
        readToken: vi.fn(async () => undefined),
        writeToken
      }
    });

    const login = await service.startDeviceLogin();
    await expect(service.pollDeviceLogin(login.id)).resolves.toEqual({
      state: "pending",
      message: "Waiting for GitHub authorization",
      retryAfterSeconds: 8
    });
    await expect(service.pollDeviceLogin(login.id)).resolves.toEqual({
      state: "pending",
      message: "Waiting for GitHub authorization",
      retryAfterSeconds: 8
    });
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("access_token"))).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(8000);
    await expect(service.pollDeviceLogin(login.id)).resolves.toMatchObject({ state: "signed-in" });
    expect(writeToken).toHaveBeenCalledWith("token-after-wait");
  });

  it("clears the saved GitHub token on sign out", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-github-auth-"));
    const paths = createPaths({ appDataRoot: root });
    const tokenStore = createFileGitHubTokenStore(paths, {
      decryptString: (buffer) => buffer.toString("utf8"),
      encryptString: (value) => Buffer.from(value, "utf8"),
      isEncryptionAvailable: () => true
    });
    await tokenStore.writeToken("token-xyz");
    const service = createGitHubAuthService({
      fetch: vi.fn(),
      tokenStore
    });

    await service.signOut();

    await expect(service.readAccessToken()).resolves.toBeUndefined();
    await expect(service.readStatus()).resolves.toMatchObject({
      state: "configured",
      clientId: "Ov23liOAxChYXPhAjVh8"
    });
  });
});
