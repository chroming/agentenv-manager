import type { SkillLibraryEntry, SkillUpdateInfo } from "../shared/types";

export type SkillMaintenanceState = "disabled" | "untracked" | "unchecked" | "current" | "update" | "removed" | "error" | "new" | "ignored" | "invalid" | "conflict" | "missing";

export const skillMaintenanceState = (
  skill: Pick<SkillLibraryEntry, "globallyEnabled" | "updatePolicy">,
  update?: SkillUpdateInfo
): SkillMaintenanceState => {
  if (skill.globallyEnabled === false) return "disabled";
  if (skill.updatePolicy !== "tracked") return "untracked";
  if (update?.sourceStatus === "removed") return "removed";
  if (update?.error) return "error";
  if (update?.updateAvailable) return "update";
  return update ? "current" : "unchecked";
};
