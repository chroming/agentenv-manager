import type {
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillSourceType,
  SkillUpdateInfo
} from "../shared/types";

export interface SkillLibraryViewState {
  search: string;
  sourceFilter: "all" | SkillSourceType;
  statusFilter: "all" | "updates" | "referenced" | "unreferenced" | "disabled";
  targetFilter: "all" | SkillInventoryEntry["status"] | "not-installed";
  scrollTop: number;
}

export interface McpLibraryViewState {
  search: string;
  scrollTop: number;
}

export const defaultSkillLibraryViewState: SkillLibraryViewState = {
  search: "",
  sourceFilter: "all",
  statusFilter: "all",
  targetFilter: "all",
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

export const matchesSkillStatusFilter = (
  statusFilter: SkillLibraryViewState["statusFilter"],
  skill: SkillLibraryEntry,
  referenced: boolean,
  update?: SkillUpdateInfo
) => {
  if (statusFilter === "all") return true;
  if (statusFilter === "referenced") return referenced;
  if (statusFilter === "unreferenced") return !referenced;
  if (statusFilter === "disabled") return skill.globallyEnabled === false;
  return (
    skill.globallyEnabled !== false &&
    skill.updatePolicy === "tracked" &&
    Boolean(update?.updateAvailable) &&
    !update?.error
  );
};

export const updateLibraryScroll = <T extends { scrollTop: number }>(
  current: T,
  scrollTop: number
): T => ({ ...current, scrollTop: Math.max(0, scrollTop) });
