import { useState } from "react";
import { aiFeatures, type AIPreferences } from "../../shared/aiAssistance";
import { useAIPreferences } from "../hooks/useAIPreferences";
import { useI18n } from "../i18n";
import { Notice, Switch } from "./ui";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { InfoTip } from "./InfoTip";

export const AIAssistanceSettings = () => {
  const { t } = useI18n();
  const state = useAIPreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const names = { summaries: t("Update summaries"), tags: t("Tag suggestions"), comparison: t("Compare interpretation"), duplicates: t("Duplicate Skill analysis"), profile: t("Profile analysis") };
  const save = async (next: AIPreferences) => {
    setBusy(true); setError("");
    try { state.setPreferences(await window.agentEnv.saveAIPreferences(next)); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="settings-preference-list" aria-label={t("AI assistance")}>
    <SettingsPreferenceRow label={<span className="settings-preference-label">{t("AI assistance")}<InfoTip label={`${t("The selected content will be sent to this service and may contain private information. Your provider may charge for this request. Nothing will be changed.")} ${t("Manual requests only. Turning this off cancels active AI requests and keeps saved results. Your provider may still bill requests already sent.")}`} /></span>}
      control={<Switch label={t("AI assistance")} checked={state.preferences?.enabled ?? false} disabled={busy || !state.preferences}
        onClick={() => state.preferences && void save({ ...state.preferences, enabled: !state.preferences.enabled })} />} />
    {aiFeatures.map((feature) => <SettingsPreferenceRow key={feature} label={names[feature]}
      className={`settings-dependent-row${state.preferences?.enabled ? "" : " is-disabled"}`}
      control={<Switch label={names[feature]} checked={state.preferences?.features[feature] ?? false} disabled={busy || !state.preferences?.enabled}
        onClick={() => state.preferences && void save({ ...state.preferences, features: { ...state.preferences.features, [feature]: !state.preferences.features[feature] } })} />} />)}
    {error || state.error ? <Notice tone="warning" role="alert">{error || state.error}</Notice> : null}
  </div>;
};
