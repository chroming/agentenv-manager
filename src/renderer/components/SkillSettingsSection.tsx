import { useEffect, useState } from "react";
import type { AgentEnvSettings } from "../../shared/types";
import { useI18n } from "../i18n";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { Switch } from "./ui";

interface SkillSettingsSectionProps {
  busy: boolean;
  settings: AgentEnvSettings;
  onChange(input: Partial<AgentEnvSettings>): void;
}

export const SkillSettingsSection = ({
  busy,
  settings,
  onChange
}: SkillSettingsSectionProps) => {
  const { t } = useI18n();
  const [intervalDraft, setIntervalDraft] = useState(
    String(settings.skillAutoCheckIntervalMinutes)
  );
  const [intervalError, setIntervalError] = useState(false);

  useEffect(() => {
    setIntervalDraft(String(settings.skillAutoCheckIntervalMinutes));
    setIntervalError(false);
  }, [settings.skillAutoCheckIntervalMinutes]);

  const commitInterval = () => {
    const interval = Number(intervalDraft);
    const valid =
      intervalDraft.trim().length > 0 &&
      Number.isInteger(interval) &&
      interval >= 5 &&
      interval <= 1440;
    if (!valid) {
      setIntervalError(true);
      return;
    }
    setIntervalError(false);
    if (interval !== settings.skillAutoCheckIntervalMinutes) {
      onChange({ skillAutoCheckIntervalMinutes: interval });
    }
  };

  return (
    <section
      className="resource-section settings-section"
      aria-labelledby="library-defaults-heading"
    >
      <div className="settings-section-title">
        <div>
          <div className="resource-heading" id="library-defaults-heading">
            {t("Skills library")}
          </div>
          <p className="settings-muted">
            {t("Defaults used when installing managed skills.")}
          </p>
        </div>
      </div>
      <div className="settings-preference-list">
        <SettingsPreferenceRow
          label={t("Skill deployment")}
          description={
            <>
              {settings.skillSyncMethod === "symlink"
                ? t("Library updates immediately change linked Agent Skills without another Apply preview.")
                : t("Keeps Agent Skills as ordinary folders and synchronizes managed copies only after confirmation.")}
            </>
          }
          control={<select
            aria-label={t("Global skill deployment method")}
            value={settings.skillSyncMethod === "auto" ? "copy" : settings.skillSyncMethod}
            onChange={(event) =>
              onChange({
                skillSyncMethod:
                  event.currentTarget.value as AgentEnvSettings["skillSyncMethod"]
              })}
          >
            <option value="copy">{t("Managed copy (recommended)")}</option>
            <option value="symlink">{t("Live link (advanced)")}</option>
          </select>}
        />
        <SettingsPreferenceRow
          label={t("Auto-check")}
          description={t("Checks monitored sources when the app opens, returns to the foreground, or reaches the saved interval.")}
          control={<Switch
            checked={settings.skillAutoCheckEnabled}
            label={t("Skill auto update check")}
            disabled={busy}
            onClick={() =>
              onChange({
                skillAutoCheckEnabled: !settings.skillAutoCheckEnabled
              })}
          />}
        />
        <SettingsPreferenceRow
          className={`settings-dependent-row${
            settings.skillAutoCheckEnabled ? "" : " is-disabled"
          }`}
          label={t("Check interval")}
          description={t("Used only while automatic checks are enabled.")}
          control={<span className="settings-interval-field">
            <span className="settings-interval-control">
              <input
                aria-describedby={intervalError ? "skill-check-interval-error" : undefined}
                aria-invalid={intervalError}
                aria-label={t("Skill auto check interval minutes")}
                min={5}
                max={1440}
                step={5}
                type="number"
                disabled={!settings.skillAutoCheckEnabled || busy}
                value={intervalDraft}
                onBlur={commitInterval}
                onChange={(event) => {
                  setIntervalDraft(event.currentTarget.value);
                  setIntervalError(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    setIntervalDraft(String(settings.skillAutoCheckIntervalMinutes));
                    setIntervalError(false);
                    event.currentTarget.blur();
                  }
                }}
              />
              <span aria-hidden="true">{t("min")}</span>
            </span>
            {intervalError ? (
              <small className="field-error" id="skill-check-interval-error">
                {t("Enter a value from 5 to 1440.")}
              </small>
            ) : null}
          </span>}
        />
      </div>
    </section>
  );
};
