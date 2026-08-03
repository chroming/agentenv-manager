import type { AppInstallChannel } from "./appUpdates";

export type TelemetryStartupOutcome = "ready" | "startup-failed";

export interface TelemetryDailyStartupPayload {
  schemaVersion: 1;
  event: "daily-startup";
  date: string;
  appVersion: string;
  platform: "darwin" | "win32" | "linux";
  osMajor: string;
  arch: string;
  locale: "en" | "zh_CN" | "zh_TW";
  installChannel: AppInstallChannel;
  outcome: TelemetryStartupOutcome;
}

export interface TelemetryPreview {
  enabledInBuild: boolean;
  payload: TelemetryDailyStartupPayload;
}

export type TelemetrySendResult = {
  status: "disabled" | "already-sent" | "sent" | "failed";
};
