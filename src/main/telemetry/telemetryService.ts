import { readFile } from "node:fs/promises";
import type { AgentEnvSettings } from "../../shared/types";
import type {
  TelemetryDailyStartupPayload,
  TelemetryPreview,
  TelemetrySendResult,
  TelemetryStartupOutcome
} from "../../shared/telemetry";
import type { AppInstallChannel } from "../../shared/appUpdates";
import { writeAtomic } from "../fileUtils";

interface TelemetryState {
  lastSentDate?: string;
}

interface TelemetryContext {
  appVersion: string;
  platform: "darwin" | "win32" | "linux";
  osVersion: string;
  arch: string;
  locale: "en" | "zh_CN" | "zh_TW";
  installChannel: AppInstallChannel;
}

export interface TelemetryService {
  preview(outcome?: TelemetryStartupOutcome): TelemetryPreview;
  recordDailyStartup(outcome: TelemetryStartupOutcome): Promise<TelemetrySendResult>;
  setInstallChannel(channel: AppInstallChannel): void;
}

const readState = async (path: string): Promise<TelemetryState> => {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as TelemetryState;
    return typeof value.lastSentDate === "string" ? { lastSentDate: value.lastSentDate } : {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    return {};
  }
};

const payloadFor = (
  context: TelemetryContext,
  date: string,
  outcome: TelemetryStartupOutcome
): TelemetryDailyStartupPayload => ({
  schemaVersion: 1,
  event: "daily-startup",
  date,
  appVersion: context.appVersion,
  platform: context.platform,
  osMajor: context.osVersion.split(".")[0] || "unknown",
  arch: context.arch,
  locale: context.locale,
  installChannel: context.installChannel,
  outcome
});

export const createTelemetryService = (options: {
  statePath: string;
  endpoint: string;
  settingsStore: Pick<{ readSettings(): Promise<Pick<AgentEnvSettings, "telemetryEnabled">> }, "readSettings">;
  context: TelemetryContext;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
}): TelemetryService => {
  const configuredEndpoint = options.endpoint.trim();
  const endpoint = (() => {
    if (!configuredEndpoint) return "";
    try {
      return new URL(configuredEndpoint).protocol === "https:" ? configuredEndpoint : "";
    } catch {
      return "";
    }
  })();
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 3_000;
  let inFlight: Promise<TelemetrySendResult> | undefined;
  let installChannel = options.context.installChannel;

  const preview = (outcome: TelemetryStartupOutcome = "ready"): TelemetryPreview => ({
    enabledInBuild: Boolean(endpoint),
    payload: payloadFor(
      { ...options.context, installChannel },
      now().toISOString().slice(0, 10),
      outcome
    )
  });

  const recordDailyStartup = (outcome: TelemetryStartupOutcome) => {
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<TelemetrySendResult> => {
      const settings = await options.settingsStore.readSettings().catch(() => ({ telemetryEnabled: false }));
      if (!endpoint || settings.telemetryEnabled !== true) return { status: "disabled" };
      const payload = preview(outcome).payload;
      const state = await readState(options.statePath);
      if (state.lastSentDate === payload.date) return { status: "already-sent" };
      try {
        const response = await request(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) return { status: "failed" };
        await writeAtomic(options.statePath, `${JSON.stringify({ lastSentDate: payload.date }, null, 2)}\n`);
        return { status: "sent" };
      } catch {
        return { status: "failed" };
      }
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  return {
    preview,
    recordDailyStartup,
    setInstallChannel: (channel) => {
      installChannel = channel;
    }
  };
};
