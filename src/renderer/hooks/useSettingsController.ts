import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEnvSettings, AppLocale } from "../../shared/types";
import { refreshInBackground } from "../backgroundRefresh";

const DEFAULT_SETTINGS: AgentEnvSettings = {
  locale: "system",
  conversationTerminal: "default",
  skillSyncMethod: "copy",
  skillManagementFormatVersion: 1,
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 1440,
  backupRetentionDays: 30
};

interface UseSettingsControllerOptions {
  onBackupRetentionChanged(): void | Promise<void>;
  onBusyChange(busy: boolean): void;
  onError(error: string | undefined): void;
  onLocaleChange(locale: AppLocale): void;
  onTargetSettingsChanged(settings: AgentEnvSettings): void | Promise<void>;
  onRefreshError?(error: unknown): void;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useSettingsController = ({
  onBackupRetentionChanged,
  onBusyChange,
  onError,
  onLocaleChange,
  onTargetSettingsChanged,
  onRefreshError
}: UseSettingsControllerOptions) => {
  const [settings, setSettings] = useState<AgentEnvSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("");
  const revision = useRef(0);
  const callbacksRef = useRef({
    onBackupRetentionChanged,
    onBusyChange,
    onError,
    onLocaleChange,
    onTargetSettingsChanged,
    onRefreshError
  });
  callbacksRef.current = {
    onBackupRetentionChanged,
    onBusyChange,
    onError,
    onLocaleChange,
    onTargetSettingsChanged,
    onRefreshError
  };

  useEffect(() => {
    if (status !== "Settings saved") return undefined;
    const timeout = window.setTimeout(() => setStatus(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const accept = useCallback((nextSettings: AgentEnvSettings) => {
    revision.current++;
    setSettings(nextSettings);
    callbacksRef.current.onLocaleChange(nextSettings.locale);
  }, []);

  const update = useCallback(async (input: Partial<AgentEnvSettings>) => {
    callbacksRef.current.onBusyChange(true);
    callbacksRef.current.onError(undefined);
    setStatus("Saving settings");
    try {
      const nextSettings = await window.agentEnv.updateSettings(input);
      accept(nextSettings);
      if ("backupRetentionDays" in input) {
        refreshInBackground(callbacksRef.current.onBackupRetentionChanged, callbacksRef.current.onRefreshError);
      }
      if (
        "enabledTargetIds" in input ||
        "targetConfigRoots" in input ||
        "targetCommandOverrides" in input ||
        "skillSyncMethod" in input
      ) {
        refreshInBackground(() => callbacksRef.current.onTargetSettingsChanged(nextSettings), callbacksRef.current.onRefreshError);
      }
      setStatus("Settings saved");
      return nextSettings;
    } catch (error) {
      setStatus("");
      callbacksRef.current.onError(errorMessage(error));
      return undefined;
    } finally {
      callbacksRef.current.onBusyChange(false);
    }
  }, [accept]);

  return {
    revision,
    state: { settings, status },
    actions: {
      accept,
      clearStatus: () => setStatus(""),
      setStatus,
      update
    }
  };
};
