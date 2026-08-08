import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GitHubAuthStatus,
  GitHubDeviceLogin,
  GitHubDeviceLoginResult
} from "../../shared/types";

interface UseGitHubConnectionControllerOptions {
  onError(error: string | undefined): void;
  onOpenPage(url: string): void | Promise<void>;
  onRefresh(): unknown | Promise<unknown>;
  onStatusReset(): void;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useGitHubConnectionController = ({
  onError,
  onOpenPage,
  onRefresh,
  onStatusReset
}: UseGitHubConnectionControllerOptions) => {
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus>({
    state: "signed-out"
  });
  const [deviceLogin, setDeviceLogin] = useState<GitHubDeviceLogin>();
  const [loginMessage, setLoginMessage] = useState("");
  const [loginChecking, setLoginChecking] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const loginPollingRef = useRef(false);
  const copyResetRef = useRef<number | undefined>(undefined);
  const callbacksRef = useRef({ onError, onOpenPage, onRefresh, onStatusReset });
  callbacksRef.current = { onError, onOpenPage, onRefresh, onStatusReset };

  const acceptAuthStatus = useCallback((status: GitHubAuthStatus) => {
    setAuthStatus(status);
  }, []);

  const openDevicePage = useCallback((url: string) =>
    callbacksRef.current.onOpenPage(url), []);

  const startLogin = useCallback(async () => {
    setLoginChecking(true);
    callbacksRef.current.onError(undefined);
    callbacksRef.current.onStatusReset();
    setLoginMessage("Opening GitHub authorization...");
    setCodeCopied(false);
    try {
      const login = await window.agentEnv.startGitHubDeviceLogin();
      setDeviceLogin(login);
      setAuthStatus(await window.agentEnv.readGitHubAuthStatus());
      setLoginMessage("Waiting for authorization. This page updates automatically.");
      await callbacksRef.current.onOpenPage(login.verificationUri);
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error));
      setLoginMessage("");
    } finally {
      setLoginChecking(false);
    }
  }, []);

  const pollLogin = useCallback(async (
    login = deviceLogin,
    showProgress = true
  ): Promise<GitHubDeviceLoginResult | undefined> => {
    if (!login || loginPollingRef.current) {
      return undefined;
    }
    loginPollingRef.current = true;
    setLoginChecking(true);
    callbacksRef.current.onError(undefined);
    callbacksRef.current.onStatusReset();
    if (showProgress) {
      setLoginMessage("Checking GitHub authorization...");
    }
    try {
      const result = await window.agentEnv.pollGitHubDeviceLogin(login.id);
      if (result.state === "signed-in") {
        const status = result.status ?? (await window.agentEnv.readGitHubAuthStatus());
        setAuthStatus(status);
        setDeviceLogin(undefined);
        setCodeCopied(false);
        setLoginMessage(
          status.user?.login ? `Signed in as ${status.user.login}` : "Signed in with GitHub"
        );
        await callbacksRef.current.onRefresh();
        return result;
      }
      if (result.state === "expired" || result.state === "denied") {
        setDeviceLogin(undefined);
      }
      setLoginMessage(
        result.state === "pending"
          ? "Waiting for authorization. This page updates automatically."
          : result.message ?? "GitHub authorization is still pending"
      );
      return result;
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error));
      return undefined;
    } finally {
      loginPollingRef.current = false;
      setLoginChecking(false);
    }
  }, [deviceLogin]);

  const copyDeviceCode = useCallback(async () => {
    if (!deviceLogin) {
      return;
    }
    try {
      await window.agentEnv.copyText(deviceLogin.userCode);
      setCodeCopied(true);
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => setCodeCopied(false), 1800);
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error));
    }
  }, [deviceLogin]);

  const signOut = useCallback(async () => {
    setLoginChecking(true);
    callbacksRef.current.onError(undefined);
    callbacksRef.current.onStatusReset();
    try {
      const status = await window.agentEnv.signOutGitHub();
      setAuthStatus(status);
      setDeviceLogin(undefined);
      setLoginMessage("Signed out of GitHub");
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error));
    } finally {
      setLoginChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!deviceLogin) {
      return undefined;
    }

    const login = deviceLogin;
    let cancelled = false;
    let timeoutId: number | undefined;
    let delayMs = Math.max(login.intervalSeconds * 1000, 1000);
    const schedule = () => {
      timeoutId = window.setTimeout(async () => {
        const result = await pollLogin(login, false);
        if (
          cancelled ||
          result?.state === "signed-in" ||
          result?.state === "expired" ||
          result?.state === "denied"
        ) {
          return;
        }
        delayMs = Math.max(
          (result?.retryAfterSeconds ?? login.intervalSeconds) * 1000,
          1000
        );
        schedule();
      }, delayMs);
    };
    const handleFocus = () => {
      void pollLogin(login, false);
    };

    schedule();
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", handleFocus);
    };
  }, [deviceLogin?.id, pollLogin]);

  useEffect(
    () => () => {
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current);
      }
    },
    []
  );

  return useMemo(() => ({
    state: {
      authStatus,
      codeCopied,
      deviceLogin,
      loginChecking,
      loginMessage
    },
    actions: {
      acceptAuthStatus,
      copyDeviceCode,
      openDevicePage,
      pollLogin,
      signOut,
      startLogin
    }
  }), [
    acceptAuthStatus,
    authStatus,
    codeCopied,
    copyDeviceCode,
    deviceLogin,
    loginChecking,
    loginMessage,
    openDevicePage,
    pollLogin,
    signOut,
    startLogin
  ]);
};
