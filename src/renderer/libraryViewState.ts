import type {
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo
} from "../shared/types";

export type SkillSourceKindFilter = "all" | "online" | "local";
export type SkillSourceScopeFilter = "monitored" | "manual" | "all";
export type SkillSourceResultFilter = "all" | "changes" | "failed" | "not-checked";

export interface SkillLibraryViewState {
  search: string;
  sourceFilter: SkillSourceKindFilter;
  statusFilter: "enabled" | "updates" | "disabled";
  targetFilter: "all" | SkillInventoryEntry["status"] | "not-installed";
  usageFilter: "all" | "referenced" | "unreferenced";
  scrollTop: number;
}

export const defaultSkillLibraryViewState: SkillLibraryViewState = {
  search: "",
  sourceFilter: "all",
  statusFilter: "enabled",
  targetFilter: "all",
  usageFilter: "all",
  scrollTop: 0
};

export const updateSkillLibraryControls = (
  current: SkillLibraryViewState,
  patch: Partial<Omit<SkillLibraryViewState, "scrollTop">>
): SkillLibraryViewState => ({ ...current, ...patch, scrollTop: 0 });

export const matchesSkillStatusFilter = (
  statusFilter: SkillLibraryViewState["statusFilter"],
  skill: SkillLibraryEntry,
  update?: SkillUpdateInfo
) => {
  if (statusFilter === "enabled") return skill.globallyEnabled !== false;
  if (statusFilter === "disabled") return skill.globallyEnabled === false;
  if (skill.globallyEnabled === false) return false;
  return (
    skill.updatePolicy === "tracked" &&
    Boolean(update?.updateAvailable) &&
    !update?.error
  );
};

export const matchesSkillUsageFilter = (
  usageFilter: SkillLibraryViewState["usageFilter"],
  referenced: boolean,
  enabled = true
) => {
  if (usageFilter === "all") return true;
  if (!enabled) return false;
  return usageFilter === "referenced" ? referenced : !referenced;
};

export const updateLibraryScroll = <T extends { scrollTop: number }>(
  current: T,
  scrollTop: number
): T => ({ ...current, scrollTop: Math.max(0, scrollTop) });
