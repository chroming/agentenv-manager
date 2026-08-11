import { useCallback, useRef, useState } from "react";
import type { SkillUpdatePlan } from "../../shared/types";
import {
  runSkillUpdateQueue,
  type SkillUpdateRun,
  type SkillUpdateRunItem
} from "../skillUpdateQueue";

export const useSkillUpdateQueue = () => {
  const [run, setRun] = useState<SkillUpdateRun>({});
  const [stopRequested, setStopRequested] = useState(false);
  const stopRequestedRef = useRef(false);
  const resetRun = useCallback(() => setRun({}), []);
  const resetStop = useCallback(() => {
    stopRequestedRef.current = false;
    setStopRequested(false);
  }, []);
  const requestStop = useCallback(() => {
    stopRequestedRef.current = true;
    setStopRequested(true);
  }, []);
  const execute = useCallback((
    plans: SkillUpdatePlan[],
    preserveExistingProgress: boolean,
    allowStop = false,
    syncCopiedInstalls = false
  ) => {
    setRun((current) => {
      const next = preserveExistingProgress ? { ...current } : {};
      for (const plan of plans) next[plan.id] = { status: "queued" };
      return next;
    });
    const updateProgress = (id: string, item: SkillUpdateRunItem) => {
      setRun((current) => ({ ...current, [id]: item }));
    };
    return runSkillUpdateQueue(
      plans,
      (plan) => window.agentEnv.updateLibrarySkill({
        id: plan.id,
        previewId: plan.previewId!,
        syncCopiedInstalls
      }),
      updateProgress,
      allowStop ? () => stopRequestedRef.current : undefined
    );
  }, []);

  return { execute, requestStop, resetRun, resetStop, run, stopRequested };
};
