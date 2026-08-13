import type {
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo
} from "../../../shared/types";
import { externalManagerLabel } from "../../skillCleanupPresentation";

export const buildSkillLibraryLookups = (
  librarySkills: SkillLibraryEntry[],
  skillUpdates: SkillUpdateInfo[]
) => {
  const updatesById = new Map(skillUpdates.map((update) => [update.id, update]));
  const skillsById = new Map(librarySkills.map((skill) => [skill.id, skill]));
  const skillNameCounts = librarySkills.reduce((counts, skill) => {
    const key = skill.name.normalize("NFKC").trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const enabledSkillIds = new Set(
    librarySkills.filter((skill) => skill.globallyEnabled !== false).map((skill) => skill.id)
  );
  const updateableSkillIds = skillUpdates
    .filter((update) => update.updateAvailable && !update.error)
    .filter((update) => enabledSkillIds.has(update.id))
    .filter((update) => skillsById.get(update.id)?.updatePolicy === "tracked")
    .map((update) => update.id);
  return { updatesById, skillsById, skillNameCounts, updateableSkillIds };
};

export const buildLocalSkillImportImpact = (item?: SkillInventoryEntry) => {
  if (!item) return undefined;
  if (item.status === "managed") {
    return { message: "This Agent copy is already managed by AgentEnv and is present in Library." };
  }
  if (item.status === "left-unmanaged") {
    return { message: "AgentEnv will not change this path. Import creates an independent Library copy without changing that boundary." };
  }
  if (item.status === "library" && item.contentMatchesLibrary !== true) {
    return { message: "This folder differs from the existing Library version. Import will open a comparison before making changes." };
  }
  if (item.status !== "outside") return undefined;
  if (item.externalEvidence?.importable === false) {
    return {
      message: "This Skill is provided by {{manager}} and remains read-only here.",
      values: { manager: externalManagerLabel(item) }
    };
  }
  if (item.externalEvidence) {
    return {
      message: "AgentEnv found {{manager}} metadata. Import creates an independent Library copy and leaves this path unchanged.",
      values: { manager: externalManagerLabel(item) }
    };
  }
  return { message: "Import creates an independent Library copy and leaves this Agent path unchanged." };
};

export const buildCleanupDetailVersions = (items: SkillInventoryEntry[]) =>
  [...items.reduce((groups, item) => {
    const unavailable = !item.contentHash || item.runtimeIssues?.some(
      (issue) => issue.code === "unreadable-skill"
    );
    const key = unavailable ? "unavailable" : item.contentHash;
    groups.set(key, [...(groups.get(key) ?? []), item]);
    return groups;
  }, new Map<string, SkillInventoryEntry[]>()).entries()]
    .map(([key, groupedItems]) => ({ key, items: groupedItems }))
    .sort((left, right) =>
      left.key === "unavailable" ? 1 : right.key === "unavailable" ? -1 : left.key.localeCompare(right.key)
    );
