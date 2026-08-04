import { CheckCircle2, Copy, ExternalLink, GitFork, RefreshCw } from "lucide-react";
import type { GitHubAuthStatus, GitHubDeviceLogin } from "../../shared/types";
import { useI18n } from "../i18n";
import { Button } from "./ui";

interface GitHubConnectionSettingsProps {
  authStatus: GitHubAuthStatus;
  busy: boolean;
  codeCopied: boolean;
  deviceLogin?: GitHubDeviceLogin;
  loginChecking: boolean;
  loginMessage: string;
  onCheckLogin: () => void;
  onCopyCode: () => void;
  onOpenDevicePage: (url: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export const GitHubConnectionSettings = ({
  authStatus,
  busy,
  codeCopied,
  deviceLogin,
  loginChecking,
  loginMessage,
  onCheckLogin,
  onCopyCode,
  onOpenDevicePage,
  onSignIn,
  onSignOut
}: GitHubConnectionSettingsProps) => {
  const { formatDate, formatNumber, t } = useI18n();

  return (
    <section
      className="resource-section github-settings-section"
      id="github-connection-settings"
      tabIndex={-1}
      aria-label={t("GitHub OAuth settings")}
    >
      <div className="settings-section-header github-account-header">
        <div className="github-account-identity">
          <span className="settings-service-icon" aria-hidden="true">
            <GitFork size={20} strokeWidth={2} />
          </span>
          <div>
            <div className="resource-heading">GitHub</div>
            <p className="settings-muted">
              {authStatus.state === "signed-in"
                ? authStatus.user
                  ? t("Connected as {{login}}", { login: authStatus.user.login })
                  : t("Connected; GitHub status is temporarily unavailable")
                : deviceLogin
                  ? t("Authorize AgentEnv Manager in your browser")
                  : t("Connect for reliable GitHub imports and update checks")}
            </p>
          </div>
        </div>
        <div className="github-settings-actions">
          {authStatus.state === "signed-in" ? (
            <Button
              size="compact"
              variant="secondary"
              disabled={busy || loginChecking}
              onClick={onSignOut}
            >
              {t("Sign out")}
            </Button>
          ) : !deviceLogin ? (
            <Button
              busy={loginChecking}
              disabled={busy || loginChecking}
              icon={<GitFork size={15} strokeWidth={2.2} aria-hidden="true" />}
              onClick={onSignIn}
            >
              {loginChecking ? t("Connecting...") : t("Sign in with GitHub")}
            </Button>
          ) : null}
        </div>
      </div>

      {deviceLogin ? (
        <div className="github-device-card">
          <button
            className={`github-device-code${codeCopied ? " is-copied" : ""}`}
            type="button"
            aria-label={t("Copy GitHub device code {{code}}", { code: deviceLogin.userCode })}
            onClick={onCopyCode}
          >
            <span>{t("Device code")}</span>
            <strong>{deviceLogin.userCode}</strong>
            <span className="github-device-copy-state">
              {codeCopied ? (
                <CheckCircle2 size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              {codeCopied ? t("Copied") : t("Copy")}
            </span>
          </button>
          <div className="github-device-status" role="status" aria-live="polite">
            <RefreshCw
              className={loginChecking ? "is-spinning" : ""}
              size={15}
              aria-hidden="true"
            />
            <span>
              {loginMessage || t("Waiting for authorization. This page updates automatically.")}
            </span>
          </div>
          <div className="github-device-actions">
            <Button
              icon={<ExternalLink size={15} aria-hidden="true" />}
              onClick={() => onOpenDevicePage(deviceLogin.verificationUri)}
            >
              {t("Open GitHub")}
            </Button>
            <Button
              busy={loginChecking}
              disabled={loginChecking}
              variant="secondary"
              onClick={onCheckLogin}
            >
              {t("Check now")}
            </Button>
          </div>
        </div>
      ) : null}

      {authStatus.state === "signed-in" ? (
        <div className="github-connected-row" role="status">
          <span className="github-connected-indicator" aria-hidden="true" />
          <strong>{t("Connected")}</strong>
          {authStatus.rateLimit ? (
            <span>
              {t("{{remaining}} of {{limit}} API requests remaining · resets {{time}}", {
                remaining: formatNumber(authStatus.rateLimit.remaining),
                limit: formatNumber(authStatus.rateLimit.limit),
                time: formatDate(authStatus.rateLimit.resetAt)
              })}
            </span>
          ) : null}
        </div>
      ) : loginMessage && !deviceLogin ? (
        <div className="github-login-result" role="status">{loginMessage}</div>
      ) : null}

      {authStatus.error ? (
        <div
          className={`github-login-result${authStatus.verification === "unavailable" ? "" : " github-login-result--error"}`}
          role={authStatus.verification === "unavailable" ? "status" : "alert"}
        >
          {authStatus.error}
        </div>
      ) : null}
    </section>
  );
};
