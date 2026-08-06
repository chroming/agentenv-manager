import {
  isSkillCollectionItemLibraryReady,
  type SkillCollectionLinkGroup
} from "../shared/skillCleanup";
import type {
  AgentEnvApi,
  SkillCleanupResult,
  TargetManagementState
} from "../shared/types";
import { parseDiagnosticErrorMessage } from "./diagnostics";
import { moveSkillCollectionToAgents } from "./sharedSkillMigration";

interface MoveSkillCollectionActionInput {
  api: AgentEnvApi;
  collection: SkillCollectionLinkGroup;
  targetStates: TargetManagementState[];
  dirtyProfileId?: string;
  saveDirtyProfile?(): Promise<void>;
  targetNames?: Record<string, string>;
  setBusy(busy: boolean): void;
  setResult(result: SkillCleanupResult): void;
  setSuccess(message: string): void;
  refresh(): Promise<void>;
}

export interface MoveSkillCollectionOptions {
  saveDirtyProfile?: boolean;
}

export type MoveSkillCollectionOutcome =
  | { status: "moved" }
  | { status: "needs-save"; message: string }
  | { status: "blocked"; message: string };

export const runSkillCollectionMigration = async ({
  api,
  collection,
  targetStates,
  dirtyProfileId,
  saveDirtyProfile,
  targetNames,
  setBusy,
  setResult,
  setSuccess,
  refresh
}: MoveSkillCollectionActionInput, options: MoveSkillCollectionOptions = {}): Promise<MoveSkillCollectionOutcome> => {
  const activeProfileIds = new Set(
    targetStates
      .filter((state) => collection.consumerTargetIds.includes(state.targetId))
      .map((state) => state.activeProfileId)
      .filter((id): id is string => Boolean(id))
  );
  if (dirtyProfileId && activeProfileIds.has(dirtyProfileId)) {
    if (!options.saveDirtyProfile || !saveDirtyProfile) {
      return {
        status: "needs-save",
        message: "The active Profile has unsaved edits. Save it before moving this collection."
      };
    }
    try {
      await saveDirtyProfile();
    } catch (error) {
      const parsed = parseDiagnosticErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
      return {
        status: "blocked",
        message: parsed.message
      };
    }
  }
  if (
    collection.items.some(
      (item) => !isSkillCollectionItemLibraryReady(item)
    )
  ) {
    return {
      status: "blocked",
      message: "Choose a Library version for every Skill in this collection first."
    };
  }

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
    return { status: "moved" };
  } catch (error) {
    await refresh().catch(() => undefined);
    const parsed = parseDiagnosticErrorMessage(
      error instanceof Error ? error.message : String(error)
    );
    return {
      status: "blocked",
      message: parsed.message
    };
  } finally {
    setBusy(false);
  }
};
