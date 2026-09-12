import type { SkillMaintenanceState } from "../../src/renderer/skillMaintenanceState";

// Keep unlike render branches together: homogeneous fixtures hide alignment bugs.
export const mixedSkillSources = [
  { id: "ui-alpha-skill", sourceType: "github", source: "https://github.com/example/very-long-repository-name/tree/main/skills/long-skill-directory" },
  { id: "ui-beta-skill", sourceType: "git", source: "git@example.test:team/skills.git" }
] as const;

export const mixedMaintenanceStates = [
  "untracked", "current", "update", "error", "removed", "disabled", "conflict", "missing"
] as const satisfies readonly SkillMaintenanceState[];

export const desktopReviewSizes = [[920, 620], [1180, 728], [1440, 900]] as const;
