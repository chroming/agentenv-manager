import type { AgentEnvSettings } from "../../shared/types";
import { useI18n } from "../i18n";
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
        <label className="settings-preference-row">
          <span className="settings-preference-copy">
            <strong>{t("Skill deployment")}</strong>
            <small>
              {settings.skillSyncMethod === "copy"
                ? t("Library updates stay pending until installs are explicitly synchronized.")
                : settings.skillSyncMethod === "auto"
                  ? t("Uses live links when supported and falls back to copied installs.")
                  : t("Library updates immediately change linked Agent Skills without another Apply preview.")}
            </small>
          </span>
          <select
            aria-label={t("Global skill deployment method")}
            value={settings.skillSyncMethod}
            onChange={(event) =>
              onChange({
                skillSyncMethod:
                  event.currentTarget.value as AgentEnvSettings["skillSyncMethod"]
              })}
          >
            <option value="symlink">{t("Live link (recommended)")}</option>
            <option value="copy">{t("Copy (apply-gated updates)")}</option>
            <option value="auto">{t("Auto (live link when possible)")}</option>
          </select>
        </label>
        <div className="settings-preference-row">
          <span className="settings-preference-copy">
            <strong>{t("Auto-check")}</strong>
            <small>{t("Checks monitored sources, then reports tracked Skills.")}</small>
          </span>
          <Switch
            checked={settings.skillAutoCheckEnabled}
            label={t("Skill auto update check")}
            disabled={busy}
            onClick={() =>
              onChange({
                skillAutoCheckEnabled: !settings.skillAutoCheckEnabled
              })}
          />
        </div>
        <label
          className={`settings-preference-row settings-dependent-row${
            settings.skillAutoCheckEnabled ? "" : " is-disabled"
          }`}
        >
          <span className="settings-preference-copy">
            <strong>{t("Check interval")}</strong>
            <small>{t("Used only while automatic checks are enabled.")}</small>
          </span>
          <span className="settings-interval-control">
            <input
              aria-label={t("Skill auto check interval minutes")}
              min={5}
              max={1440}
              step={5}
              type="number"
              disabled={!settings.skillAutoCheckEnabled || busy}
              value={settings.skillAutoCheckIntervalMinutes}
              onChange={(event) =>
                onChange({
                  skillAutoCheckIntervalMinutes: Number(event.currentTarget.value)
                })}
            />
            <span aria-hidden="true">{t("min")}</span>
          </span>
        </label>
      </div>
    </section>
  );
};
