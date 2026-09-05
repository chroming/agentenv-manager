import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { Button, Notice, TextField } from "./ui";

export const SkillSummarySettings = () => {
  const { t } = useI18n();
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void window.agentEnv?.readSkillSummaryConfig?.().then((config) => {
      setEndpoint(config.endpoint); setModel(config.model); setHasKey(config.hasKey);
    }).catch((error) => setError(String(error)));
  }, []);
  const save = async (removeKey = false) => {
    setBusy(true); setError(""); setSaved(false);
    try {
      await window.agentEnv.saveSkillSummaryConfig({ endpoint, model, apiKey: removeKey ? "" : apiKey || undefined });
      const config = await window.agentEnv.readSkillSummaryConfig();
      setHasKey(config.hasKey); setApiKey(""); setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <details className="settings-disclosure">
    <summary>{t("AI service")}</summary>
    <div className="profile-form-grid">
      <p className="settings-muted">{t("Manual only. OpenAI-compatible Chat Completions API with JSON output. Credentials stay on this device.")}</p>
      <TextField label={t("API endpoint")} value={endpoint} disabled={busy} onChange={(event) => { setEndpoint(event.currentTarget.value); setSaved(false); }} />
      <TextField label={t("Model")} value={model} disabled={busy} onChange={(event) => { setModel(event.currentTarget.value); setSaved(false); }} />
      <TextField label={t("API Key")} type="password" autoComplete="off" value={apiKey} disabled={busy}
        placeholder={hasKey ? t("Saved securely; leave blank to keep") : ""}
        onChange={(event) => { setApiKey(event.currentTarget.value); setSaved(false); }} />
      {error ? <Notice tone="warning" role="alert">{error}</Notice> : null}
      {saved ? <p role="status">{t("Saved")}</p> : null}
      <div className="settings-row-actions">
        {hasKey ? <Button disabled={busy} onClick={() => void save(true)}>{t("Remove API Key")}</Button> : null}
        <Button busy={busy} disabled={!endpoint || !model} onClick={() => void save()}>{t("Save")}</Button>
      </div>
    </div>
  </details>;
};
