import { useEffect, useRef, useState } from "react";
import type { SkillUpdatePlan } from "../../shared/types";
import type { SkillSummary, SkillSummaryConfig } from "../../shared/skillSummaries";
import { useI18n } from "../i18n";
import { Button, InteractiveStatus, Notice, ResourcePanelToolbar } from "./ui";
import { SkillSummaryContent } from "./SkillSummaryContent";
import { useAIPreferences } from "../hooks/useAIPreferences";

export const SkillSummaryReview = ({ plans, selectedIds, onViewFile, disabled = false }: {
  plans: SkillUpdatePlan[]; selectedIds?: string[]; disabled?: boolean;
  onViewFile(plan: SkillUpdatePlan, path: string, summary: SkillSummary): void;
}) => {
  const { t, locale } = useI18n();
  const [records, setRecords] = useState<Record<string, SkillSummary>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [operationLabel, setOperationLabel] = useState("");
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
  const prepare = async (chosen: SkillUpdatePlan[], regenerate = false) => {
    if (!allowed || busyId || loadingConfig || !chosen.length) return;
    setLoadingConfig(true);
    setOperationLabel(t(regenerate ? "Regenerate summary" : plans.length === 1 ? "Generate summary" : "Summarize selected ({{count}})", { count: chosen.length }));
    stopped.current = false;
    setErrors({});
    try {
      const config = await window.agentEnv.readSkillSummaryConfig();
      if (!config.model) throw new Error(t("Configure the AI service in Settings first."));
      const prepared: SkillUpdatePlan[] = [];
      for (const plan of chosen) {
        if (!active.current || stopped.current) break;
        try {
          const scope = await window.agentEnv.prepareSkillSummary(plan.previewId!);
          if (!scope.fileCount) throw new Error(t("No readable text changes. Review the original files instead."));
          prepared.push(plan);
        } catch (error) { if (active.current) setErrors((current) => ({ ...current, [plan.id]: String(error) })); }
      }
      if (active.current && !stopped.current && prepared.length) await run({ config, plans: prepared, regenerate });
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
    <ResourcePanelToolbar variant="flush">
      <span className="resource-heading skill-summary-heading">{t("Update summaries")}</span>
      {allowed && (missing.length || loadingConfig) ? <Button disabled={disabled} busy={loadingConfig} onClick={() => void prepare(missing)}>
        {loadingConfig ? operationLabel : t(plans.length === 1 ? "Generate summary" : "Summarize selected ({{count}})", { count: missing.length })}
      </Button> : allowed && plans.length === 1 && records[plans[0].id] ? <Button disabled={disabled} busy={loadingConfig} onClick={() => void prepare([plans[0]], true)}>{t("Regenerate summary")}</Button> : null}
      {loadingConfig ? <Button onClick={() => {
        stopped.current = true;
        if (requestId.current) void window.agentEnv.cancelSkillSummary(requestId.current);
      }}>{t("Stop")}</Button> : null}
    </ResourcePanelToolbar>
    {errors.general ? <Notice tone="warning" role="alert">{errors.general}</Notice> : null}
    {plans.map((plan) => records[plan.id] || errors[plan.id] || busyId === plan.id ? <div key={plan.id}>
      {plans.length > 1 ? <h4>{plan.name}</h4> : null}
      {errors[plan.id] ? <Notice tone="warning" role="alert">{errors[plan.id]}</Notice> : null}
      {busyId === plan.id ? <div role="status"><InteractiveStatus busy statusKind="working" label={t("Generating summary")} /></div> : null}
      {records[plan.id] ? <>
        <SkillSummaryContent summary={records[plan.id]} onViewFile={(path) => onViewFile(plan, path, records[plan.id])} />
        {allowed && plans.length > 1 ? <Button size="compact" disabled={disabled || Boolean(busyId) || loadingConfig} onClick={() => void prepare([plan], true)}>{t("Regenerate summary")}</Button> : null}
      </> : null}
    </div> : null)}
  </section>;
};
