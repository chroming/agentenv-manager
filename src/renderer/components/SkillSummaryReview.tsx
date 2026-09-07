import { useEffect, useRef, useState } from "react";
import { RotateCw, Sparkles } from "lucide-react";
import type { SkillUpdatePlan } from "../../shared/types";
import type { SkillSummary, SkillSummaryConfig } from "../../shared/skillSummaries";
import { useI18n } from "../i18n";
import { Button, IconButton, InteractiveStatus, Notice } from "./ui";
import { SkillSummaryContent } from "./SkillSummaryContent";
import { useAIPreferences } from "../hooks/useAIPreferences";
import { AIServiceSetup } from "./AIServiceSetup";
import { AIReviewHeading } from "./AIReviewHeading";

export const SkillSummaryReview = ({ plans, selectedIds, onViewFile, disabled = false }: {
  plans: SkillUpdatePlan[]; selectedIds?: string[]; disabled?: boolean;
  onViewFile(plan: SkillUpdatePlan, path: string, summary: SkillSummary): void;
}) => {
  const { t, locale } = useI18n();
  const [records, setRecords] = useState<Record<string, SkillSummary>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [needsConfig, setNeedsConfig] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [operationLabel, setOperationLabel] = useState("");
  const [initiator, setInitiator] = useState("");
  const active = useRef(true);
  const requestId = useRef("");
  const stopped = useRef(false);
  const ai = useAIPreferences();
  const allowed = ai.enabled("summaries");
  useEffect(() => {
    if (!allowed) { stopped.current = true; if (requestId.current) void window.agentEnv.cancelSkillSummary(requestId.current); }
  }, [allowed]);
  const identity = plans.map((plan) => `${plan.id}:${plan.previewId}`).join("|");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      stopped.current = true;
      if (requestId.current) void window.agentEnv.cancelSkillSummary(requestId.current);
    };
  }, []);
  useEffect(() => {
    let valid = true;
    setRecords({});
    setErrors({});
    for (const plan of plans) {
      void window.agentEnv?.listSkillSummaries?.(plan.id).then((history) => {
        const found = history.find((entry) => entry.beforeHash === plan.beforeContentHash && entry.afterHash === plan.afterContentHash);
        if (valid && found) setRecords((current) => ({ ...current, [plan.id]: found }));
      }).catch(() => { if (valid) setErrors((current) => ({ ...current, [plan.id]: t("Saved summaries could not be loaded. Updates are still available.") })); });
    }
    return () => { valid = false; };
  }, [identity]);
  const selected = plans.filter((plan) => plan.previewId && (!selectedIds || selectedIds.includes(plan.id)));
  const missing = selected.filter((plan) => !records[plan.id]);
  const prepare = async (chosen: SkillUpdatePlan[], regenerate = false, origin = "batch") => {
    if (!allowed || busyId || loadingConfig || configuring || !chosen.length) return;
    setLoadingConfig(true);
    setInitiator(origin);
    setOperationLabel(t(regenerate ? "Regenerate summary" : plans.length === 1 ? "Generate summary" : "Summarize selected ({{count}})", { count: chosen.length }));
    stopped.current = false;
    setErrors({});
    try {
      const config = await window.agentEnv.readSkillSummaryConfig();
      if (!config.model || !config.endpoint) { setNeedsConfig(true); return; }
      setNeedsConfig(false);
      if (active.current && !stopped.current) await run({ config, plans: chosen, regenerate });
    } catch (error) { if (active.current) setErrors({ general: error instanceof Error ? error.message : String(error) }); }
    finally { if (active.current) setLoadingConfig(false); }
  };
  const run = async (selected: { config: SkillSummaryConfig; plans: SkillUpdatePlan[]; regenerate: boolean }) => {
    for (const plan of selected.plans) {
      if (stopped.current || !active.current) break;
      const id = crypto.randomUUID();
      requestId.current = id;
      setBusyId(plan.id);
      try {
        const record = await window.agentEnv.generateSkillSummary({
          previewId: plan.previewId!, requestId: id, expectedEndpoint: selected.config.endpoint,
          expectedModel: selected.config.model,
          confirmed: true, regenerate: selected.regenerate, locale
        });
        if (active.current) setRecords((current) => ({ ...current, [plan.id]: record }));
      } catch (error) {
        if (active.current) setErrors((current) => ({ ...current, [plan.id]: error instanceof Error ? error.message : String(error) }));
      } finally { requestId.current = ""; }
    }
    if (active.current) setBusyId("");
  };
  if (!allowed && !Object.keys(records).length) return null;
  return <section className="skill-summary-review" aria-label={t("Update summaries")}>
    <AIReviewHeading title={t("Update summaries")} actions={<>
      {allowed && plans.length === 1 && records[plans[0].id] ? <IconButton label={t("Regenerate summary")} disabled={disabled || configuring} busy={loadingConfig} onClick={() => void prepare([plans[0]], true)}><RotateCw size={15} /></IconButton>
      : allowed && (missing.length || (loadingConfig && initiator === "batch")) ? <Button icon={<Sparkles size={15} />} disabled={disabled || configuring || loadingConfig} busy={loadingConfig && initiator === "batch"} onClick={() => void prepare(missing)}>
        {loadingConfig && initiator === "batch" ? operationLabel : t(plans.length === 1 ? "Generate summary" : "Summarize selected ({{count}})", { count: missing.length })}
      </Button> : null}
      {loadingConfig ? <Button onClick={() => {
        stopped.current = true;
        if (requestId.current) void window.agentEnv.cancelSkillSummary(requestId.current);
      }}>{t("Stop")}</Button> : null}
    </>} />
    {errors.general ? <Notice tone="warning" role="alert">{errors.general}</Notice> : null}
    {needsConfig && allowed ? <AIServiceSetup editing={configuring} onEditingChange={setConfiguring} onSaved={() => setNeedsConfig(false)} /> : null}
    {plans.map((plan) => records[plan.id] || errors[plan.id] || busyId === plan.id ? <section className="skill-summary-entry" key={plan.id} aria-label={plan.name}>
      {plans.length > 1 ? <AIReviewHeading title={plan.name} actions={allowed ? <IconButton
        label={t(records[plan.id] ? "Regenerate summary" : "Generate summary")}
        disabled={disabled || loadingConfig || configuring} busy={loadingConfig && initiator === plan.id}
        onClick={() => void prepare([plan], Boolean(records[plan.id]), plan.id)}><RotateCw size={15} /></IconButton> : undefined} /> : null}
      {errors[plan.id] ? <Notice tone="warning" role="alert">{errors[plan.id]}</Notice> : null}
      {busyId === plan.id ? <div role="status"><InteractiveStatus busy statusKind="working" label={t("Generating summary")} /></div> : null}
      {records[plan.id] ? <>
        <SkillSummaryContent summary={records[plan.id]} onViewFile={(path) => onViewFile(plan, path, records[plan.id])} />
      </> : null}
    </section> : null)}
  </section>;
};
