import { useCallback } from "react";
import type {
  SharedSkillRetentionInput,
  SkillCollectionMemberDecisionUpdate,
  SkillInventoryEntry,
  UnmanagedSkillLocationUpdate
} from "../../shared/types";
import type { SkillUpdateCheckStatus as RendererSkillUpdateCheckStatus } from "../skillLibraryContracts";

type SetInventory = (
  update: (current: SkillInventoryEntry[]) => SkillInventoryEntry[]
) => void;

interface SkillCleanupBoundaryOptions {
  skillInventory: SkillInventoryEntry[];
  setSkillInventory: SetInventory;
  setBusy(value: boolean): void;
  setError(value: string | undefined): void;
  setProfileSaveStatus(value: string): void;
  setSkillUpdateCheckStatus(
    value: RendererSkillUpdateCheckStatus | undefined
  ): void;
}

const normalizeBoundaryPath = (value: string) =>
  value.replaceAll("\\", "/").replace(/\/+$/, "");

export const projectSkillInventoryBoundary = (
  current: SkillInventoryEntry[],
  input: UnmanagedSkillLocationUpdate
) => current.map((item) => {
  const matchingItem = input.items.find((boundary) => {
    const boundaryPath = normalizeBoundaryPath(boundary.path);
    const itemPath = normalizeBoundaryPath(item.path);
    const collectionPath = item.collectionLink?.path
      ? normalizeBoundaryPath(item.collectionLink.path)
      : undefined;
    const pathMatches = itemPath === boundaryPath ||
      (boundary.coverage === "collection" && collectionPath === boundaryPath);
    return pathMatches && (!boundary.targetId || item.foundIn.includes(boundary.targetId));
  });
  if (!matchingItem) return item;
  if (input.unmanaged) {
    return {
      ...item,
      status: "left-unmanaged" as const,
      unmanagedCoverage: matchingItem.coverage ?? "exact",
      unmanagedLocationId: item.unmanagedLocationId
    };
  }
  return {
    ...item,
    status: (item.libraryId && item.contentMatchesLibrary === true
      ? "library"
      : "outside") as SkillInventoryEntry["status"],
    unmanagedCoverage: undefined,
    unmanagedLocationId: undefined
  };
});

export const useSkillCleanupBoundaries = ({
  skillInventory,
  setSkillInventory,
  setBusy,
  setError,
  setProfileSaveStatus,
  setSkillUpdateCheckStatus
}: SkillCleanupBoundaryOptions) => {
  const setUnmanagedSkillLocations = useCallback(async (input: UnmanagedSkillLocationUpdate) => {
    setError(undefined);
    try {
      await window.agentEnv.setUnmanagedSkillLocations(input);
      setSkillInventory((current) => projectSkillInventoryBoundary(current, input));
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  }, [setError, setSkillInventory]);

  const setSkillCollectionDecision = useCallback(async (
    input: SkillCollectionMemberDecisionUpdate
  ) => {
    setError(undefined);
    try {
      await window.agentEnv.setSkillCollectionDecision(input);
      setSkillInventory((current) => current.map((item) =>
        normalizeBoundaryPath(item.path) === normalizeBoundaryPath(input.path)
          ? {
              ...item,
              collectionDecision: input.useLibrary ? "use-library" : undefined
            }
          : item
      ));
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  }, [setError, setSkillInventory]);

  const setGroupBoundary = useCallback(async (skillKey: string, unmanaged: boolean) => {
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateCheckStatus({
      state: "checking",
      message: unmanaged
        ? `Leaving ${skillKey} unmanaged...`
        : `Reviewing ${skillKey} again...`
    });
    try {
      const boundaryUpdate: UnmanagedSkillLocationUpdate = {
        items: skillInventory
          .filter((item) =>
            item.skillKey === skillKey &&
            (unmanaged
              ? item.status !== "managed" && item.status !== "left-unmanaged"
              : item.status === "left-unmanaged")
          )
          .flatMap((item) =>
            item.foundIn.length > 0
              ? item.foundIn.map((targetId) => ({
                  path: item.path,
                  targetId: item.sharedLocation ? undefined : targetId,
                  coverage: "exact" as const
                }))
              : [{ path: item.path, coverage: "exact" as const }]
          ),
        unmanaged
      };
      await window.agentEnv.setUnmanagedSkillLocations(boundaryUpdate);
      setSkillInventory((current) => projectSkillInventoryBoundary(current, boundaryUpdate));
      setSkillUpdateCheckStatus({
        state: "success",
        message: unmanaged
          ? `${skillKey} is left unmanaged on this device`
          : `${skillKey} is back in review`
      });
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus({
        state: "error",
        message: unmanaged
          ? "Could not save local management boundary"
          : "Could not clear local management boundary"
      });
    } finally {
      setBusy(false);
    }
  }, [
    setBusy,
    setError,
    setProfileSaveStatus,
    setSkillInventory,
    setSkillUpdateCheckStatus,
    skillInventory
  ]);

  const setSharedSkillRetention = useCallback(async (input: SharedSkillRetentionInput) => {
    setError(undefined);
    try {
      await window.agentEnv.setSharedSkillRetention(input);
      setSkillInventory((current) => projectSkillInventoryBoundary(current, {
        items: input.paths.map((path) => ({ path, coverage: "exact" as const })),
        unmanaged: input.retained
      }));
      setSkillUpdateCheckStatus({
        state: "success",
        message: input.retained
          ? `${input.skillKey} will remain in the shared compatibility directory`
          : `${input.skillKey} is back in migration review`
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  }, [setError, setSkillInventory, setSkillUpdateCheckStatus]);

  return {
    setUnmanagedSkillLocations,
    setSkillCollectionDecision,
    leaveSkillGroupUnmanaged: (skillKey: string) => setGroupBoundary(skillKey, true),
    manageSkillGroupWithAgentEnv: (skillKey: string) => setGroupBoundary(skillKey, false),
    setSharedSkillRetention
  };
};
