import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { AIAnalysisSubject, AIAnalysisPreview, AIAnalysisRecord } from "../../shared/aiAssistance";
import type { SkillSummaryConfig } from "../../shared/skillSummaries";
import { useAIPreferences } from "../hooks/useAIPreferences";
import { useI18n } from "../i18n";
import { Button, Notice, ResourcePanelToolbar, TextAction } from "./ui";
import { SyntaxCodePreview } from "./SyntaxCodePreview";

export const AIAnalysisReview = ({ subject }: { subject: AIAnalysisSubject }) => {
  const { t, locale, formatDate } = useI18n();
  const prefs = useAIPreferences();
  const allowed = prefs.enabled(subject.kind);
  const [preview, setPreview] = useState<AIAnalysisPreview>();
  const [record, setRecord] = useState<AIAnalysisRecord>();
  const [confirmation, setConfirmation] = useState<SkillSummaryConfig>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"loading" | "generating" | undefined>();
  const [evidence, setEvidence] = useState("");
  const active = useRef(true);
  const request = useRef("");
  const identity = JSON.stringify([subject, locale]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  useEffect(() => {
    active.current = true; setPreview(undefined); setConfirmation(undefined); setError(""); setEvidence(""); setBusy(undefined);
    let valid = true;
    void window.agentEnv?.prepareAIAnalysis?.(subject, locale).then((value) => { if (valid) { setPreview(value); setRecord((old) => value.cached ?? old); } })
      .catch((error) => { if (valid) setError(String(error)); });
    return () => { valid = false; active.current = false; if (request.current) void window.agentEnv.cancelAIAnalysis(request.current); };
  }, [identity]);
  useEffect(() => {
    if (!allowed) { setConfirmation(undefined); if (request.current) void window.agentEnv.cancelAIAnalysis(request.current); }
  }, [allowed]);
  const prepare = async () => {
    setBusy("loading"); setError("");
    try {
      const value = await window.agentEnv.prepareAIAnalysis(subject, locale);
      const config = await window.agentEnv.readSkillSummaryConfig();
      if (!config.model) throw new Error(t("Configure the AI service in Settings first."));
      if (active.current && currentIdentity.current === identity) { setPreview(value); setRecord((old) => value.cached ?? old); setConfirmation(config); }
    } catch (error) { if (active.current && currentIdentity.current === identity) setError(String(error)); }
    finally { if (active.current && currentIdentity.current === identity) setBusy(undefined); }
  };
  const generate = async () => {
    if (!preview || !confirmation || !allowed || busy) return;
    const config = confirmation; setConfirmation(undefined); setBusy("generating"); setError("");
    const id = crypto.randomUUID(); request.current = id;
    try {
      const value = await window.agentEnv.generateAIAnalysis({ subject, locale, expectedKey: preview.key, requestId: id,
        expectedEndpoint: config.endpoint, expectedModel: config.model, confirmed: true, regenerate: Boolean(record) });
      if (active.current && currentIdentity.current === identity) setRecord(value);
    } catch (error) { if (active.current && currentIdentity.current === identity) setError(String(error)); }
    finally { if (request.current === id) request.current = ""; if (active.current && currentIdentity.current === identity) setBusy(undefined); }
  };
  const action = subject.kind === "comparison" ? "Analyze results" : subject.kind === "duplicates" ? "Analyze differences" : "Analyze Profile";
  const shownDocument = record?.documents.find((doc) => doc.id === evidence);
  if (!allowed && !record) return null;
  return <section className="skill-summary-review" aria-label={t("AI analysis")}>
    <ResourcePanelToolbar><span className="resource-heading skill-summary-heading">{t("AI analysis")}</span>
      {allowed ? <Button icon={<Sparkles size={15} />} busy={Boolean(busy)} disabled={Boolean(busy || confirmation)} onClick={() => void prepare()}>{t(record ? "Regenerate" : action)}</Button> : null}
      {busy === "generating" ? <Button onClick={() => void window.agentEnv.cancelAIAnalysis(request.current)}>{t("Stop")}</Button> : null}
    </ResourcePanelToolbar>
    {error ? <Notice tone="warning" role="alert">{error}</Notice> : null}
    {confirmation && preview ? <Notice title={t("Generate analysis?")} actions={<><Button onClick={() => setConfirmation(undefined)}>{t("Cancel")}</Button><Button variant="primary" onClick={() => void generate()}>{t("Generate")}</Button></>}>
      <p>{t("The selected content will be sent to this service and may contain private information. Your provider may charge for this request. Nothing will be changed.")}</p>
      <p>{confirmation.endpoint} · {confirmation.model}</p>
      <p>{t("Analysis scope")}: {preview.documents.map((doc) => doc.label).join(", ")}</p>
      {preview.partial ? <p>{t("Partial analysis: long content is truncated. Only the displayed scope is analyzed.")}</p> : null}
      {preview.warnings.map((warning) => <p key={warning}>{t(warning)}</p>)}
    </Notice> : null}
    {record ? <div className="skill-summary-content">
      {preview && record.key !== preview.key ? <Notice tone="warning">{t("Inputs changed. This is the previous analysis; regenerate to analyze the current content.")}</Notice> : null}
      <p>{record.overview}</p><p className="muted">{t("AI-generated")} · {record.model} · {formatDate(record.generatedAt)}</p>
      {record.partial ? <Notice tone="warning">{t("Partial analysis: long content is truncated. Only the displayed scope is analyzed.")}</Notice> : null}
      {record.findings.map((finding, index) => <section key={index}>
        <h4>{({ risk: t("Potential risk"), suggestion: t("Suggestion"), observation: t("Observation") })[finding.category]}</h4>
        <p>{finding.detail}</p>{finding.suggestion ? <p className="muted">{finding.suggestion}</p> : null}
        <div className="skill-summary-files">{finding.evidence.map((id) => <TextAction key={id} onClick={() => setEvidence(evidence === id ? "" : id)}>{record.documents.find((doc) => doc.id === id)?.label ?? id}</TextAction>)}</div>
      </section>)}
      {shownDocument ? <SyntaxCodePreview path="evidence.md" code={shownDocument.content} /> : null}
      {record.limitations.map((limitation, index) => <p className="muted" key={index}>{t(limitation)}</p>)}
      <p className="muted">{t("AI review is not a safety guarantee. Check the original diff when in doubt.")}</p>
    </div> : null}
  </section>;
};
