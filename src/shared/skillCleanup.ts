import type { SkillCleanupRequest, SkillInventoryEntry } from "./types";

export type SkillCleanupGroupState =
  | "ignored"
  | "managed"
  | "stale"
  | "external"
  | "conflict"
  | "duplicate"
  | "unmanaged"
  | "library";

export type SkillCleanupResolution = "automatic" | "manual" | "resolved";

export type SharedSkillMigrationState =
  | "not-imported"
  | "waiting"
  | "ready"
  | "kept"
  | "external"
  | "conflict";

export interface SharedSkillMigration {
  state: SharedSkillMigrationState;
  consumers: string[];
  pendingConsumers: string[];
  paths: string[];
  libraryId?: string;
}

export interface SkillCleanupGroup {
  skillKey: string;
  items: SkillInventoryEntry[];
  activeItems: SkillInventoryEntry[];
  primary?: SkillInventoryEntry;
  state: SkillCleanupGroupState;
  resolution: SkillCleanupResolution;
  resolutionReason: string;
  sharedMigration?: SharedSkillMigration;
}

export const buildSkillCleanupGroups = (
  skillInventory: SkillInventoryEntry[],
  options: {
    installedTargetIds?: readonly string[];
    managedTargetIds?: readonly string[];
  } = {}
): SkillCleanupGroup[] => {
  const byKey = new Map<string, SkillInventoryEntry[]>();
  for (const skill of skillInventory) {
    const key = skill.skillKey || skill.id;
    byKey.set(key, [...(byKey.get(key) ?? []), skill]);
  }

  return [...byKey.entries()]
    .map(([skillKey, items]): SkillCleanupGroup => {
      const activeItems = items.filter((item) => item.status !== "ignored");
      const hashes = new Set(activeItems.map((item) => item.contentHash).filter(Boolean));
      const statuses = new Set(activeItems.map((item) => item.status));
      const allIgnored = activeItems.length === 0;
      const allManaged =
        activeItems.length > 0 && activeItems.every((item) => item.status === "managed");
      const staleManaged = activeItems.some(
        (item) => item.status === "managed" && item.contentMatchesLibrary === false
      );
      const libraryConflict = activeItems.some(
        (item) =>
          item.status === "library" &&
          Boolean(item.libraryId) &&
          item.contentMatchesLibrary !== true
      );
      const hasExternal = statuses.has("external");
      const missingTarget = activeItems.some(
        (item) => item.status !== "managed" && item.foundIn.length === 0
      );
      const sharedItems = items.filter((item) => item.sharedLocation);
      const installedTargets = options.installedTargetIds
        ? new Set(options.installedTargetIds)
        : undefined;
      const consumers = [...new Set(sharedItems.flatMap((item) => item.foundIn))]
        .filter((targetId) => !installedTargets || installedTargets.has(targetId))
        .sort();
      const managedTargets = new Set(options.managedTargetIds ?? []);
      const sharedLibraryItem = sharedItems.find(
        (item) => item.libraryId && item.contentMatchesLibrary === true
      );
      const migratedTargets = new Set(
        items
          .filter(
            (item) =>
              !item.sharedLocation &&
              item.status === "managed" &&
              item.libraryId === sharedLibraryItem?.libraryId &&
              item.contentMatchesLibrary === true
          )
          .flatMap((item) => item.foundIn)
      );
      const pendingConsumers = consumers.filter(
        (targetId) => !managedTargets.has(targetId) || !migratedTargets.has(targetId)
      );
      const sharedKept =
        sharedItems.length > 0 &&
        sharedItems.every(
          (item) => item.status === "ignored" && item.ignoreReason === "keep-shared"
        );
      const sharedConflict =
        sharedItems.some(
          (item) => item.libraryId && item.contentMatchesLibrary === false
        ) || hashes.size > 1;
      const sharedMigration: SharedSkillMigration | undefined = sharedItems.length === 0
        ? undefined
        : {
            state: sharedKept
              ? "kept"
              : sharedItems.some((item) => item.status === "external")
                ? "external"
                : sharedConflict
                  ? "conflict"
                  : !sharedLibraryItem
                    ? "not-imported"
                    : pendingConsumers.length > 0
                      ? "waiting"
                      : "ready",
            consumers,
            pendingConsumers,
            paths: [...new Set(sharedItems.map((item) => item.path))].sort(),
            libraryId: sharedLibraryItem?.libraryId
          };

      const state: SkillCleanupGroupState = allIgnored
        ? "ignored"
        : allManaged && !staleManaged
          ? "managed"
          : hasExternal
            ? "external"
            : libraryConflict || (!allManaged && hashes.size > 1)
              ? "conflict"
              : staleManaged
                ? "stale"
                : activeItems.length > 1
                  ? "duplicate"
                  : statuses.has("unmanaged")
                    ? "unmanaged"
                    : statuses.has("library")
                      ? "library"
                      : "managed";

      const resolution: SkillCleanupResolution =
        state === "ignored" || state === "managed"
          ? "resolved"
          : state === "external" || state === "conflict" || missingTarget
            ? "manual"
            : "automatic";
      const resolutionReason =
        resolution === "resolved"
          ? state === "ignored"
            ? "Intentionally excluded from management."
            : "Every detected copy is managed and current."
          : resolution === "automatic"
            ? state === "stale"
              ? "Managed copies can be refreshed from Library without choosing content."
              : state === "duplicate"
                ? "All detected copies have identical content."
                : state === "library"
                  ? "The local copy already matches the Library version."
                  : "A single local copy can become the Library version."
            : state === "external"
              ? "An external manager owns at least one detected copy."
              : missingTarget
                ? "A destination Target could not be identified."
                : "Detected copies differ and require a version choice.";

      return {
        skillKey,
        items,
        activeItems,
        primary: activeItems[0] ?? items[0],
        state,
        resolution,
        resolutionReason,
        sharedMigration
      };
    })
    .sort((left, right) =>
      (left.primary?.name ?? left.skillKey).localeCompare(
        right.primary?.name ?? right.skillKey
      )
    );
};

export const automaticSkillCleanupRequest = (
  group: SkillCleanupGroup
): SkillCleanupRequest | undefined => {
  if (group.resolution !== "automatic") {
    return undefined;
  }
  const locations = group.activeItems.filter(
    (item) =>
      !item.sharedLocation &&
      item.status !== "ignored" &&
      item.status !== "external" &&
      (item.status !== "managed" || item.contentMatchesLibrary === false)
  );
  if (locations.length === 0 || locations.some((item) => !item.foundIn[0])) {
    return undefined;
  }

  return {
    skillKey: group.skillKey,
    libraryId:
      group.items.find((item) => item.libraryId)?.libraryId ?? group.skillKey,
    canonicalPath: locations[0].path,
    locations: locations.map((item) => ({
      targetId: item.foundIn[0],
      path: item.path
    }))
  };
};
