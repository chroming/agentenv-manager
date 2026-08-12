import type {
  RetireSharedSkillInput,
  SkillCleanupResult,
  TargetManagementState
} from "../shared/types";
import type { SkillCollectionLinkGroup } from "../shared/skillCleanup";
import {
  runSkillCollectionMigration,
  type MoveSkillCollectionOptions
} from "./skillCollectionMigrationAction";
import { moveSharedSkillToAgents } from "./sharedSkillMigration";

interface SharedSkillMigrationActionOptions {
  targetStates: TargetManagementState[];
  dirtyProfileId?: string;
  targetNames: Record<string, string>;
  setBusy(value: boolean): void;
  setError(value?: string): void;
  setResult(value: SkillCleanupResult): void;
  setSuccess(message: string): void;
  refresh(): Promise<void>;
  saveDirtyProfile(): Promise<void>;
}

export const createSharedSkillMigrationActions = ({
  targetStates,
  dirtyProfileId,
  targetNames,
  setBusy,
  setError,
  setResult,
  setSuccess,
  refresh,
  saveDirtyProfile
}: SharedSkillMigrationActionOptions) => {
  const retireSharedSkill = async (input: RetireSharedSkillInput) => {
    setError(undefined);
    try {
      const result = await window.agentEnv.retireSharedSkill(input);
      setResult(result);
      await refresh();
      setSuccess(`Completed shared migration for ${input.skillKey}`);
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  };

  const moveSharedSkillToAgentDirectories = async (
    input: RetireSharedSkillInput,
    targetIds: string[],
    options?: { blockedSkillKeys?: string[] }
  ) => {
    const activeProfileIds = new Set(
      targetStates
        .filter((state) => targetIds.includes(state.targetId))
        .map((state) => state.activeProfileId)
        .filter((id): id is string => Boolean(id))
    );
    if (dirtyProfileId && activeProfileIds.has(dirtyProfileId)) {
      setError("Save or discard the open Profile changes before moving this shared Skill.");
      return false;
    }

    setError(undefined);
    setBusy(true);
    try {
      const result = await moveSharedSkillToAgents({
        api: window.agentEnv,
        migration: input,
        targetIds,
        targetNames,
        blockedSkillNames: options?.blockedSkillKeys
      });
      setResult(result);
      await refresh();
      setSuccess(`Moved ${input.skillKey} to ${targetIds.length} ${
        targetIds.length === 1 ? "Agent" : "Agents"
      }`);
      return true;
    } catch (unknownError) {
      await refresh().catch(() => undefined);
      throw unknownError;
    } finally {
      setBusy(false);
    }
  };

  const moveSkillCollectionToAgentDirectories = (
    collection: SkillCollectionLinkGroup,
    options?: MoveSkillCollectionOptions
  ) => runSkillCollectionMigration({
    api: window.agentEnv,
    collection,
    targetStates,
    dirtyProfileId,
    saveDirtyProfile,
    targetNames,
    setBusy,
    setResult,
    setSuccess,
    refresh
  }, options);

  return {
    retireSharedSkill,
    moveSharedSkillToAgentDirectories,
    moveSkillCollectionToAgentDirectories
  };
};
