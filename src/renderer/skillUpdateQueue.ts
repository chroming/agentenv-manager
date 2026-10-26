import type { SkillLibraryUpdateResult, SkillUpdatePlan, SkillUpdateSkippedCopy } from "../shared/types";

export type SkillUpdateRunStatus = "queued" | "updating" | "updated" | "failed" | "skipped";

export interface SkillUpdateRunItem {
  status: SkillUpdateRunStatus;
  error?: string;
  skippedAgentCopies?: SkillUpdateSkippedCopy[];
}

export type SkillUpdateRun = Record<string, SkillUpdateRunItem>;

export interface SkillUpdateQueueResult {
  updated: SkillLibraryUpdateResult[];
  failed: Array<{ id: string; error: string }>;
  cancelled: boolean;
}

export const runSkillUpdateQueue = async (
  plans: SkillUpdatePlan[],
  update: (plan: SkillUpdatePlan) => Promise<SkillLibraryUpdateResult>,
  onProgress: (id: string, item: SkillUpdateRunItem) => void,
  shouldStop: () => boolean = () => false
): Promise<SkillUpdateQueueResult> => {
  const updated: SkillLibraryUpdateResult[] = [];
  const failed: SkillUpdateQueueResult["failed"] = [];

  for (const [index, plan] of plans.entries()) {
    if (shouldStop()) {
      for (const skippedPlan of plans.slice(index)) {
        onProgress(skippedPlan.id, { status: "skipped" });
      }
      return { updated, failed, cancelled: true };
    }
    onProgress(plan.id, { status: "updating" });
    try {
      const result = await update(plan);
      updated.push(result);
      onProgress(plan.id, {
        status: "updated",
        ...(result.skippedAgentCopies?.length ? { skippedAgentCopies: result.skippedAgentCopies } : {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id: plan.id, error: message });
      onProgress(plan.id, { status: "failed", error: message });
    }
  }

  return { updated, failed, cancelled: false };
};
