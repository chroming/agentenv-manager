import { useEffect, useRef, useState } from "react";
import type { SkillUpdatePlan } from "../../shared/types";
import type { SkillSummary, SkillSummaryConfig } from "../../shared/skillSummaries";
import { useI18n } from "../i18n";
import { Button, Notice, ResourcePanelToolbar } from "./ui";
import { SkillSummaryContent } from "./SkillSummaryContent";

export const SkillSummaryReview = ({ plans, selectedIds, onViewFile, disabled = false }: {
  plans: SkillUpdatePlan[]; selectedIds?: string[]; disabled?: boolean;
  onViewFile(plan: SkillUpdatePlan, path: string, summary: SkillSummary): void;
}) => {
  const { t, locale } = useI18n();
  const [records, setRecords] = useState<Record<string, SkillSummary>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [confirmation, setConfirmation] = useState<{ config: SkillSummaryConfig; plans: SkillUpdatePlan[]; regenerate: boolean; omitted: string[]; fileCount: number }>();
  const active = useRef(true);
  const requestId = useRef("");
  const stopped = useRef(false);
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
    if (busyId || loadingConfig || !chosen.length) return;
    setLoadingConfig(true);
    setErrors({});
    try {
      const config = await window.agentEnv.readSkillSummaryConfig();
      if (!config.model) throw new Error(t("Configure Update summaries in Settings first."));
      const prepared: SkillUpdatePlan[] = [];
      const omitted: string[] = [];
      let fileCount = 0;
      for (const plan of chosen) {
        if (!active.current) break;
        try {
          const scope = await window.agentEnv.prepareSkillSummary(plan.previewId!);
          if (!scope.fileCount) throw new Error(t("No readable text changes. Review the original files instead."));
          prepared.push(plan); fileCount += scope.fileCount;
          omitted.push(...scope.omittedPaths.map((path) => `${plan.name}/${path}`));
        } catch (error) { if (active.current) setErrors((current) => ({ ...current, [plan.id]: String(error) })); }
      }
      if (active.current && prepared.length) setConfirmation({ config, plans: prepared, regenerate, omitted, fileCount });
    } catch (error) { if (active.current) setErrors({ general: error instanceof Error ? error.message : String(error) }); }
    finally { if (active.current) setLoadingConfig(false); }
  };
  const run = async () => {
    if (!confirmation || busyId) return;
    const selected = confirmation;
    setConfirmation(undefined);
    stopped.current = false;
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
  return <section className="skill-summary-review" aria-label={t("Update summaries")}>
    <ResourcePanelToolbar>
      <span className="resource-heading skill-summary-heading">{t("Update summaries")}</span>
      {busyId ? <Button onClick={() => {
        stopped.current = true;
        if (requestId.current) void window.agentEnv.cancelSkillSummary(requestId.current);
      }}>{t("Stop")}</Button> : missing.length ? <Button disabled={disabled} busy={loadingConfig} onClick={() => void prepare(missing)}>
        {t(plans.length === 1 ? "Generate summary" : "Summarize selected ({{count}})", { count: missing.length })}
      </Button> : plans.length === 1 && records[plans[0].id] ? <Button disabled={disabled} busy={loadingConfig} onClick={() => void prepare([plans[0]], true)}>{t("Regenerate summary")}</Button> : null}
    </ResourcePanelToolbar>
    {confirmation ? <Notice title={t("Generate summaries?")} actions={<>
      <Button onClick={() => setConfirmation(undefined)}>{t("Cancel")}</Button>
      <Button variant="primary" disabled={disabled} onClick={() => void run()}>{t("Generate {{count}}", { count: confirmation.plans.length })}</Button>
    </>}>
      <p>{t("Selected Skill diffs are sent to this service and may contain private content. Model usage is charged by your provider.")}</p>
      <p>{confirmation.config.endpoint} · {confirmation.config.model}</p>
      <p>{t("{{count}} text files will be analyzed", { count: confirmation.fileCount })}</p>
      {confirmation.omitted.length ? <p>{t("Files not analyzed")}: {confirmation.omitted.join(", ")}</p> : null}
      <p>{t("One request per Skill. Large or binary files may be excluded and will be listed. Nothing is generated automatically.")}</p>
    </Notice> : null}
    {errors.general ? <Notice tone="warning" role="alert">{errors.general}</Notice> : null}
    {plans.map((plan) => records[plan.id] || errors[plan.id] || busyId === plan.id ? <div key={plan.id}>
      {plans.length > 1 ? <h4>{plan.name}</h4> : null}
      {errors[plan.id] ? <Notice tone="warning" role="alert">{errors[plan.id]}</Notice> : null}
      {busyId === plan.id ? <Button busy disabled>{t("Generating summary")}</Button> : null}
      {records[plan.id] ? <>
        <SkillSummaryContent summary={records[plan.id]} onViewFile={(path) => onViewFile(plan, path, records[plan.id])} />
        {plans.length > 1 ? <Button size="compact" disabled={disabled || Boolean(busyId) || loadingConfig} onClick={() => void prepare([plan], true)}>{t("Regenerate summary")}</Button> : null}
      </> : null}
    </div> : null)}
  </section>;
};
