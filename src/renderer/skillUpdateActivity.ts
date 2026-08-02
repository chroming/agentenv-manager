import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type {
  SkillSourceCheckAllResult,
  SkillSourceGroupView
} from "../shared/types";
import { nextMonitoredSkillCheckDelay } from "./freshness";

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
  groups,
  intervalMinutes,
  lastCheckAt,
  onCheck
}: {
  activityRef: MutableRefObject<SkillUpdateActivity | undefined>;
  enabled: boolean;
  groups: SkillSourceGroupView[];
  intervalMinutes: number;
  lastCheckAt?: number;
  onCheck: () => Promise<SkillSourceCheckAllResult | undefined>;
}) => {
  const onCheckRef = useRef(onCheck);
  const lastAttemptAtRef = useRef<number | undefined>(undefined);
  onCheckRef.current = onCheck;
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: number | undefined;
    let stopped = false;
    const run = () => {
      if (activityRef.current) {
        timer = window.setTimeout(run, 30_000);
        return;
      }
      lastAttemptAtRef.current = Date.now();
      void onCheckRef.current()
        .catch(() => undefined)
        .finally(() => {
          if (stopped) return;
          timer = window.setTimeout(
            run,
            Math.max(5, intervalMinutes) * 60_000
          );
        });
    };
    const schedule = () => {
      const now = Date.now();
      const sourceDelay = nextMonitoredSkillCheckDelay({
        groups,
        intervalMinutes,
        now
      });
      if (sourceDelay === undefined) return;
      const lastAttemptAt = Math.max(
        lastAttemptAtRef.current ?? 0,
        lastCheckAt ?? 0
      ) || undefined;
      const retryDelay = lastAttemptAt === undefined
        ? 0
        : Math.max(
            0,
            Math.max(5, intervalMinutes) * 60_000 -
              (now - lastAttemptAt)
          );
      const delay = Math.max(sourceDelay, retryDelay);
      timer = window.setTimeout(() => {
        if (!stopped) run();
      }, Math.max(0, delay));
    };
    const handleFocus = () => {
      const now = Date.now();
      const sourceDelay = nextMonitoredSkillCheckDelay({
        groups,
        intervalMinutes,
        now
      });
      const lastAttemptAt = Math.max(
        lastAttemptAtRef.current ?? 0,
        lastCheckAt ?? 0
      ) || undefined;
      const retryDue = lastAttemptAt === undefined ||
        now - lastAttemptAt >= Math.max(5, intervalMinutes) * 60_000;
      if (sourceDelay !== 0 || !retryDue || activityRef.current) return;
      if (timer !== undefined) window.clearTimeout(timer);
      run();
    };
    schedule();
    window.addEventListener("focus", handleFocus);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [activityRef, enabled, groups, intervalMinutes, lastCheckAt]);
};
