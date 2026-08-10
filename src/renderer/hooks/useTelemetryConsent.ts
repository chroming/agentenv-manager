import { useCallback, useEffect, useState } from "react";
import type { AgentEnvSettings, TelemetryPreview } from "../../shared/types";

interface UseTelemetryConsentOptions {
  isLoading: boolean;
  settings: AgentEnvSettings;
  onAccepted(settings: AgentEnvSettings): void;
  onError(message: string): void;
}

export const useTelemetryConsent = ({
  isLoading,
  settings,
  onAccepted,
  onError
}: UseTelemetryConsentOptions) => {
  const [preview, setPreview] = useState<TelemetryPreview>();
  const [previewResolved, setPreviewResolved] = useState(false);
  const [dismissedForSession, setDismissedForSession] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void window.agentEnv.readTelemetryPreview()
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setPreviewResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const pending =
    preview?.enabledInBuild === true &&
    settings.telemetryConsentVersion !== 1;
  const open = !isLoading && pending && !dismissedForSession;

  const decide = useCallback(async (enabled: boolean) => {
    setSaving(true);
    try {
      const next = await window.agentEnv.decideTelemetry(enabled);
      onAccepted(next);
      setDismissedForSession(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [onAccepted, onError]);

  return {
    blocksAgentSuggestions: !isLoading && (!previewResolved || open),
    dismiss: () => setDismissedForSession(true),
    decide,
    open,
    preview,
    saving
  };
};
