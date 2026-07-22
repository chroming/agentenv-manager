import type { SkillLibraryEntry, SkillUpdateInfo } from "../shared/types";
import type { SkillUpdateCheckStatus } from "./components/SkillLibraryPanel";
import type { TranslationValues } from "./i18n";

type Translate = (message: string, values?: TranslationValues) => string;

export const summarizeSkillUpdateChecks = (
  skillUpdateItems: SkillUpdateInfo[],
  t: Translate
): SkillUpdateCheckStatus => {
  const failedChecks = skillUpdateItems.filter((update) => update.error).length;
  const availableUpdates = skillUpdateItems.filter(
    (update) => update.updateAvailable && !update.error
  ).length;
  if (failedChecks > 0) {
    return {
      state: "error",
      message: t(failedChecks === 1 ? "{{count}} check failed" : "{{count}} checks failed", {
        count: failedChecks
      })
    };
  }
  if (skillUpdateItems.length === 0) {
    return { state: "info", message: t("No skills have update checks enabled") };
  }
  return {
    state: "success",
    message: availableUpdates > 0
      ? t(availableUpdates === 1 ? "{{count}} update available" : "{{count}} updates available", {
          count: availableUpdates
        })
      : t("All tracked skills are up to date")
  };
};

export const summarizeSkillUpdateResult = (
  skillId: string,
  skillUpdateItems: SkillUpdateInfo[],
  t: Translate
): SkillUpdateCheckStatus => {
  const remainingUpdates = skillUpdateItems.filter(
    (update) => update.updateAvailable && !update.error
  ).length;
  return {
    state: "success",
    message: remainingUpdates > 0
      ? t("Updated {{id}} · {{count}} updates remain", { id: skillId, count: remainingUpdates })
      : t("Updated {{id}} · All tracked skills are up to date", { id: skillId })
  };
};

export const reconcileImportedSkillUpdates = (
  current: SkillUpdateInfo[],
  imported: SkillLibraryEntry[]
): SkillUpdateInfo[] => {
  const importedIds = new Set(imported.map((skill) => skill.id));
  return [
    ...current.filter((update) => !importedIds.has(update.id)),
    ...imported
      .filter((skill) => skill.updatePolicy === "tracked" && Boolean(skill.remoteRevision))
      .map((skill): SkillUpdateInfo => ({
        id: skill.id,
        name: skill.name,
        sourceType: skill.sourceType,
        currentRevision: skill.remoteRevision,
        latestRevision: skill.remoteRevision,
        latestUpdatedAt: skill.upstream?.updatedAt,
        updateAvailable: false
      }))
  ];
};
