import { useRef, type MutableRefObject } from "react";
import type {
  SkillSourceCheckAllResult,
  SkillSourceGroupView
} from "../../shared/types";
import type { SkillUpdateActivity } from "../skillUpdateActivity";
import { useScheduledSkillUpdateChecks } from "../skillUpdateActivity";
import type { useFreshnessCoordinator } from "./useFreshnessCoordinator";

type FreshnessRunner = ReturnType<typeof useFreshnessCoordinator>["run"];

export const useAutomaticSkillSourceChecks = ({
  activityRef,
  enabled,
  groups,
  intervalMinutes,
  lastCheckAt,
  onResult,
  runFreshness
}: {
  activityRef: MutableRefObject<SkillUpdateActivity | undefined>;
  enabled: boolean;
  groups: SkillSourceGroupView[];
  intervalMinutes: number;
  lastCheckAt?: number;
  onResult(result: SkillSourceCheckAllResult): void;
  runFreshness: FreshnessRunner;
}) => {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useScheduledSkillUpdateChecks({
    activityRef,
    enabled,
    groups,
    intervalMinutes,
    lastCheckAt,
    onCheck: async () => {
      try {
        const outcome = await runFreshness(
          "skill-upstreams",
          "timer",
          () => window.agentEnv.checkMonitoredSkillSourceGroups(),
          {
            force: true,
            partialError: (value) => {
              const result = value as SkillSourceCheckAllResult;
              return result.failed > 0
                ? `${result.failed} source checks failed`
                : undefined;
            }
          }
        );
        const result = outcome.value;
        if (result) onResultRef.current(result);
        return result;
      } catch (unknownError) {
        console.warn(
          `[AgentEnv] Automatic Skill source check failed: ${
            unknownError instanceof Error ? unknownError.message : String(unknownError)
          }`
        );
        return undefined;
      }
    }
  });
};
