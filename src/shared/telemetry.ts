import type { AppInstallChannel } from "./appUpdates";

export interface TelemetryDailyStartupPayload {
  schemaVersion: 2;
  event: "agentenv_daily_startup";
  date: string;
  appVersion: string;
  platform: "darwin" | "win32" | "linux";
  osMajor: string;
  arch: string;
  locale: "en" | "zh_CN" | "zh_TW";
  installChannel: AppInstallChannel;
}

export interface TelemetryPreview {
  enabledInBuild: boolean;
  destination: "PostHog Cloud";
  installationId?: string;
  willCreateInstallationId: boolean;
  payload: TelemetryDailyStartupPayload;
}

export type TelemetrySendResult = {
  status: "disabled" | "already-sent" | "sent" | "failed";
};
