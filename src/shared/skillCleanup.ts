import type { SkillCleanupRequest, SkillInventoryEntry } from "./types";

export type SkillCleanupGroupState =
  | "kept-outside"
  | "managed"
  | "stale"
  | "outside"
  | "broken"
  | "conflict"
  | "duplicate"
  | "library";

export type SkillCleanupResolution = "automatic" | "manual" | "resolved";

export type SkillCleanupBucket = "decision" | "ready" | "managed" | "kept";

export type SkillCleanupAutomaticEffect =
  | "import-and-link"
  | "import-shared"
  | "link-to-library"
  | "archive-and-link"
  | "repair-link"
  | "remove-broken-link";

export type SkillCleanupDisplayState =
  | "not-in-library"
  | "duplicate-copies"
  | "multiple-versions"
  | "copies-not-managed"
  | "local-changes-found"
  | "managed-copy-changed"
  | "outside-agentenv"
  | "shared-copy-in-use"
  | "shared-copy-replaceable"
  | "kept-shared"
  | "unavailable"
  | "managed"
  | "kept-outside";

export type SkillCleanupRecommendedAction =
  | "add-to-library"
  | "manage-copies"
  | "review-differences"
  | "review-drift"
  | "review-paths"
  | "open-profiles"
  | "review-replacement"
  | "review-details"
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
  | "outside"
  | "conflict";

export interface SharedSkillMigration {
  state: SharedSkillMigrationState;
  consumers: string[];
  pendingConsumers: string[];
  paths: string[];
  libraryId?: string;
}

export interface SkillCleanupPreparedTarget {
  targetId: string;
  libraryId?: string;
  sharedPaths?: readonly string[];
}

const comparablePaths = (paths: readonly string[] = []) =>
  [...new Set(paths.map((path) => path.length > 1 ? path.replace(/[\\/]+$/, "") : path))].sort();

const isObserveOnlySkill = (item: SkillInventoryEntry) =>
  item.locationRole === "discovery-only" ||
  (item.locationManagement === "observed" && !item.sharedLocation);

export const isSkillCleanupPreparationCurrent = (
  preparation: SkillCleanupPreparedTarget,
  libraryId: string | undefined,
  sharedPaths: readonly string[]
) =>
  Boolean(libraryId) &&
  preparation.libraryId === libraryId &&
  JSON.stringify(comparablePaths(preparation.sharedPaths)) ===
    JSON.stringify(comparablePaths(sharedPaths));

export interface SkillCleanupGroup {
  skillKey: string;
  items: SkillInventoryEntry[];
  activeItems: SkillInventoryEntry[];
  primary?: SkillInventoryEntry;
  state: SkillCleanupGroupState;
  resolution: SkillCleanupResolution;
  resolutionReason: string;
  bucket: SkillCleanupBucket;
  automaticEffect?: SkillCleanupAutomaticEffect;
  presentation: SkillCleanupPresentation;
  sharedMigration?: SharedSkillMigration;
}

export const buildSkillCleanupGroups = (
  skillInventory: SkillInventoryEntry[],
  options: {
    installedTargetIds?: readonly string[];
    preparedTargetsBySkill?: Readonly<
      Record<string, readonly SkillCleanupPreparedTarget[]>
    >;
  } = {}
): SkillCleanupGroup[] => {
  const byKey = new Map<string, SkillInventoryEntry[]>();
  for (const skill of skillInventory) {
    const key = skill.skillKey || skill.id;
    byKey.set(key, [...(byKey.get(key) ?? []), skill]);
  }

  return [...byKey.entries()]
    .map(([skillKey, items]): SkillCleanupGroup => {
      const activeItems = items.filter((item) => item.status !== "kept-outside");
      const hashes = new Set(activeItems.map((item) => item.contentHash).filter(Boolean));
      const statuses = new Set(activeItems.map((item) => item.status));
      const allKeptOutside = activeItems.length === 0;
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
      const hasBlockingExternal = activeItems.some(
        (item) => item.status === "outside" && isObserveOnlySkill(item)
      );
      const hasUnreadable = activeItems.some((item) =>
        item.runtimeIssues?.some((issue) => issue.code === "unreadable-skill")
      );
      const hasBrokenLink = activeItems.some((item) =>
        item.runtimeIssues?.some(
          (issue) =>
            issue.code === "unreadable-skill" &&
            issue.message.startsWith("Skill link target is unavailable")
        )
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
      const sharedPaths = [...new Set(sharedItems.map((item) => item.path))].sort();
      const preparedTargets = new Set(
        (options.preparedTargetsBySkill?.[skillKey] ?? [])
          .filter((preparation) =>
            isSkillCleanupPreparationCurrent(
              preparation,
              sharedLibraryItem?.libraryId,
              sharedPaths
            )
          )
          .map((preparation) => preparation.targetId)
      );
      const pendingConsumers = consumers.filter(
        (targetId) => !preparedTargets.has(targetId)
      );
      const sharedKept =
        sharedItems.length > 0 &&
        sharedItems.every(
          (item) => item.status === "kept-outside" && item.pathPolicy === "keep-shared"
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
              : sharedItems.some(isObserveOnlySkill)
                ? "outside"
                : sharedConflict
                  ? "conflict"
                  : !sharedLibraryItem
                    ? "not-imported"
                    : pendingConsumers.length > 0
                      ? "waiting"
                      : "ready",
            consumers,
            pendingConsumers,
            paths: sharedPaths,
            libraryId: sharedLibraryItem?.libraryId
          };
      const hasLibraryCopy = activeItems.some((item) => Boolean(item.libraryId));

      const state: SkillCleanupGroupState = allKeptOutside
        ? "kept-outside"
        : hasUnreadable
          ? "broken"
          : allManaged && !staleManaged
          ? "managed"
          : libraryConflict || (!allManaged && hashes.size > 1)
              ? "conflict"
              : staleManaged
                ? "stale"
                : activeItems.length > 1
                  ? "duplicate"
                  : statuses.has("outside")
                    ? "outside"
                    : statuses.has("library")
                      ? "library"
                      : "managed";

      const canRemoveBrokenLinks =
        state === "broken" &&
        hasBrokenLink &&
        !hasBlockingExternal &&
        !missingTarget &&
        activeItems.every((item) =>
          item.runtimeIssues?.some((issue) =>
            issue.code === "unreadable-skill" &&
            issue.message.startsWith("Skill link target is unavailable")
          )
        );
      const canImportSharedCopies =
        sharedMigration?.state === "not-imported" &&
        !hasLibraryCopy &&
        !hasBlockingExternal &&
        !hasUnreadable &&
        !missingTarget &&
        hashes.size <= 1;
      const canNormalizeToLibrary =
        Boolean(hasLibraryCopy) &&
        !hasBlockingExternal &&
        !hasUnreadable &&
        !sharedMigration &&
        !missingTarget;
      const canImportStandalone =
        !hasLibraryCopy &&
        !hasBlockingExternal &&
        !hasUnreadable &&
        !sharedMigration &&
        !missingTarget &&
        hashes.size <= 1;
      const sharedCopyWaiting = sharedMigration?.state === "waiting";
      const sharedCopyReplaceable = sharedMigration?.state === "ready";
      const resolution: SkillCleanupResolution =
        state === "kept-outside" || state === "managed"
          ? "resolved"
          : sharedCopyWaiting
            ? "resolved"
            : canRemoveBrokenLinks ||
                canImportSharedCopies ||
                canNormalizeToLibrary ||
                canImportStandalone
              ? "automatic"
              : sharedMigration
                ? "manual"
                : state === "outside" || state === "conflict" || state === "broken" || missingTarget
                  ? "manual"
                  : "automatic";
      const automaticEffect: SkillCleanupAutomaticEffect | undefined =
        resolution !== "automatic"
          ? undefined
          : canRemoveBrokenLinks
            ? "remove-broken-link"
            : canImportSharedCopies
              ? "import-shared"
              : staleManaged
                ? "repair-link"
                : hasLibraryCopy
                  ? libraryConflict || hashes.size > 1
                    ? "archive-and-link"
                    : "link-to-library"
                  : "import-and-link";
      const bucket: SkillCleanupBucket =
        sharedCopyReplaceable
          ? "ready"
          : sharedCopyWaiting
            ? "managed"
            : resolution === "automatic"
              ? "ready"
              : resolution === "manual"
                ? "decision"
                : state === "managed"
                  ? "managed"
                  : "kept";
      const resolutionReason =
        resolution === "resolved"
          ? sharedCopyWaiting
            ? "The Library version is ready, and the shared copy remains active for consumer Agents that have not recorded a Profile decision."
            : state === "kept-outside"
              ? "Intentionally excluded from management."
              : state === "outside"
                ? "Every copy outside AgentEnv matches the Library."
                : "Every detected copy is managed and current."
          : resolution === "automatic"
            ? automaticEffect === "remove-broken-link"
              ? "The unavailable symbolic link can be removed without touching its missing target."
              : automaticEffect === "archive-and-link"
                ? "Library is canonical. Local differences will be backed up before the copies are linked to it."
                : state === "stale"
              ? "Managed copies can be refreshed from Library without choosing content."
              : state === "duplicate"
                ? "All detected copies have identical content."
                : state === "library"
                  ? "The local copy already matches the Library version."
                  : "A single local copy can become the Library version."
            : state === "broken"
              ? "The Skill path is unavailable and must be reviewed before any cleanup action."
              : state === "outside"
                ? "At least one copy is outside AgentEnv and needs a path decision."
                : missingTarget
                  ? "A destination Agent could not be identified."
                  : "Detected copies differ and require a version choice.";

      const presentation: SkillCleanupPresentation = allKeptOutside
        ? sharedKept
          ? { state: "kept-shared", action: "none" }
          : { state: "kept-outside", action: "none" }
        : hasUnreadable
          ? { state: "unavailable", action: "review-details" }
        : hasBlockingExternal
            ? {
                state: "outside-agentenv",
                action: "review-paths"
              }
            : sharedMigration?.state === "ready"
              ? { state: "shared-copy-replaceable", action: "review-replacement" }
              : sharedMigration?.state === "waiting"
                ? { state: "shared-copy-in-use", action: "open-profiles" }
                : sharedMigration?.state === "kept"
                  ? { state: "kept-shared", action: "none" }
                  : sharedMigration?.state === "outside"
                    ? { state: "outside-agentenv", action: "review-paths" }
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
        bucket,
        automaticEffect,
        presentation,
        sharedMigration
      };
    })
    .sort((left, right) => {
      const bucketOrder: Record<SkillCleanupBucket, number> = {
        decision: 0,
        ready: 1,
        managed: 2,
        kept: 3
      };
      return bucketOrder[left.bucket] - bucketOrder[right.bucket] ||
        (left.primary?.name ?? left.skillKey).localeCompare(
          right.primary?.name ?? right.skillKey
        );
    });
};

export const automaticSkillCleanupRequest = (
  group: SkillCleanupGroup
): SkillCleanupRequest | undefined => {
  if (group.resolution !== "automatic") {
    return undefined;
  }
  const isUnavailableLinkCleanup = group.automaticEffect === "remove-broken-link";
  if (isUnavailableLinkCleanup) {
    const brokenLocations = group.activeItems.filter(
      (item) =>
        item.status !== "kept-outside" &&
        (!isObserveOnlySkill(item) || item.externalEvidence?.state === "broken-link") &&
        item.runtimeIssues?.some(
          (issue) =>
            issue.code === "unreadable-skill" &&
            issue.message.startsWith("Skill link target is unavailable")
        )
    );
    if (brokenLocations.length === 0 || brokenLocations.some((item) => !item.foundIn[0])) {
      return undefined;
    }
    return {
      skillKey: group.skillKey,
      libraryId: group.items.find((item) => item.libraryId)?.libraryId ?? group.skillKey,
      canonicalPath: brokenLocations[0].path,
      libraryAction: "keep",
      locations: brokenLocations.map((item) => ({
        targetId: item.foundIn[0],
        path: item.path,
        contentHash: item.contentHash
      }))
    };
  }

  if (group.sharedMigration) {
    const manageableItems = group.activeItems.filter(
      (item) => item.status !== "kept-outside" && !isObserveOnlySkill(item)
    );
    const sharedItems = manageableItems.filter((item) => item.sharedLocation);
    const targetItems = manageableItems.filter((item) => !item.sharedLocation);
    if (
      group.sharedMigration.state !== "not-imported" ||
      sharedItems.length === 0 ||
      targetItems.some((item) => !item.foundIn[0])
    ) {
      return undefined;
    }
    return {
      skillKey: group.skillKey,
      libraryId: group.items.find((item) => item.libraryId)?.libraryId ?? group.skillKey,
      canonicalPath: manageableItems[0].path,
      libraryAction: "create",
      mode: "shared-compatibility",
      sharedLocations: sharedItems.map((item) => ({
        path: item.path,
        contentHash: item.contentHash
      })),
      locations: targetItems.map((item) => ({
        targetId: item.foundIn[0],
        path: item.path,
        contentHash: item.contentHash
      }))
    };
  }

  const locations = group.activeItems.filter(
    (item) =>
      !item.sharedLocation &&
      item.status !== "kept-outside" &&
      !isObserveOnlySkill(item) &&
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
    libraryAction:
      group.items.some((item) => Boolean(item.libraryId))
        ? "keep"
        : "create",
    locations: locations.map((item) => ({
      targetId: item.foundIn[0],
      path: item.path,
      contentHash: item.contentHash
    }))
  };
};
