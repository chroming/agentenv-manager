import { useEffect, useState } from "react";
import type { AgentEnvSettings, TelemetryPreview } from "../../shared/types";
import { useI18n } from "../i18n";
import { InfoTip } from "./InfoTip";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { Switch } from "./ui";

interface TelemetrySettingsProps {
  busy: boolean;
  settings: AgentEnvSettings;
  onChange(input: Partial<AgentEnvSettings>): void;
}

export const TelemetrySettings = ({
  busy,
  settings,
  onChange
}: TelemetrySettingsProps) => {
  const { t } = useI18n();
  const [preview, setPreview] = useState<TelemetryPreview>();

  useEffect(() => {
    let active = true;
    void window.agentEnv.readTelemetryPreview().then((value) => {
      if (active) setPreview(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="resource-section settings-section" aria-labelledby="privacy-heading">
      <div className="settings-section-title">
        <div className="resource-heading" id="privacy-heading">{t("Privacy")}</div>
      </div>
      <div className="settings-preference-list">
        <SettingsPreferenceRow
          label={<span className="settings-preference-label">
            {t("Anonymous usage statistics")}
            <InfoTip label={t("Once per local day, AgentEnv sends a random installation ID, its version, operating-system family and major version, architecture, interface language, and install channel to PostHog Cloud. It never includes actions, results, paths, names, repositories, conversations, prompts, or file contents.")} />
          </span>}
          description={preview?.enabledInBuild === false
            ? t("This build does not send anonymous usage statistics. Your preference is kept for future builds.")
            : t("Shares one anonymous startup event per day. Turn it off at any time.")}
          control={<Switch
            checked={settings.telemetryEnabled === true}
            disabled={busy}
            label={t("Share anonymous usage statistics")}
            onClick={() => onChange({ telemetryEnabled: settings.telemetryEnabled !== true })}
          />}
        />
      </div>
      {preview ? (
        <details className="telemetry-preview">
          <summary>{t("Preview shared data")}</summary>
          <pre>{JSON.stringify({
            installationId: preview.installationId,
            ...preview.payload
          }, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
};
