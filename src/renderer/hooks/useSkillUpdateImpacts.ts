import { useEffect, useState } from "react";
import type { SkillUpdateImpact, SkillUpdatePlan } from "../../shared/types";

export const useSkillUpdateImpacts = (plans: SkillUpdatePlan[]) => {
  const [impacts, setImpacts] = useState<Record<string, SkillUpdateImpact>>({});
  const key = plans.filter((plan) => plan.impact?.status === "pending").map((plan) => plan.previewId).join("\0");
  useEffect(() => {
    let active = true;
    for (const plan of plans) {
      if (!plan.previewId || plan.impact?.status !== "pending") continue;
      const previewId = plan.previewId;
      void Promise.resolve().then(() => window.agentEnv.readLibrarySkillUpdateImpact(previewId)).catch(() => ({
        ...plan.impact, status: "partial" as const
      })).then((impact) => {
        if (active) setImpacts((current) => ({ ...current, [previewId]: impact }));
      });
    }
    return () => { active = false; };
  }, [key]);
  return plans.map((plan) => plan.previewId && impacts[plan.previewId] ? { ...plan, impact: impacts[plan.previewId] } : plan);
};
