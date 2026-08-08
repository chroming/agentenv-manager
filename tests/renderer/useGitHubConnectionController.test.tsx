// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEnvApi,
  GitHubAuthStatus,
  GitHubDeviceLogin
} from "../../src/shared/types";
import { useGitHubConnectionController } from "../../src/renderer/hooks/useGitHubConnectionController";

const deviceLogin: GitHubDeviceLogin = {
  id: "login-1",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresAt: "2026-08-08T12:00:00.000Z",
  intervalSeconds: 5
};

const signedInStatus: GitHubAuthStatus = {
  state: "signed-in",
  user: { login: "octocat" }
};

const createApi = () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
  openGitHubDevicePage: vi.fn().mockResolvedValue(undefined),
  pollGitHubDeviceLogin: vi.fn().mockResolvedValue({ state: "pending" }),
  readGitHubAuthStatus: vi.fn().mockResolvedValue({ state: "configured" }),
  signOutGitHub: vi.fn().mockResolvedValue({ state: "signed-out" }),
  startGitHubDeviceLogin: vi.fn().mockResolvedValue(deviceLogin)
}) as unknown as AgentEnvApi;

const renderController = (api = createApi()) => {
  const onError = vi.fn();
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const onStatusReset = vi.fn();
  const onOpenPage = vi.fn((url: string) => api.openGitHubDevicePage(url));
  const hook = renderHook(() =>
    useGitHubConnectionController({
      onError,
      onOpenPage,
      onRefresh,
      onStatusReset
    })
  );
  return { ...hook, api, onError, onOpenPage, onRefresh, onStatusReset };
};

describe("useGitHubConnectionController", () => {
  beforeEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: createApi()
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts GitHub device login and opens the verification page", async () => {
    const api = createApi();
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });
    const { result, onError, onOpenPage, onStatusReset } = renderController(api);

    await act(() => result.current.actions.startLogin());

    expect(onError).toHaveBeenCalledWith(undefined);
    expect(onStatusReset).toHaveBeenCalledOnce();
    expect(api.startGitHubDeviceLogin).toHaveBeenCalledOnce();
    expect(api.readGitHubAuthStatus).toHaveBeenCalledOnce();
    expect(onOpenPage).toHaveBeenCalledWith(deviceLogin.verificationUri);
    expect(result.current.state).toMatchObject({
      authStatus: { state: "configured" },
      codeCopied: false,
      deviceLogin,
      loginChecking: false,
      loginMessage: "Waiting for authorization. This page updates automatically."
    });
  });

  it("accepts a completed login and refreshes application data", async () => {
    const api = createApi();
    vi.mocked(api.pollGitHubDeviceLogin).mockResolvedValue({
      state: "signed-in",
      status: signedInStatus
    });
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });
    const { result, onRefresh } = renderController(api);

    await act(() => result.current.actions.startLogin());
    await act(() => result.current.actions.pollLogin());

    expect(api.pollGitHubDeviceLogin).toHaveBeenCalledWith(deviceLogin.id);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result.current.state).toMatchObject({
      authStatus: signedInStatus,
      codeCopied: false,
      deviceLogin: undefined,
      loginChecking: false,
      loginMessage: "Signed in as octocat"
    });
  });

  it("copies the current device code and clears the copied state", async () => {
    vi.useFakeTimers();
    const api = createApi();
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });
    const { result } = renderController(api);

    await act(() => result.current.actions.startLogin());
    await act(() => result.current.actions.copyDeviceCode());

    expect(api.copyText).toHaveBeenCalledWith(deviceLogin.userCode);
    expect(result.current.state.codeCopied).toBe(true);

    act(() => vi.advanceTimersByTime(1800));
    expect(result.current.state.codeCopied).toBe(false);
  });

  it("signs out and clears an active device login", async () => {
    const api = createApi();
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });
    const { result } = renderController(api);

    await act(() => result.current.actions.startLogin());
    await act(() => result.current.actions.signOut());

    expect(api.signOutGitHub).toHaveBeenCalledOnce();
    expect(result.current.state).toMatchObject({
      authStatus: { state: "signed-out" },
      deviceLogin: undefined,
      loginChecking: false,
      loginMessage: "Signed out of GitHub"
    });
  });

  it("polls again when the window regains focus", async () => {
    const api = createApi();
    Object.defineProperty(window, "agentEnv", { configurable: true, value: api });
    const { result } = renderController(api);

    await act(() => result.current.actions.startLogin());
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => {
      expect(api.pollGitHubDeviceLogin).toHaveBeenCalledWith(deviceLogin.id);
    });
  });
});
