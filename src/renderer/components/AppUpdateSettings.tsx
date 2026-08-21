import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentEnvSettings, AppUpdateStatus } from "../../shared/types";
import { useI18n } from "../i18n";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { Button, ProgressBar, Switch } from "./ui";

interface AppUpdateSettingsProps {
  busy: boolean;
  settings: AgentEnvSettings;
  onChange(input: Partial<AgentEnvSettings>): void;
  onOpenConnections?: () => void;
}

const workingPhases = new Set<AppUpdateStatus["phase"]>([
  "checking",
  "downloading",
  "installing"
]);

type PendingUpdateAction = "check" | "download" | "install";

export const AppUpdateSettings = ({
  busy,
  settings,
  onChange,
  onOpenConnections
}: AppUpdateSettingsProps) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<AppUpdateStatus>();
  const [pendingAction, setPendingAction] = useState<PendingUpdateAction>();

  useEffect(() => {
    let active = true;
    void window.agentEnv.readAppUpdateStatus().then((next) => {
      if (active) setStatus(next);
    });
    const unsubscribe = window.agentEnv.onAppUpdateStatusChanged((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = async (
    actionName: PendingUpdateAction,
    action: () => Promise<AppUpdateStatus>
  ) => {
    setPendingAction(actionName);
    try {
      const next = await action();
      setStatus(next);
    } finally {
      setPendingAction(undefined);
    }
  };
  const working = Boolean(pendingAction) || (status ? workingPhases.has(status.phase) : true);
  const serviceWorkingPhase = status && workingPhases.has(status.phase)
    ? status.phase
    : undefined;
  const effectivePhase = serviceWorkingPhase ?? (
    pendingAction === "check"
      ? "checking"
      : pendingAction === "download"
        ? "downloading"
        : pendingAction === "install"
          ? "installing"
          : status?.phase
  );
  const connectionIssue = status?.failureCode === "rate-limited" ||
    status?.failureCode === "authentication-required";
  const channelCopy = status?.installChannel === "homebrew"
    ? t("Installed with Homebrew")
    : status?.installChannel === "direct"
      ? t("Installed directly")
      : status?.installChannel === "development"
        ? t("Development build")
        : t("Automatic installation unavailable");
  const statusCopy = !status
    ? t("Reading update status…")
    : effectivePhase === "checking"
      ? t("Checking for updates…")
      : effectivePhase === "downloading"
        ? t("Downloading verified update…")
        : effectivePhase === "installing"
          ? t("Installing verified update…")
        : status.phase === "ready"
          ? t("Version {{version}} is ready to install", {
              version: status.release?.version ?? ""
            })
          : status.phase === "available"
            ? t("Version {{version}} is available", {
                version: status.release?.version ?? ""
              })
            : status.phase === "up-to-date"
              ? t("AgentEnv Manager is up to date")
              : status.phase === "failed"
                  ? status.failureCode === "download-failed" || status.failureCode === "install-failed"
                    ? t("Update failed")
                    : t("Update check failed")
                  : t("Updates have not been checked yet");
  const latestVersion = status?.release?.version ?? (
    status?.phase === "up-to-date" ? status.currentVersion : undefined
  );
  const latestVersionCopy = effectivePhase === "checking"
    ? t("Checking…")
    : latestVersion ?? t("Not checked");
  const statusTone = working
    ? "working"
    : status?.phase === "up-to-date"
      ? "success"
      : status?.phase === "available" || status?.phase === "ready"
        ? "available"
        : status?.phase === "failed"
          ? "error"
          : "neutral";

  return (
    <section className="resource-section settings-section app-update-settings" aria-labelledby="app-updates-heading">
      <div className="settings-section-title">
        <div className="resource-heading" id="app-updates-heading">{t("App updates")}</div>
      </div>
      <div className="settings-preference-list">
        <SettingsPreferenceRow
          className={`app-update-summary is-${statusTone}`}
          label={statusCopy}
          description={<>
            <span className="app-update-versions" aria-label={t("Application versions")}>
              <span>{t("Current version")} <strong>{status?.currentVersion ?? "—"}</strong></span>
              <span>{t("Latest version")} <strong>{latestVersionCopy}</strong></span>
            </span>
            <span>{channelCopy}</span>
            {working ? (
              <ProgressBar className="app-update-progress" label={statusCopy} />
            ) : null}
            {status?.phase === "available" && !status.automaticInstallSupported ? (
              <span className="app-update-note">
                {t("This application folder cannot be updated automatically. Install with Homebrew or move the app to a writable Applications folder.")}
              </span>
            ) : null}
            {status?.phase === "failed" && status.message ? (
              <code className="app-update-error">{t(status.message)}</code>
            ) : null}
          </>}
          control={<span className="app-update-actions">
          {connectionIssue && onOpenConnections ? (
            <Button onClick={onOpenConnections}>{t("Connections")}</Button>
          ) : null}
          {status && ["available", "downloading"].includes(status.phase) &&
          status.automaticInstallSupported ? (
            <Button
              busy={pendingAction === "download" || (
                !pendingAction && status.phase === "downloading"
              )}
              disabled={busy || working}
              icon={<Download size={15} />}
              onClick={() => void run("download", () => window.agentEnv.downloadAppUpdate())}
            >
              {t("Download")}
            </Button>
          ) : null}
          {status && ["ready", "installing"].includes(status.phase) ? (
            <Button
              variant="primary"
              busy={pendingAction === "install" || (
                !pendingAction && status.phase === "installing"
              )}
              disabled={busy}
              icon={<RotateCcw size={15} />}
              onClick={() => void run("install", () => window.agentEnv.installAppUpdate())}
            >
              {t("Restart and update")}
            </Button>
          ) : null}
          {status?.phase === "available" && !status.automaticInstallSupported && status.release ? (
            <Button onClick={() => void window.agentEnv.openExternalUrl(status.release!.releaseUrl)}>
              {t("Open release")}
            </Button>
          ) : null}
          {status?.phase !== "ready" ? (
            <Button
              busy={pendingAction === "check" || (
                !pendingAction && status?.phase === "checking"
              )}
              disabled={busy || working}
              icon={<RefreshCw size={15} />}
              onClick={() => void run("check", () => window.agentEnv.checkAppUpdate())}
            >
              {status?.phase === "failed" ? t("Try again") : t("Check now")}
            </Button>
          ) : null}
          </span>}
        />
        <SettingsPreferenceRow
          label={t("Automatic checks")}
          description={t("Checks for stable releases after startup.")}
          control={<Switch
            checked={settings.appUpdateAutoCheckEnabled !== false}
            disabled={busy}
            label={t("Automatic update checks")}
            onClick={() => onChange({
              appUpdateAutoCheckEnabled: settings.appUpdateAutoCheckEnabled === false
            })}
          />}
        />
        {status?.automaticInstallSupported ? (
          <>
            <SettingsPreferenceRow
              className={`settings-dependent-row${
                settings.appUpdateAutoCheckEnabled === false ? " is-disabled" : ""
              }`}
              label={t("Prepare updates")}
              description={t("Downloads and verifies the official update in the background.")}
              control={<Switch
                checked={settings.appUpdateAutoDownloadEnabled !== false}
                disabled={busy || settings.appUpdateAutoCheckEnabled === false}
                label={t("Automatically download updates")}
                onClick={() => onChange({
                  appUpdateAutoDownloadEnabled: settings.appUpdateAutoDownloadEnabled === false
                })}
              />}
            />
            {status.installChannel === "homebrew" ? (
              <SettingsPreferenceRow
                label={t("Finish updates after quitting")}
                description={t("Starts an already prepared Homebrew update after AgentEnv Manager closes, so quitting is not delayed.")}
                control={<Switch
                  checked={settings.appUpdateInstallOnQuit !== false}
                  disabled={busy}
                  label={t("Automatically finish prepared updates after quitting")}
                  onClick={() => onChange({
                    appUpdateInstallOnQuit: settings.appUpdateInstallOnQuit === false
                  })}
                />}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
};
