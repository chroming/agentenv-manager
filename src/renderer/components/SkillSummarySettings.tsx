import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { Button, Notice, TextField } from "./ui";
import { AIAssistanceSettings } from "./AIAssistanceSettings";

export const AIServiceForm = ({ onSaved, onCancel }: { onSaved?(): void; onCancel?(): void }) => {
  const { t } = useI18n();
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [baseline, setBaseline] = useState<{ endpoint: string; model: string }>();
  const dirty = !baseline || baseline.endpoint !== endpoint || baseline.model !== model || Boolean(apiKey);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 5000);
    return () => clearTimeout(timer);
  }, [saved]);
  useEffect(() => { setTested(false); }, [endpoint, model, apiKey]);
  useEffect(() => {
    void window.agentEnv?.readSkillSummaryConfig?.().then((config) => {
      setEndpoint(config.endpoint); setModel(config.model); setHasKey(config.hasKey);
      setBaseline(config);
    }).catch((error) => setError(String(error)));
  }, []);
  const save = async (removeKey = false) => {
    setBusy(true); setError(""); setSaved(false); setTested(false);
    try {
      await window.agentEnv.saveSkillSummaryConfig({ endpoint, model, apiKey: removeKey ? "" : apiKey || undefined });
      const config = await window.agentEnv.readSkillSummaryConfig();
      setHasKey(config.hasKey); setApiKey(""); setSaved(true);
      setEndpoint(config.endpoint); setModel(config.model); setBaseline(config);
      onSaved?.();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setTesting(true); setBusy(true); setSaved(false); setTested(false); setError("");
    try { await window.agentEnv.testAIService(); setTested(true); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setTesting(false); setBusy(false); }
  };
  return <div className="profile-form-grid">
      <p className="settings-muted">{t("Manual only. OpenAI-compatible Chat Completions API with JSON output. Credentials stay on this device.")}</p>
      <TextField label={t("API endpoint")} value={endpoint} disabled={busy} onChange={(event) => { setEndpoint(event.currentTarget.value); setSaved(false); }} />
      <TextField label={t("Model")} value={model} disabled={busy} onChange={(event) => { setModel(event.currentTarget.value); setSaved(false); }} />
      <TextField label={t("API Key")} type="password" autoComplete="off" value={apiKey} disabled={busy}
        placeholder={hasKey ? t("Saved securely; leave blank to keep") : ""}
        onChange={(event) => { setApiKey(event.currentTarget.value); setSaved(false); }} />
      {error ? <Notice tone="warning" role="alert">{error}</Notice> : null}
      <div className="settings-row-actions">
        {onCancel ? <Button disabled={busy} onClick={onCancel}>{t("Cancel")}</Button> : null}
        {hasKey ? <Button disabled={busy} onClick={() => void save(true)}>{t("Remove API Key")}</Button> : null}
        <Button busy={testing} disabled={dirty || (busy && !testing) || !endpoint || !model}
          title={t("Sends a small test request using the saved configuration. Provider charges may apply.")}
          onClick={() => void test()}>{t("Test connection")}</Button>
        <Button busy={busy && !testing} disabled={testing || !endpoint || !model} onClick={() => void save()}>{t("Save")}</Button>
      </div>
      <div className="ai-service-feedback settings-muted" role="status">
        {tested ? t("AI service is available") : saved ? t("Saved") : ""}
      </div>
    </div>
  ;
};

export const SkillSummarySettings = () => {
  const { t } = useI18n();
  const [configured, setConfigured] = useState<boolean>();
  const [error, setError] = useState("");
  const refresh = () => {
    void window.agentEnv.readSkillSummaryConfig().then((config) => {
      setConfigured(Boolean(config.endpoint && config.model)); setError("");
    }).catch((error) => setError(String(error)));
  };
  useEffect(refresh, []);
  return <section className="resource-section settings-section">
    <AIAssistanceSettings />
    {error ? <Notice tone="warning" role="alert" actions={<Button onClick={refresh}>{t("Retry")}</Button>}>{error}</Notice> : null}
    <details className="settings-disclosure">
      <summary>{t("AI service")}{configured !== undefined ? ` · ${t(configured ? "Configured" : "Not configured")}` : ""}</summary>
      <AIServiceForm onSaved={refresh} />
    </details>
  </section>;
};
