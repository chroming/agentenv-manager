import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { SkillUpdateInfo } from "../shared/types";

export type SkillUpdateActivity =
  | { kind: "check-library" }
  | { kind: "preview-skill"; skillId: string }
  | { kind: "preview-skills"; skillIds: string[] }
  | { kind: "check-source"; sourceId: string }
  | { kind: "check-sources" };

export const useSkillUpdateActivity = (onBegin: () => void) => {
  const [activity, setActivity] = useState<SkillUpdateActivity>();
  const activityRef = useRef<SkillUpdateActivity | undefined>(undefined);
  const begin = (next: SkillUpdateActivity) => {
    if (activityRef.current) return false;
    activityRef.current = next;
    onBegin();
    setActivity(next);
    return true;
  };
  const finish = (current: SkillUpdateActivity) => {
    if (activityRef.current !== current) return;
    activityRef.current = undefined;
    setActivity(undefined);
  };
  return { activity, activityRef, begin, finish };
};

export const useScheduledSkillUpdateChecks = ({
  activityRef,
  enabled,
  intervalMinutes,
  onError,
  onResult
}: {
  activityRef: MutableRefObject<SkillUpdateActivity | undefined>;
  enabled: boolean;
  intervalMinutes: number;
  onError: (error: unknown) => void;
  onResult: (updates: SkillUpdateInfo[]) => void;
}) => {
  const callbacksRef = useRef({ onError, onResult });
  callbacksRef.current = { onError, onResult };
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => {
      if (activityRef.current) return;
      void window.agentEnv.checkSkillLibraryUpdates()
        .then((updates) => callbacksRef.current.onResult(updates))
        .catch((error) => callbacksRef.current.onError(error));
    }, Math.max(5, intervalMinutes) * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [activityRef, enabled, intervalMinutes]);
};
