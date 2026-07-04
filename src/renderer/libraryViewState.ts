import type { SkillInventoryEntry, SkillSourceType } from "../shared/types";

export interface SkillLibraryViewState {
  search: string;
  sourceFilter: "all" | SkillSourceType;
  usageFilter: "all" | "used" | "unused";
  targetFilter: "all" | SkillInventoryEntry["status"] | "not-installed";
  updateFilter: "all" | "updates";
  scrollTop: number;
}

export interface McpLibraryViewState {
  search: string;
  scrollTop: number;
}

export const defaultSkillLibraryViewState: SkillLibraryViewState = {
  search: "",
  sourceFilter: "all",
  usageFilter: "all",
  targetFilter: "all",
  updateFilter: "all",
  scrollTop: 0
};

export const defaultMcpLibraryViewState: McpLibraryViewState = {
  search: "",
  scrollTop: 0
};

export const updateSkillLibraryControls = (
  current: SkillLibraryViewState,
  patch: Partial<Omit<SkillLibraryViewState, "scrollTop">>
): SkillLibraryViewState => ({ ...current, ...patch, scrollTop: 0 });

export const updateMcpLibraryControls = (
  current: McpLibraryViewState,
  patch: Partial<Omit<McpLibraryViewState, "scrollTop">>
): McpLibraryViewState => ({ ...current, ...patch, scrollTop: 0 });

export const updateLibraryScroll = <T extends { scrollTop: number }>(
  current: T,
  scrollTop: number
): T => ({ ...current, scrollTop: Math.max(0, scrollTop) });
