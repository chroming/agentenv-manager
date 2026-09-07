import { useEffect, useRef, useState, type Ref } from "react";
import { RotateCw, Sparkles } from "lucide-react";
import type { AIAnalysisSubject, AIAnalysisPreview, AIAnalysisRecord } from "../../shared/aiAssistance";
import { useAIPreferences } from "../hooks/useAIPreferences";
import { useI18n } from "../i18n";
import { Button, DialogBody, DialogFooter, EmptyState, IconButton, Notice, TextAction } from "./ui";
import { AIReviewHeading } from "./AIReviewHeading";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { AIServiceForm } from "./SkillSummarySettings";

export const AIAnalysisReview = ({ subject, standalone = false, onClose, closeRef }: {
  subject: AIAnalysisSubject; standalone?: boolean; onClose?(): void; closeRef?: Ref<HTMLButtonElement>;
}) => {
  const { t, locale, formatDate } = useI18n();
  const prefs = useAIPreferences();
  const allowed = prefs.enabled(subject.kind);
  const [preview, setPreview] = useState<AIAnalysisPreview>();
  const objectIdentity = JSON.stringify(subject.kind === "profile" ? [subject.kind, subject.profileId, subject.targetId]
    : subject.kind === "comparison" ? [subject.kind, subject.runId] : [subject.kind, subject.objectId ?? subject.documents]);
  const [result, setResult] = useState<{ owner: string; value: AIAnalysisRecord }>();
  const record = result?.owner === objectIdentity ? result.value : undefined;
  const setRecord = (value: AIAnalysisRecord | undefined) => {
    setResult((old) => value ? { owner: objectIdentity, value } : old?.owner === objectIdentity ? old : undefined);
  };
  const [configuring, setConfiguring] = useState(false);
  const [needsConfig, setNeedsConfig] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"loading" | "generating" | undefined>();
  const [evidence, setEvidence] = useState("");
  const active = useRef(true);
  const request = useRef("");
  const identity = JSON.stringify([subject, locale]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  useEffect(() => {
    active.current = true; setPreview(undefined); setError(""); setEvidence(""); setBusy(undefined); setConfiguring(false); setNeedsConfig(false);
    let valid = true;
    void window.agentEnv?.prepareAIAnalysis?.(subject, locale).then((value) => { if (valid) { setPreview(value); setRecord(value.cached); } })
      .catch((error) => { if (valid) setError(String(error)); });
    return () => { valid = false; active.current = false; if (request.current) void window.agentEnv.cancelAIAnalysis(request.current); };
  }, [identity]);
  useEffect(() => {
    if (!allowed && request.current) void window.agentEnv.cancelAIAnalysis(request.current);
  }, [allowed]);
  const prepare = async () => {
    if (!allowed || busy) return;
    setBusy("loading"); setError("");
    try {
      const value = await window.agentEnv.prepareAIAnalysis(subject, locale);
      const config = await window.agentEnv.readSkillSummaryConfig();
      if (active.current && currentIdentity.current === identity) {
        setPreview(value); setRecord(value.cached);
        if (!config.model || !config.endpoint) { setNeedsConfig(true); return; }
        setNeedsConfig(false); setBusy("generating");
        const id = crypto.randomUUID(); request.current = id;
        try {
          const generated = await window.agentEnv.generateAIAnalysis({ subject, locale, expectedKey: value.key, requestId: id,
            expectedEndpoint: config.endpoint, expectedModel: config.model, confirmed: true, regenerate: Boolean(record) });
          if (active.current && currentIdentity.current === identity) setRecord(generated);
        } finally { if (request.current === id) request.current = ""; }
      }
    } catch (error) { if (active.current && currentIdentity.current === identity) setError(String(error)); }
    finally { if (active.current && currentIdentity.current === identity) setBusy(undefined); }
  };
  const action = subject.kind === "comparison" ? "Analyze results" : subject.kind === "duplicates" ? "Analyze differences" : "Analyze Profile";
  const heading = subject.kind === "duplicates" ? "Duplicate Skill analysis" : "AI analysis";
  const shownDocument = record?.documents.find((doc) => doc.id === evidence);
  const priority = { risk: 0, suggestion: 1, observation: 2 };
  const findings = subject.kind === "profile"
    ? [...(record?.findings ?? [])].sort((a, b) => priority[a.category] - priority[b.category])
    : record?.findings ?? [];
  const visibleFindings = subject.kind === "profile" ? findings.slice(0, 3) : findings;
  const remainingFindings = findings.slice(visibleFindings.length);
  const findingContent = (finding: AIAnalysisRecord["findings"][number], index: number) => <section key={index}>
    <h4>{finding.title || ({ risk: t("Potential risk"), suggestion: t("Suggestion"), observation: t("Observation") })[finding.category]}</h4>
    <p>{finding.detail}</p>{finding.suggestion ? <p className="muted">{finding.suggestion}</p> : null}
  </section>;
  if (!allowed && !record && !standalone) return null;
  const actions = <>
    {busy === "generating" ? <Button onClick={() => void window.agentEnv.cancelAIAnalysis(request.current)}>{t("Stop")}</Button> : null}
    {allowed && record && !standalone ? <IconButton label={t("Regenerate")} busy={Boolean(busy)} disabled={configuring} onClick={() => void prepare()}><RotateCw size={15} /></IconButton>
      : allowed ? <Button variant={standalone && !record ? "primary" : "secondary"} icon={record ? <RotateCw size={15} /> : <Sparkles size={15} />} busy={Boolean(busy)} disabled={Boolean(busy || configuring)} onClick={() => void prepare()}>{t(record ? "Regenerate" : action)}</Button> : null}
  </>;
  const closeAction = <Button ref={closeRef} variant={record ? "primary" : "secondary"} onClick={onClose}>{t("Close")}</Button>;
  const content = <>
    {standalone && !record && !error && !configuring && !needsConfig ? <EmptyState icon={<Sparkles size={20} />} title={t("Review before applying")}
      description={t("Find conflicting instructions, resource gaps and practical improvements. Your Profile will not be changed.")} /> : null}
    {error ? <Notice tone="warning" role="alert" actions={allowed && !configuring ? <Button onClick={() => setConfiguring(true)}>{t("Configure AI service")}</Button> : undefined}>{error}</Notice> : null}
    {preview?.cacheDamaged ? <Notice tone="warning">{t("Saved analysis is unreadable. Generate a new analysis; the old file will be preserved for diagnostics.")}</Notice> : null}
    {needsConfig && !configuring ? <Notice actions={<Button onClick={() => setConfiguring(true)}>{t("Configure AI service")}</Button>}>{t("Configure the AI service before generating. No request has been sent.")}</Notice> : null}
    {configuring ? <AIServiceForm onCancel={() => setConfiguring(false)} onSaved={() => { setConfiguring(false); setNeedsConfig(false); setError(""); }} /> : null}
    {record ? <div className="skill-summary-content">
      {(!preview || record.key !== preview.key) ? <Notice tone="warning">{t("Inputs changed. This is the previous analysis; regenerate to analyze the current content.")}</Notice> : null}
      <p>{record.overview}</p>
      {record.partial ? <Notice tone="warning">{t("Partial analysis: long content is truncated. Only the displayed scope is analyzed.")}</Notice> : null}
      {visibleFindings.map(findingContent)}
      <details><summary>{remainingFindings.length ? t("More findings ({{count}})", { count: remainingFindings.length }) : t("Details")}</summary><div className="skill-summary-content">
      {remainingFindings.map(findingContent)}
      <p className="muted">{t("AI-generated")} · {record.model} · {formatDate(record.generatedAt)}</p>
      <div className="skill-summary-files">{[...new Set(record.findings.flatMap((finding) => finding.evidence))].map((id) => <TextAction key={id} onClick={() => setEvidence(evidence === id ? "" : id)}>{record.documents.find((doc) => doc.id === id)?.label ?? id}</TextAction>)}</div>
      {shownDocument ? <SyntaxCodePreview path="evidence.md" code={shownDocument.content} /> : null}
      {record.limitations.map((limitation, index) => <p className="muted" key={index}>{t(limitation)}</p>)}
      <p className="muted">{t("AI review is not a safety guarantee. Check the original diff when in doubt.")}</p>
      </div></details>
    </div> : null}
  </>;
  return standalone ? <>
    <DialogBody><div className="skill-summary-content">{content}</div></DialogBody>
    <DialogFooter>{record ? <>{actions}{closeAction}</> : <>{closeAction}{actions}</>}</DialogFooter>
  </> : <section className="skill-summary-review skill-summary-review--embedded" aria-label={t("AI analysis")}>
    <AIReviewHeading title={t(heading)} actions={actions} />
    {content}
  </section>;
};
