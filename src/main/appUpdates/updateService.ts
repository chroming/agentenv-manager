import type { AppUpdateStatus } from "../../shared/appUpdates";
import type { AgentEnvSettings } from "../../shared/types";
import type { HomebrewAdapter } from "./homebrewAdapter";
import type { ReleaseClient } from "./releaseClient";

export interface AppUpdateService {
  readStatus(): Promise<AppUpdateStatus>;
  check(options?: { manual?: boolean }): Promise<AppUpdateStatus>;
  download(): Promise<AppUpdateStatus>;
  install(options?: { restart?: boolean }): Promise<AppUpdateStatus>;
  isReadyToInstall(): boolean;
  shouldInstallOnQuit(): Promise<boolean>;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const createAppUpdateService = (options: {
  currentVersion: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  releaseClient: ReleaseClient;
  homebrew: HomebrewAdapter;
  settingsStore: Pick<{
    readSettings(): Promise<Pick<AgentEnvSettings,
      "appUpdateAutoCheckEnabled" | "appUpdateAutoDownloadEnabled" | "appUpdateInstallOnQuit">>;
  }, "readSettings">;
  now?: () => Date;
  onStatusChanged?: (status: AppUpdateStatus) => void;
  onInstalled?: (restart: boolean) => void;
}): AppUpdateService => {
  const now = options.now ?? (() => new Date());
  let status: AppUpdateStatus = {
    phase: options.packaged ? "idle" : "disabled",
    currentVersion: options.currentVersion,
    installChannel: options.packaged ? "direct" : "development",
    automaticInstallSupported: false
  };
  let currentCheck: Promise<AppUpdateStatus> | undefined;

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
    return brew.managed
      ? { installChannel: "homebrew" as const, supported: true }
      : { installChannel: "direct" as const, supported: false };
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
    if (status.phase !== "available" || status.installChannel !== "homebrew") {
      throw new Error("No Homebrew update is ready to download");
    }
    updateStatus({ ...status, phase: "downloading", message: undefined, failureCode: undefined });
    try {
      await options.homebrew.download();
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
          return updateStatus({ ...base, phase: "up-to-date" });
        }
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
          failureCode: "check-failed",
          message: errorMessage(error)
        });
      }
    })().finally(() => {
      currentCheck = undefined;
    });
    return currentCheck;
  };

  const install = async (installOptions: { restart?: boolean } = {}) => {
    if (status.phase !== "ready" || status.installChannel !== "homebrew") {
      throw new Error("No verified Homebrew update is ready to install");
    }
    updateStatus({ ...status, phase: "installing", message: undefined, failureCode: undefined });
    try {
      await options.homebrew.install(status.release?.version ?? "");
      const next = updateStatus({
        phase: "up-to-date",
        currentVersion: status.release?.version ?? options.currentVersion,
        installChannel: "homebrew",
        automaticInstallSupported: true,
        checkedAt: now().toISOString()
      });
      options.onInstalled?.(installOptions.restart === true);
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

  return {
    readStatus,
    check,
    download,
    install,
    isReadyToInstall: () => status.phase === "ready" && status.installChannel === "homebrew",
    shouldInstallOnQuit: async () =>
      status.phase === "ready" &&
      status.installChannel === "homebrew" &&
      (await options.settingsStore.readSettings()).appUpdateInstallOnQuit !== false
  };
};
