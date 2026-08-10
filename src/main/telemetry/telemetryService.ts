import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AgentEnvSettings } from "../../shared/types";
import type {
  TelemetryDailyStartupPayload,
  TelemetryPreview,
  TelemetrySendResult
} from "../../shared/telemetry";
import type { AppInstallChannel } from "../../shared/appUpdates";
import { writeAtomic } from "../fileUtils";

interface TelemetryState {
  installationId?: string;
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
  preview(): Promise<TelemetryPreview>;
  recordDailyStartup(): Promise<TelemetrySendResult>;
  setInstallChannel(channel: AppInstallChannel): void;
}

const installationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const readState = async (path: string): Promise<TelemetryState> => {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as TelemetryState;
    return {
      ...(typeof value.installationId === "string" && installationIdPattern.test(value.installationId)
        ? { installationId: value.installationId }
        : {}),
      ...(typeof value.lastSentDate === "string" ? { lastSentDate: value.lastSentDate } : {})
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    return {};
  }
};

const payloadFor = (
  context: TelemetryContext,
  date: string
): TelemetryDailyStartupPayload => ({
  schemaVersion: 2,
  event: "agentenv_daily_startup",
  date,
  appVersion: context.appVersion,
  platform: context.platform,
  osMajor: context.osVersion.split(".")[0] || "unknown",
  arch: context.arch,
  locale: context.locale,
  installChannel: context.installChannel
});

const localDateFor = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const createTelemetryService = (options: {
  statePath: string;
  host: string;
  projectToken: string;
  settingsStore: Pick<{
    readSettings(): Promise<Pick<AgentEnvSettings, "telemetryEnabled" | "telemetryConsentVersion">>;
  }, "readSettings">;
  context: TelemetryContext;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  createInstallationId?: () => string;
  timeoutMs?: number;
}): TelemetryService => {
  const configuredHost = options.host.trim();
  const projectToken = options.projectToken.trim();
  const endpoint = (() => {
    if (!configuredHost || !projectToken) return "";
    try {
      const url = new URL(configuredHost);
      if (
        url.protocol !== "https:" ||
        !["us.i.posthog.com", "eu.i.posthog.com"].includes(url.hostname)
      ) {
        return "";
      }
      return `${url.origin}/i/v0/e/`;
    } catch {
      return "";
    }
  })();
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const createInstallationId = options.createInstallationId ?? randomUUID;
  const timeoutMs = options.timeoutMs ?? 3_000;
  let inFlight: Promise<TelemetrySendResult> | undefined;
  let statePromise: Promise<TelemetryState> | undefined;
  let installChannel = options.context.installChannel;

  const persistState = async (state: TelemetryState) => {
    await writeAtomic(options.statePath, `${JSON.stringify(state, null, 2)}\n`);
    statePromise = Promise.resolve(state);
  };

  const ensureState = () => {
    statePromise ??= readState(options.statePath).then(async (state) => {
      if (state.installationId) return state;
      const next = { ...state, installationId: createInstallationId() };
      await persistState(next);
      return next;
    });
    return statePromise;
  };

  const preview = async (): Promise<TelemetryPreview> => {
    const state = await readState(options.statePath);
    return {
      enabledInBuild: Boolean(endpoint),
      destination: "PostHog Cloud",
      ...(state.installationId ? { installationId: state.installationId } : {}),
      willCreateInstallationId: !state.installationId,
      payload: payloadFor(
        { ...options.context, installChannel },
        localDateFor(now())
      )
    };
  };

  const recordDailyStartup = () => {
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<TelemetrySendResult> => {
      const settings = await options.settingsStore.readSettings().catch(() => ({
        telemetryEnabled: false,
        telemetryConsentVersion: undefined
      }));
      if (
        !endpoint ||
        settings.telemetryEnabled !== true ||
        settings.telemetryConsentVersion !== 1
      ) return { status: "disabled" };
      try {
        const currentPreview = await preview();
        const payload = currentPreview.payload;
        const state = await ensureState();
        if (state.lastSentDate === payload.date) return { status: "already-sent" };
        const response = await request(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: projectToken,
            distinct_id: state.installationId,
            event: payload.event,
            properties: {
              schemaVersion: payload.schemaVersion,
              date: payload.date,
              appVersion: payload.appVersion,
              platform: payload.platform,
              osMajor: payload.osMajor,
              arch: payload.arch,
              locale: payload.locale,
              installChannel: payload.installChannel,
              $process_person_profile: false,
              $geoip_disable: true
            }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) return { status: "failed" };
        await persistState({
          installationId: state.installationId,
          lastSentDate: payload.date
        });
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
