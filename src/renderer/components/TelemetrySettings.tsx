import { useEffect, useState } from "react";
import type { AgentEnvSettings, TelemetryPreview } from "../../shared/types";
import { useI18n } from "../i18n";
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
        <div className="settings-preference-row settings-preference-row--inline-control">
          <span className="settings-preference-copy">
            <span className="settings-preference-heading">
              <strong>{t("Anonymous reliability data")}</strong>
              <Switch
                checked={settings.telemetryEnabled === true}
                disabled={busy || preview?.enabledInBuild === false}
                label={t("Share anonymous reliability data")}
                onClick={() => onChange({ telemetryEnabled: settings.telemetryEnabled !== true })}
              />
            </span>
            <small>
              {preview?.enabledInBuild === false
                ? t("This build does not send reliability data.")
                : t("Sends one bounded daily startup event. It is off until you enable it.")}
            </small>
          </span>
        </div>
      </div>
      {preview ? (
        <details className="telemetry-preview">
          <summary>{t("Preview shared data")}</summary>
          <pre>{JSON.stringify(preview.payload, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
};
