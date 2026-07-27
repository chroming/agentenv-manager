import type { SkillLibraryEntry, SkillUpdatePlan } from "../shared/types";

export type SkillUpdateRunStatus = "queued" | "updating" | "updated" | "failed";

export interface SkillUpdateRunItem {
  status: SkillUpdateRunStatus;
  error?: string;
}

export type SkillUpdateRun = Record<string, SkillUpdateRunItem>;

export interface SkillUpdateQueueResult {
  updated: SkillLibraryEntry[];
  failed: Array<{ id: string; error: string }>;
}

export const runSkillUpdateQueue = async (
  plans: SkillUpdatePlan[],
  update: (plan: SkillUpdatePlan) => Promise<SkillLibraryEntry>,
  onProgress: (id: string, item: SkillUpdateRunItem) => void
): Promise<SkillUpdateQueueResult> => {
  const updated: SkillLibraryEntry[] = [];
  const failed: SkillUpdateQueueResult["failed"] = [];

  for (const plan of plans) {
    onProgress(plan.id, { status: "updating" });
    try {
      updated.push(await update(plan));
      onProgress(plan.id, { status: "updated" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id: plan.id, error: message });
      onProgress(plan.id, { status: "failed", error: message });
    }
  }

  return { updated, failed };
};
