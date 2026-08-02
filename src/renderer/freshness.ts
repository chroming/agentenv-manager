import type { SkillSourceGroupView } from "../shared/types";

export type FreshResource =
  | "agents"
  | "skill-library"
  | "local-skills"
  | "skill-upstreams"
  | "conversations"
  | "backups";

export type FreshnessReason =
  | "startup"
  | "page-entry"
  | "focus"
  | "timer"
  | "mutation"
  | "manual";

export type FreshnessStatus =
  | "idle"
  | "refreshing"
  | "ready"
  | "partial"
  | "error";

export interface FreshnessState {
  error?: string;
  invalidated: boolean;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  status: FreshnessStatus;
}

export type FreshnessStateMap = Record<FreshResource, FreshnessState>;

export const FRESHNESS_MAX_AGE_MS: Record<
  Exclude<FreshResource, "skill-upstreams">,
  Partial<Record<FreshnessReason, number>>
> = {
  agents: {
    startup: 0,
    "page-entry": 60_000,
    focus: 5 * 60_000,
    mutation: 0,
    manual: 0
  },
  "skill-library": {
    startup: 0,
    "page-entry": 60_000,
    focus: 5 * 60_000,
    mutation: 0,
    manual: 0
  },
  "local-skills": {
    startup: 0,
    "page-entry": 60_000,
    focus: 5 * 60_000,
    mutation: 0,
    manual: 0
  },
  conversations: {
    "page-entry": 60_000,
    focus: 60_000,
    mutation: 0,
    manual: 0
  },
  backups: {
    "page-entry": 60_000,
    mutation: 0,
    manual: 0
  }
};

const resources: FreshResource[] = [
  "agents",
  "skill-library",
  "local-skills",
  "skill-upstreams",
  "conversations",
  "backups"
];

export const createFreshnessStateMap = (): FreshnessStateMap =>
  Object.fromEntries(
    resources.map((resource) => [
      resource,
      { invalidated: false, status: "idle" } satisfies FreshnessState
    ])
  ) as FreshnessStateMap;

export const shouldRefreshResource = ({
  force = false,
  maxAgeMs,
  now,
  state
}: {
  force?: boolean;
  maxAgeMs: number;
  now: number;
  state: FreshnessState;
}) => {
  if (force || state.invalidated) return true;
  if (state.status === "refreshing") return false;
  if (state.lastSuccessAt === undefined) return true;
  return now - state.lastSuccessAt >= Math.max(0, maxAgeMs);
};

export const monitoredSkillSourceGroups = (groups: SkillSourceGroupView[]) =>
  groups.filter((group) => group.automaticChecks !== false);

export const oldestMonitoredSkillCheckAt = (groups: SkillSourceGroupView[]) => {
  const monitored = monitoredSkillSourceGroups(groups);
  if (monitored.length === 0 || monitored.some((group) => !group.checkedAt)) {
    return undefined;
  }
  const timestamps = monitored.map((group) => Date.parse(group.checkedAt!));
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    return undefined;
  }
  return Math.min(...timestamps);
};

export const monitoredSkillSourcesDue = ({
  groups,
  intervalMinutes,
  now
}: {
  groups: SkillSourceGroupView[];
  intervalMinutes: number;
  now: number;
}) => {
  const monitored = monitoredSkillSourceGroups(groups);
  if (monitored.length === 0) return false;
  const checkedAt = oldestMonitoredSkillCheckAt(monitored);
  return checkedAt === undefined ||
    checkedAt > now ||
    now - checkedAt >= Math.max(5, intervalMinutes) * 60_000;
};

export const nextMonitoredSkillCheckDelay = ({
  groups,
  intervalMinutes,
  now
}: {
  groups: SkillSourceGroupView[];
  intervalMinutes: number;
  now: number;
}) => {
  const monitored = monitoredSkillSourceGroups(groups);
  if (monitored.length === 0) return undefined;
  const checkedAt = oldestMonitoredSkillCheckAt(monitored);
  if (checkedAt === undefined || checkedAt > now) return 0;
  return Math.max(
    0,
    Math.max(5, intervalMinutes) * 60_000 - (now - checkedAt)
  );
};
