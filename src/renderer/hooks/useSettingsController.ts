import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEnvSettings, AppLocale } from "../../shared/types";

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
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useSettingsController = ({
  onBackupRetentionChanged,
  onBusyChange,
  onError,
  onLocaleChange,
  onTargetSettingsChanged
}: UseSettingsControllerOptions) => {
  const [settings, setSettings] = useState<AgentEnvSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("");
  const callbacksRef = useRef({
    onBackupRetentionChanged,
    onBusyChange,
    onError,
    onLocaleChange,
    onTargetSettingsChanged
  });
  callbacksRef.current = {
    onBackupRetentionChanged,
    onBusyChange,
    onError,
    onLocaleChange,
    onTargetSettingsChanged
  };

  useEffect(() => {
    if (status !== "Settings saved") return undefined;
    const timeout = window.setTimeout(() => setStatus(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const accept = useCallback((nextSettings: AgentEnvSettings) => {
    setSettings(nextSettings);
    callbacksRef.current.onLocaleChange(nextSettings.locale);
  }, []);

  const update = useCallback(async (input: Partial<AgentEnvSettings>) => {
    callbacksRef.current.onBusyChange(true);
    callbacksRef.current.onError(undefined);
    setStatus("Saving settings");
    try {
      const nextSettings = await window.agentEnv.updateSettings(input);
      setSettings(nextSettings);
      callbacksRef.current.onLocaleChange(nextSettings.locale);
      if ("backupRetentionDays" in input) {
        await callbacksRef.current.onBackupRetentionChanged();
      }
      if (
        "enabledTargetIds" in input ||
        "targetConfigRoots" in input ||
        "targetCommandOverrides" in input ||
        "skillSyncMethod" in input
      ) {
        await callbacksRef.current.onTargetSettingsChanged(nextSettings);
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
  }, []);

  return {
    state: { settings, status },
    actions: {
      accept,
      clearStatus: () => setStatus(""),
      setStatus,
      update
    }
  };
};
