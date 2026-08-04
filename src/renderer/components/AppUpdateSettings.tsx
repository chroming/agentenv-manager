import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentEnvSettings, AppUpdateStatus } from "../../shared/types";
import { useI18n } from "../i18n";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { Button, Switch } from "./ui";

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

export const AppUpdateSettings = ({
  busy,
  settings,
  onChange,
  onOpenConnections
}: AppUpdateSettingsProps) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<AppUpdateStatus>();

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

  const run = async (action: () => Promise<AppUpdateStatus>) => {
    const next = await action();
    setStatus(next);
  };
  const working = status ? workingPhases.has(status.phase) : true;
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
    : status.phase === "checking"
      ? t("Checking for updates…")
      : status.phase === "downloading"
        ? t("Downloading verified update…")
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
              : status.phase === "installing"
                ? t("Installing verified update…")
                : status.phase === "failed"
                  ? t("Update check failed")
                  : t("Updates have not been checked yet");

  return (
    <section className="resource-section settings-section app-update-settings" aria-labelledby="app-updates-heading">
      <div className="settings-section-title">
        <div className="resource-heading" id="app-updates-heading">{t("App updates")}</div>
      </div>
      <div className="app-update-summary">
        <span className="settings-preference-copy">
          <strong>{statusCopy}</strong>
          <small>{channelCopy}</small>
        </span>
        <span className="app-update-actions">
          {connectionIssue && onOpenConnections ? (
            <Button onClick={onOpenConnections}>{t("Connections")}</Button>
          ) : null}
          {status && ["available", "downloading"].includes(status.phase) &&
          status.automaticInstallSupported ? (
            <Button
              busy={status.phase === "downloading"}
              disabled={busy || working}
              icon={<Download size={15} />}
              onClick={() => void run(() => window.agentEnv.downloadAppUpdate())}
            >
              {t("Download")}
            </Button>
          ) : null}
          {status?.phase === "ready" ? (
            <Button
              variant="primary"
              disabled={busy}
              icon={<RotateCcw size={15} />}
              onClick={() => void run(() => window.agentEnv.installAppUpdate())}
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
              busy={status?.phase === "checking"}
              disabled={busy || working}
              icon={<RefreshCw size={15} />}
              onClick={() => void run(() => window.agentEnv.checkAppUpdate())}
            >
              {status?.phase === "failed" ? t("Try again") : t("Check now")}
            </Button>
          ) : null}
        </span>
        {status?.phase === "available" && !status.automaticInstallSupported ? (
          <p className="app-update-note">
            {t("Install with the official Homebrew Cask to update automatically. Manual downloads remain checksum-verified on the official Release page.")}
          </p>
        ) : null}
        {status?.phase === "failed" && status.message ? (
          <code className="app-update-error">{t(status.message)}</code>
        ) : null}
      </div>
      <div className="settings-preference-list">
        <SettingsPreferenceRow
          label={t("Automatic checks")}
          description={t("Checks the official stable Release after startup without delaying the app.")}
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
              description={t("Homebrew downloads the checksum-bound package in the background.")}
              control={<Switch
                checked={settings.appUpdateAutoDownloadEnabled !== false}
                disabled={busy || settings.appUpdateAutoCheckEnabled === false}
                label={t("Automatically download updates")}
                onClick={() => onChange({
                  appUpdateAutoDownloadEnabled: settings.appUpdateAutoDownloadEnabled === false
                })}
              />}
            />
            <SettingsPreferenceRow
              label={t("Install when quitting")}
              description={t("Installs only an already downloaded Homebrew update after AgentEnv work has stopped.")}
              control={<Switch
                checked={settings.appUpdateInstallOnQuit !== false}
                disabled={busy}
                label={t("Install ready update when quitting")}
                onClick={() => onChange({
                  appUpdateInstallOnQuit: settings.appUpdateInstallOnQuit === false
                })}
              />}
            />
          </>
        ) : null}
      </div>
    </section>
  );
};
