import {
  isSkillCollectionItemLibraryReady,
  type SkillCollectionLinkGroup
} from "../shared/skillCleanup";
import type {
  AgentEnvApi,
  SkillCleanupResult,
  TargetManagementState
} from "../shared/types";
import { moveSkillCollectionToAgents } from "./sharedSkillMigration";

interface MoveSkillCollectionActionInput {
  api: AgentEnvApi;
  collection: SkillCollectionLinkGroup;
  targetStates: TargetManagementState[];
  dirtyProfileId?: string;
  targetNames?: Record<string, string>;
  setBusy(busy: boolean): void;
  setError(error?: string): void;
  setResult(result: SkillCleanupResult): void;
  setSuccess(message: string): void;
  refresh(): Promise<void>;
}

export const runSkillCollectionMigration = async ({
  api,
  collection,
  targetStates,
  dirtyProfileId,
  targetNames,
  setBusy,
  setError,
  setResult,
  setSuccess,
  refresh
}: MoveSkillCollectionActionInput): Promise<boolean> => {
  const activeProfileIds = new Set(
    targetStates
      .filter((state) => collection.consumerTargetIds.includes(state.targetId))
      .map((state) => state.activeProfileId)
      .filter((id): id is string => Boolean(id))
  );
  if (dirtyProfileId && activeProfileIds.has(dirtyProfileId)) {
    setError("Save or discard the open Profile changes before moving this Skill collection.");
    return false;
  }
  if (
    collection.items.some(
      (item) => !isSkillCollectionItemLibraryReady(item)
    )
  ) {
    setError("Choose a Library version for every Skill in this collection first.");
    return false;
  }

  setError(undefined);
  setBusy(true);
  try {
    const result = await moveSkillCollectionToAgents({
      api,
      collection: {
        path: collection.path,
        members: collection.items.map((item) => ({
          skillKey: item.skillKey,
          libraryId: item.libraryId as string,
          consumerTargetIds: item.foundIn.filter((targetId) =>
            collection.consumerTargetIds.includes(targetId)
          )
        }))
      },
      targetNames
    });
    setResult(result);
    await refresh();
    setSuccess(`Moved ${collection.name} out of the shared Skills folder`);
    return true;
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    await refresh().catch(() => undefined);
    return false;
  } finally {
    setBusy(false);
  }
};
