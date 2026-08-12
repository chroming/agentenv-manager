import type { SkillCleanupRequest, SkillInventoryEntry } from "./types";

export type SkillCleanupGroupState =
  | "left-unmanaged"
  | "managed"
  | "stale"
  | "outside"
  | "broken"
  | "conflict"
  | "duplicate"
  | "library";

export type SkillCleanupResolution = "automatic" | "manual" | "resolved";

export type SkillCleanupBucket =
  | "decision"
  | "ready"
  | "managed"
  | "unmanaged";

export type SkillCleanupAutomaticEffect =
  | "import-and-manage"
  | "import-shared"
  | "move-shared-to-agents"
  | "adopt-managed-copy"
  | "migrate-legacy-ownership"
  | "replace-with-managed-copy"
  | "refresh-managed-copy"
  | "remove-broken-link";

export type SkillCleanupDisplayState =
  | "not-in-library"
  | "duplicate-copies"
  | "multiple-versions"
  | "copies-not-managed"
  | "local-changes-found"
  | "managed-copy-changed"
  | "management-upgrade"
  | "outside-agentenv"
  | "shared-left-unmanaged"
  | "unavailable"
  | "managed"
  | "left-unmanaged";

export type SkillCleanupRecommendedAction =
  | "add-to-library"
  | "manage-copies"
  | "review-differences"
  | "review-drift"
  | "review-paths"
  | "review-details"
  | "none";

export interface SkillCleanupPresentation {
  state: SkillCleanupDisplayState;
  action: SkillCleanupRecommendedAction;
}

export type SharedSkillMigrationState =
  | "not-imported"
  | "not-managed"
  | "managed"
  | "unmanaged"
  | "outside"
  | "conflict";

export interface SharedSkillMigration {
  state: SharedSkillMigrationState;
  consumers: string[];
  pendingConsumers: string[];
  paths: string[];
  libraryId?: string;
}

export const sharedSkillMigrationNeedsAction = (
  migration: SharedSkillMigration | undefined
): migration is SharedSkillMigration =>
  Boolean(
    migration && migration.state !== "unmanaged" && migration.state !== "managed"
  );

export interface SkillCleanupPreparedTarget {
  targetId: string;
  libraryId?: string;
  sharedPaths?: readonly string[];
}

const comparablePaths = (paths: readonly string[] = []) =>
  [...new Set(paths.map((path) => path.length > 1 ? path.replace(/[\\/]+$/, "") : path))].sort();

const isObserveOnlySkill = (item: SkillInventoryEntry) =>
  Boolean(item.collectionLink) ||
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

export type SkillManagementScope =
  | { kind: "all" }
  | { kind: "shared" };

export const skillInventoryMatchesManagementScope = (
  item: SkillInventoryEntry,
  scope: SkillManagementScope
): boolean => {
  if (scope.kind === "all") return true;
  return Boolean(item.sharedLocation || item.collectionLink);
};

export const filterSkillInventoryForManagementScope = (
  inventory: SkillInventoryEntry[],
  scope: SkillManagementScope
): SkillInventoryEntry[] =>
  inventory.filter((item) => skillInventoryMatchesManagementScope(item, scope));

export type SkillCollectionLinkState =
  | "needs-library"
  | "conflict"
  | "ready"
  | "unmanaged";

export interface SkillCollectionLinkGroup {
  path: string;
  canonicalPath: string;
  name: string;
  items: SkillInventoryEntry[];
  consumerTargetIds: string[];
  state: SkillCollectionLinkState;
  libraryReadyCount: number;
  conflictCount: number;
}

const collectionName = (path: string) =>
  path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export const isSkillCollectionItemLibraryReady = (
  item: SkillInventoryEntry
): boolean =>
  Boolean(item.libraryId) &&
  (
    item.contentMatchesLibrary === true ||
    item.collectionDecision === "use-library"
  );

export const buildSkillCollectionLinkGroups = (
  skillInventory: SkillInventoryEntry[],
  options: { installedTargetIds?: readonly string[] } = {}
): SkillCollectionLinkGroup[] => {
  const installedTargetIds = options.installedTargetIds
    ? new Set(options.installedTargetIds)
    : undefined;
  const byPath = new Map<string, SkillInventoryEntry[]>();
  for (const item of skillInventory) {
    if (!item.collectionLink) continue;
    byPath.set(item.collectionLink.path, [
      ...(byPath.get(item.collectionLink.path) ?? []),
      item
    ]);
  }

  return [...byPath.entries()]
    .map(([path, items]) => {
      const uniqueItems = [...new Map(
        items.map((item) => [`${item.skillKey}\0${item.path}`, item])
      ).values()].sort((left, right) => left.name.localeCompare(right.name));
      const libraryReadyCount = uniqueItems.filter(
        isSkillCollectionItemLibraryReady
      ).length;
      const conflictCount = uniqueItems.filter(
        (item) =>
          Boolean(item.libraryId) &&
          item.contentMatchesLibrary === false &&
          item.collectionDecision !== "use-library"
      ).length;
      const unmanaged = uniqueItems.length > 0 && uniqueItems.every(
        (item) =>
          item.status === "left-unmanaged" &&
          item.unmanagedCoverage === "collection"
      );
      return {
        path,
        canonicalPath: uniqueItems[0].collectionLink?.canonicalPath ?? path,
        name: collectionName(path),
        items: uniqueItems,
        consumerTargetIds: [...new Set(uniqueItems.flatMap((item) => item.foundIn))]
          .filter((targetId) => !installedTargetIds || installedTargetIds.has(targetId))
          .sort(),
        state: unmanaged
          ? "unmanaged" as const
          : conflictCount > 0
            ? "conflict" as const
            : libraryReadyCount === uniqueItems.length
              ? "ready" as const
              : "needs-library" as const,
        libraryReadyCount,
        conflictCount
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

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
    if (skill.collectionLink) continue;
    const key = skill.skillKey || skill.id;
    byKey.set(key, [...(byKey.get(key) ?? []), skill]);
  }

  return [...byKey.entries()]
    .map(([skillKey, items]): SkillCleanupGroup => {
      const activeItems = items.filter(
        (item) => item.status !== "left-unmanaged"
      );
      const physicalItems = [
        ...new Map(
          activeItems.map((item) => [item.canonicalPath ?? item.path, item])
        ).values()
      ];
      const hashes = new Set(activeItems.map((item) => item.contentHash).filter(Boolean));
      const statuses = new Set(activeItems.map((item) => item.status));
      const allLeftUnmanaged = activeItems.length === 0;
      const allManaged =
        activeItems.length > 0 && activeItems.every((item) => item.status === "managed");
      const hasLegacyOwnershipMarkers = activeItems.some(
        (item) => (item.legacyOwnershipMarkerPaths?.length ?? 0) > 0
      );
      const legacyOwnershipMigrationReady =
        hasLegacyOwnershipMarkers &&
        activeItems
          .filter((item) => (item.legacyOwnershipMarkerPaths?.length ?? 0) > 0)
          .every((item) => item.legacyOwnershipMigrationReady === true);
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
      const brokenLinkItems = activeItems.filter((item) =>
        item.runtimeIssues?.some(
          (issue) =>
            issue.code === "unreadable-skill" &&
            issue.message.startsWith("Skill link target is unavailable")
        )
      );
      const removableBrokenLinkItems = brokenLinkItems.filter(
        (item) =>
          !isObserveOnlySkill(item) ||
          item.externalEvidence?.state === "broken-link"
      );
      const hasOtherUnreadable = activeItems.some((item) =>
        item.runtimeIssues?.some(
          (issue) =>
            issue.code === "unreadable-skill" &&
            !issue.message.startsWith("Skill link target is unavailable")
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
      const sharedLeftUnmanaged =
        sharedItems.length > 0 &&
        sharedItems.every(
          (item) =>
            item.status === "left-unmanaged" &&
            item.unmanagedCoverage === "exact"
        );
      const sharedConflict =
        sharedItems.some(
          (item) => item.libraryId && item.contentMatchesLibrary === false
        ) || hashes.size > 1;
      const sharedManaged =
        sharedItems.length > 0 &&
        sharedItems.every(
          (item) => item.managedAsShared && item.contentMatchesLibrary === true
        );
      const sharedMigration: SharedSkillMigration | undefined = sharedItems.length === 0
        ? undefined
        : {
            state: sharedLeftUnmanaged
              ? "unmanaged"
              : sharedItems.some(isObserveOnlySkill)
                ? "outside"
                : sharedConflict
                  ? "conflict"
                  : sharedManaged
                    ? "managed"
                  : !sharedLibraryItem
                    ? "not-imported"
                    : "not-managed",
            consumers,
            pendingConsumers: consumers,
            paths: sharedPaths,
            libraryId: sharedLibraryItem?.libraryId
          };
      const hasLibraryCopy = activeItems.some((item) => Boolean(item.libraryId));

      const state: SkillCleanupGroupState = allLeftUnmanaged
        ? "left-unmanaged"
        : hasUnreadable
          ? "broken"
          : allManaged && !staleManaged
          ? "managed"
          : libraryConflict || (!allManaged && hashes.size > 1)
              ? "conflict"
              : staleManaged
                ? "stale"
                : physicalItems.length > 1
                  ? "duplicate"
                  : statuses.has("outside")
                    ? "outside"
                    : statuses.has("library")
                      ? "library"
                      : "managed";

      const canRemoveBrokenLinks =
        state === "broken" &&
        hasBrokenLink &&
        !hasOtherUnreadable &&
        removableBrokenLinkItems.length === brokenLinkItems.length &&
        removableBrokenLinkItems.every((item) => Boolean(item.foundIn[0]));
      const canManageSharedCopies =
        (sharedMigration?.state === "not-imported" ||
          sharedMigration?.state === "not-managed") &&
        !hasBlockingExternal &&
        !hasUnreadable &&
        !missingTarget &&
        hashes.size <= 1;
      const canNormalizeToLibrary =
        Boolean(hasLibraryCopy) &&
        !libraryConflict &&
        !staleManaged &&
        hashes.size <= 1 &&
        !hasBlockingExternal &&
        !hasUnreadable &&
        !sharedSkillMigrationNeedsAction(sharedMigration) &&
        !missingTarget;
      const canImportStandalone =
        !hasLibraryCopy &&
        !hasBlockingExternal &&
        !hasUnreadable &&
        !sharedSkillMigrationNeedsAction(sharedMigration) &&
        !missingTarget &&
        hashes.size <= 1;
      const sharedMigrationNeedsAction = sharedSkillMigrationNeedsAction(
        sharedMigration
      );
      const resolution: SkillCleanupResolution =
        canManageSharedCopies
          ? "automatic"
          : legacyOwnershipMigrationReady && canNormalizeToLibrary
            ? "automatic"
            : hasLegacyOwnershipMarkers
              ? "manual"
              : state === "left-unmanaged" || state === "managed"
                ? "resolved"
                : canRemoveBrokenLinks ||
                    canManageSharedCopies ||
                    canNormalizeToLibrary ||
                    canImportStandalone
                  ? "automatic"
                  : sharedMigrationNeedsAction
                  ? "manual"
                  : state === "outside" || state === "conflict" || state === "stale" || state === "broken" || missingTarget
                    ? "manual"
                    : "automatic";
      const automaticEffect: SkillCleanupAutomaticEffect | undefined =
        resolution !== "automatic"
          ? undefined
          : canManageSharedCopies
            ? "import-shared"
            : legacyOwnershipMigrationReady && hasLibraryCopy
              ? "migrate-legacy-ownership"
            : canRemoveBrokenLinks
            ? "remove-broken-link"
            : staleManaged
                ? "refresh-managed-copy"
                : hasLibraryCopy
                  ? libraryConflict || hashes.size > 1
                    ? "replace-with-managed-copy"
                    : "adopt-managed-copy"
                  : "import-and-manage";
      const bucket: SkillCleanupBucket =
        resolution === "automatic"
              ? "ready"
              : resolution === "manual"
                ? "decision"
                : state === "managed"
                  ? "managed"
                  : "unmanaged";
      const resolutionReason =
        sharedManaged
          ? "The shared copy is managed from Library and remains available to every Agent that reads this directory."
          : canManageSharedCopies
            ? "AgentEnv can add the shared copy to Library and manage it without moving the shared path or changing Profiles."
          : hasLegacyOwnershipMarkers && resolution === "automatic"
            ? "AgentEnv can move legacy ownership records into private Target state and remove marker files without changing Skill content or deployment topology."
          : resolution === "resolved"
            ? state === "left-unmanaged"
              ? "AgentEnv will observe this location but will not change it."
              : state === "outside"
                ? "Every copy outside AgentEnv matches the Library."
                : "Every detected copy is managed and current."
            : resolution === "automatic"
              ? automaticEffect === "remove-broken-link"
                ? "The unavailable symbolic link can be removed without touching its missing target."
                : automaticEffect === "replace-with-managed-copy"
                  ? "The managed version is canonical. Local differences will be backed up before copies are replaced."
                  : state === "stale"
                    ? "Managed copies can be refreshed without choosing content."
                    : state === "duplicate"
                      ? "All detected copies have identical content."
                      : state === "library"
                        ? "The local copy already matches the Library version."
                        : "A single local copy can become the managed version."
              : state === "broken"
                ? "The Skill path is unavailable and must be reviewed before any cleanup action."
                : state === "outside"
                  ? "At least one copy is outside AgentEnv and needs a path decision."
                  : state === "stale"
                    ? "A managed copy changed locally and needs an explicit version decision."
                  : missingTarget
                    ? "A destination Agent could not be identified."
                    : "Detected copies differ and require a version choice.";

      const presentation: SkillCleanupPresentation = allLeftUnmanaged
        ? sharedLeftUnmanaged
          ? { state: "shared-left-unmanaged", action: "none" }
          : { state: "left-unmanaged", action: "none" }
        : hasUnreadable
          ? { state: "unavailable", action: "review-details" }
        : hasBlockingExternal
            ? {
                state: "outside-agentenv",
                action: "review-paths"
              }
            : sharedMigration?.state === "managed"
              ? { state: "managed", action: "none" }
              : sharedMigration?.state === "not-managed"
                ? { state: "copies-not-managed", action: "manage-copies" }
              : sharedMigration?.state === "outside"
                    ? { state: "outside-agentenv", action: "review-paths" }
                    : sharedMigrationNeedsAction
                      ? hasLibraryCopy
                        ? { state: "local-changes-found", action: "review-differences" }
                        : hashes.size > 1
                          ? { state: "multiple-versions", action: "add-to-library" }
                          : physicalItems.length > 1
                            ? { state: "duplicate-copies", action: "add-to-library" }
                            : { state: "not-in-library", action: "add-to-library" }
                      : !hasLibraryCopy
                        ? hashes.size > 1
                          ? { state: "multiple-versions", action: "add-to-library" }
                          : physicalItems.length > 1
                            ? { state: "duplicate-copies", action: "add-to-library" }
                            : { state: "not-in-library", action: "add-to-library" }
                        : staleManaged
                          ? { state: "managed-copy-changed", action: "review-drift" }
                          : legacyOwnershipMigrationReady
                            ? { state: "management-upgrade", action: "manage-copies" }
                          : hasLegacyOwnershipMarkers
                            ? { state: "outside-agentenv", action: "review-paths" }
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
        unmanaged: 3
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
        item.status !== "left-unmanaged" &&
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

  const sharedMigration = group.sharedMigration;
  if (sharedSkillMigrationNeedsAction(sharedMigration)) {
    const manageableItems = group.activeItems.filter(
      (item) =>
        item.status !== "left-unmanaged" && !isObserveOnlySkill(item)
    );
    const sharedItems = manageableItems.filter((item) => item.sharedLocation);
    const targetItems = manageableItems.filter((item) => !item.sharedLocation);
    if (
      (sharedMigration.state !== "not-imported" &&
        sharedMigration.state !== "not-managed") ||
      sharedItems.length === 0 ||
      targetItems.some((item) => !item.foundIn[0])
    ) {
      return undefined;
    }
    return {
      skillKey: group.skillKey,
      libraryId: group.items.find((item) => item.libraryId)?.libraryId ?? group.skillKey,
      canonicalPath: manageableItems[0].path,
      libraryAction: sharedMigration.state === "not-imported" ? "create" : "keep",
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
      item.status !== "left-unmanaged" &&
      !isObserveOnlySkill(item) &&
      (
        item.status !== "managed" ||
        item.contentMatchesLibrary === false ||
        (item.legacyOwnershipMarkerPaths?.length ?? 0) > 0
      )
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
