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

export type SkillCleanupDisplayState =
  | "not-in-library"
  | "duplicate-copies"
  | "multiple-versions"
  | "copies-not-managed"
  | "local-changes-found"
  | "managed-copy-changed"
  | "managed-elsewhere"
  | "shared-copy-in-use"
  | "shared-copy-replaceable"
  | "kept-shared"
  | "managed"
  | "ignored";

export type SkillCleanupRecommendedAction =
  | "add-to-library"
  | "manage-copies"
  | "review-differences"
  | "review-drift"
  | "review-ownership"
  | "open-profiles"
  | "review-replacement"
  | "none";

export interface SkillCleanupPresentation {
  state: SkillCleanupDisplayState;
  action: SkillCleanupRecommendedAction;
}

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
  presentation: SkillCleanupPresentation;
  sharedMigration?: SharedSkillMigration;
}

export const buildSkillCleanupGroups = (
  skillInventory: SkillInventoryEntry[],
  options: {
    installedTargetIds?: readonly string[];
    preparedTargetIdsBySkill?: Readonly<Record<string, readonly string[]>>;
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
      const unresolvedExternal = activeItems.some(
        (item) =>
          item.status === "external" &&
          (!item.libraryId || item.contentMatchesLibrary !== true)
      );
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
      const sharedLibraryItem = sharedItems.find(
        (item) => item.libraryId && item.contentMatchesLibrary === true
      );
      const preparedTargets = new Set(options.preparedTargetIdsBySkill?.[skillKey] ?? []);
      const pendingConsumers = consumers.filter(
        (targetId) => !preparedTargets.has(targetId)
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
      const hasLibraryCopy = activeItems.some((item) => Boolean(item.libraryId));

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
        state === "ignored" || state === "managed" || (state === "external" && !unresolvedExternal)
          ? "resolved"
          : state === "external" || state === "conflict" || missingTarget
            ? "manual"
            : "automatic";
      const resolutionReason =
        resolution === "resolved"
          ? state === "ignored"
            ? "Intentionally excluded from management."
            : state === "external"
              ? "Every externally managed copy has matching content in Library."
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

      const presentation: SkillCleanupPresentation = allIgnored
        ? sharedKept
          ? { state: "kept-shared", action: "none" }
          : { state: "ignored", action: "none" }
        : hasExternal
          ? {
              state: "managed-elsewhere",
              action: unresolvedExternal ? "review-ownership" : "none"
            }
          : sharedMigration?.state === "ready"
            ? { state: "shared-copy-replaceable", action: "review-replacement" }
            : sharedMigration?.state === "waiting"
              ? { state: "shared-copy-in-use", action: "open-profiles" }
              : sharedMigration?.state === "kept"
                ? { state: "kept-shared", action: "none" }
                : sharedMigration?.state === "external"
                  ? { state: "managed-elsewhere", action: "review-ownership" }
                  : sharedMigration
                    ? hasLibraryCopy
                      ? { state: "local-changes-found", action: "review-differences" }
                      : hashes.size > 1
                        ? { state: "multiple-versions", action: "add-to-library" }
                        : activeItems.length > 1
                          ? { state: "duplicate-copies", action: "add-to-library" }
                          : { state: "not-in-library", action: "add-to-library" }
                    : !hasLibraryCopy
                      ? hashes.size > 1
                        ? { state: "multiple-versions", action: "add-to-library" }
                        : activeItems.length > 1
                          ? { state: "duplicate-copies", action: "add-to-library" }
                          : { state: "not-in-library", action: "add-to-library" }
                      : staleManaged
                        ? { state: "managed-copy-changed", action: "review-drift" }
                        : allManaged
                          ? { state: "managed", action: "none" }
                          : state === "conflict"
                            ? { state: "local-changes-found", action: "review-differences" }
                            : { state: "copies-not-managed", action: "manage-copies" };

      return {
        skillKey,
        items,
        activeItems,
        primary: activeItems[0] ?? items[0],
        state,
        resolution,
        resolutionReason,
        presentation,
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
  if (group.sharedMigration || group.resolution !== "automatic") {
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
      path: item.path,
      contentHash: item.contentHash
    }))
  };
};
