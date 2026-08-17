import type { AppUpdateStatus } from "../../shared/appUpdates";
import type { AgentEnvSettings } from "../../shared/types";
import type { DirectUpdateAdapter } from "./directUpdateAdapter";
import type { HomebrewAdapter } from "./homebrewAdapter";
import {
  ReleaseClientError,
  type ReleaseClient,
  type TrustedRelease
} from "./releaseClient";

export interface AppUpdateService {
  readStatus(): Promise<AppUpdateStatus>;
  check(options?: { manual?: boolean }): Promise<AppUpdateStatus>;
  download(): Promise<AppUpdateStatus>;
  install(options?: { restart?: boolean }): Promise<AppUpdateStatus>;
  isReadyToInstall(): boolean;
  canScheduleInstallOnQuit(): boolean;
  scheduleInstallOnQuit(): Promise<boolean>;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const createAppUpdateService = (options: {
  currentVersion: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  releaseClient: ReleaseClient;
  homebrew: HomebrewAdapter;
  direct: DirectUpdateAdapter;
  settingsStore: Pick<{
    readSettings(): Promise<Pick<AgentEnvSettings,
      "appUpdateAutoCheckEnabled" | "appUpdateAutoDownloadEnabled" | "appUpdateInstallOnQuit">>;
  }, "readSettings">;
  now?: () => Date;
  startupFailure?: string;
  onStatusChanged?: (status: AppUpdateStatus) => void;
  onInstalled?: (restart: boolean, channel: "homebrew" | "direct") => void;
}): AppUpdateService => {
  const now = options.now ?? (() => new Date());
  let status: AppUpdateStatus = {
    phase: options.startupFailure ? "failed" : options.packaged ? "idle" : "disabled",
    currentVersion: options.currentVersion,
    installChannel: options.startupFailure ? "homebrew" : options.packaged ? "direct" : "development",
    automaticInstallSupported: Boolean(options.startupFailure),
    ...(options.startupFailure
      ? { failureCode: "install-failed", message: options.startupFailure }
      : {})
  };
  let currentCheck: Promise<AppUpdateStatus> | undefined;
  let trustedRelease: TrustedRelease | undefined;

  const updateStatus = (next: AppUpdateStatus) => {
    status = next;
    options.onStatusChanged?.(status);
    return status;
  };

  const resolveChannel = async (refresh = false) => {
    if (!options.packaged) return { installChannel: "development" as const, supported: false };
    if (options.platform !== "darwin") {
      return { installChannel: "unsupported" as const, supported: false };
    }
    const brew = await options.homebrew.inspect({ refresh });
    if (brew.managed) return { installChannel: "homebrew" as const, supported: true };
    const direct = await options.direct.inspect();
    return {
      installChannel: "direct" as const,
      supported: direct.available
    };
  };

  const readStatus = async () => {
    if (status.phase === "idle" || status.phase === "disabled") {
      const channel = await resolveChannel();
      status = {
        ...status,
        installChannel: channel.installChannel,
        automaticInstallSupported: channel.supported
      };
    }
    return status;
  };

  const download = async () => {
    if (
      status.phase !== "available" ||
      !status.automaticInstallSupported ||
      !trustedRelease
    ) {
      throw new Error("No verified update is ready to download");
    }
    updateStatus({ ...status, phase: "downloading", message: undefined, failureCode: undefined });
    try {
      if (status.installChannel === "homebrew") {
        await options.homebrew.download();
      } else if (status.installChannel === "direct") {
        await options.direct.download(trustedRelease);
      } else {
        throw new Error("This installation cannot be updated automatically");
      }
      return updateStatus({ ...status, phase: "ready" });
    } catch (error) {
      return updateStatus({
        ...status,
        phase: "failed",
        failureCode: "download-failed",
        message: errorMessage(error)
      });
    }
  };

  const check = (checkOptions: { manual?: boolean } = {}) => {
    if (currentCheck) return currentCheck;
    currentCheck = (async () => {
      const settings = await options.settingsStore.readSettings();
      const channel = await resolveChannel(checkOptions.manual === true);
      if (!options.packaged || (!checkOptions.manual && settings.appUpdateAutoCheckEnabled === false)) {
        return updateStatus({
          phase: "disabled",
          currentVersion: options.currentVersion,
          installChannel: channel.installChannel,
          automaticInstallSupported: channel.supported
        });
      }
      updateStatus({
        phase: "checking",
        currentVersion: options.currentVersion,
        installChannel: channel.installChannel,
        automaticInstallSupported: channel.supported
      });
      try {
        const release = await options.releaseClient.readLatest({
          platform: options.platform,
          arch: options.arch
        });
        const base = {
          currentVersion: options.currentVersion,
          installChannel: channel.installChannel,
          automaticInstallSupported: channel.supported,
          checkedAt: now().toISOString()
        };
        if (!options.releaseClient.isNewer(release.version, options.currentVersion)) {
          trustedRelease = undefined;
          return updateStatus({ ...base, phase: "up-to-date" });
        }
        trustedRelease = release;
        updateStatus({
          ...base,
          phase: "available",
          release: {
            version: release.version,
            tag: release.tag,
            releaseUrl: release.releaseUrl,
            publishedAt: release.publishedAt,
            notes: release.notes
          }
        });
        if (channel.supported && settings.appUpdateAutoDownloadEnabled !== false) return download();
        return status;
      } catch (error) {
        return updateStatus({
          phase: "failed",
          currentVersion: options.currentVersion,
          installChannel: channel.installChannel,
          automaticInstallSupported: channel.supported,
          checkedAt: now().toISOString(),
          failureCode: error instanceof ReleaseClientError ? error.code : "check-failed",
          message: errorMessage(error)
        });
      }
    })().finally(() => {
      currentCheck = undefined;
    });
    return currentCheck;
  };

  const install = async (installOptions: { restart?: boolean } = {}) => {
    if (
      status.phase !== "ready" ||
      !status.automaticInstallSupported ||
      !trustedRelease ||
      (status.installChannel !== "homebrew" && status.installChannel !== "direct")
    ) {
      throw new Error("No verified update is ready to install");
    }
    updateStatus({ ...status, phase: "installing", message: undefined, failureCode: undefined });
    try {
      const channel = status.installChannel;
      if (channel === "homebrew") {
        await options.homebrew.install(trustedRelease.version);
      } else {
        await options.direct.install(trustedRelease.version);
      }
      const next = updateStatus({
        phase: "up-to-date",
        currentVersion: trustedRelease.version,
        installChannel: channel,
        automaticInstallSupported: true,
        checkedAt: now().toISOString()
      });
      trustedRelease = undefined;
      options.onInstalled?.(installOptions.restart === true, channel);
      return next;
    } catch (error) {
      return updateStatus({
        ...status,
        phase: "failed",
        failureCode: "install-failed",
        message: errorMessage(error)
      });
    }
  };

  const canScheduleInstallOnQuit = () =>
    status.phase === "ready" &&
    status.installChannel === "homebrew" &&
    status.automaticInstallSupported &&
    Boolean(trustedRelease);

  const scheduleInstallOnQuit = async () => {
    if (!canScheduleInstallOnQuit() || !trustedRelease) return false;
    const settings = await options.settingsStore.readSettings();
    if (settings.appUpdateInstallOnQuit === false) return false;
    updateStatus({ ...status, phase: "installing", message: undefined, failureCode: undefined });
    try {
      await options.homebrew.scheduleInstallAfterQuit(trustedRelease.version);
      return true;
    } catch (error) {
      updateStatus({
        ...status,
        phase: "failed",
        failureCode: "install-failed",
        message: errorMessage(error)
      });
      return false;
    }
  };

  return {
    readStatus,
    check,
    download,
    install,
    isReadyToInstall: () =>
      status.phase === "ready" &&
      status.automaticInstallSupported &&
      (status.installChannel === "homebrew" || status.installChannel === "direct"),
    canScheduleInstallOnQuit,
    scheduleInstallOnQuit
  };
};
