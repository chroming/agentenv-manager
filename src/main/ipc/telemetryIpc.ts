import type { SettingsStore } from "../settingsStore";
import type { TelemetryService } from "../telemetry/telemetryService";
import type { IpcRegistrationHandles } from "./registration";

export const registerTelemetryIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  settingsStore: SettingsStore,
  telemetryService: TelemetryService
) => {
  handles.diagnosticHandle("telemetry:preview", () => telemetryService.preview());
  handles.handleMutation("telemetry:decide", async (_event, enabled: unknown) => {
    const next = await settingsStore.updateSettings({
      telemetryEnabled: enabled === true,
      telemetryConsentVersion: 1
    });
    if (enabled === true) void telemetryService.recordDailyStartup();
    return next;
  });
};
