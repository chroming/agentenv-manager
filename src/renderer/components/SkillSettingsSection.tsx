import type { AgentEnvSettings } from "../../shared/types";
import { useI18n } from "../i18n";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { SelectControl, Switch } from "./ui";

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
  const standardIntervals = [60, 360, 720, 1440];
  const hasCustomInterval = !standardIntervals.includes(settings.skillAutoCheckIntervalMinutes);

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
          control={<SelectControl
            controlWidth="wide"
            aria-label={t("Global skill deployment method")}
            value={settings.skillSyncMethod === "auto" ? "copy" : settings.skillSyncMethod}
            onChange={(event) =>
              onChange({
                skillSyncMethod:
                  event.currentTarget.value as AgentEnvSettings["skillSyncMethod"]
              })}
          >
            <option value="copy">{t("Copy on Apply (recommended)")}</option>
            <option value="symlink">{t("Live link (advanced)")}</option>
          </SelectControl>}
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
          control={<SelectControl
            controlWidth="standard"
            aria-label={t("Skill auto check interval")}
            disabled={!settings.skillAutoCheckEnabled || busy}
            value={settings.skillAutoCheckIntervalMinutes}
            onChange={(event) => onChange({
              skillAutoCheckIntervalMinutes: Number(event.currentTarget.value)
            })}
          >
            {hasCustomInterval ? (
              <option value={settings.skillAutoCheckIntervalMinutes}>
                {t("Every {{minutes}} minutes", {
                  minutes: settings.skillAutoCheckIntervalMinutes
                })}
              </option>
            ) : null}
            <option value="60">{t("Every hour")}</option>
            <option value="360">{t("Every 6 hours")}</option>
            <option value="720">{t("Every 12 hours")}</option>
            <option value="1440">{t("Daily")}</option>
          </SelectControl>}
        />
      </div>
    </section>
  );
};
