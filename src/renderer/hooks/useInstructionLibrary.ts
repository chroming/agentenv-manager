import { useCallback, useRef, useState } from "react";
import type {
  CreateInstructionBlockInput,
  InstructionBlock,
  UpdateInstructionBlockInput
} from "../../shared/types";
import { refreshInBackground } from "../backgroundRefresh";

export const useInstructionLibrary = (onMutated: () => Promise<void>, onRefreshError?: (error: unknown) => void) => {
  const [blocks, setBlocks] = useState<InstructionBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);

  const refresh = useCallback(async (showProgress = true) => {
    const request = ++revision.current;
    setLoading(showProgress);
    try {
      const next = await window.agentEnv.listInstructionBlocks();
      if (request === revision.current) setBlocks(next);
      return next;
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, []);

  const finishMutation = (accept: (current: InstructionBlock[]) => InstructionBlock[]) => {
    revision.current++;
    setBlocks(accept);
    refreshInBackground(() => refresh(false), onRefreshError);
    refreshInBackground(onMutated, onRefreshError);
  };
  const acceptSaved = (block: InstructionBlock) => finishMutation((current) =>
    current.some((item) => item.id === block.id) ? current.map((item) =>
      item.id === block.id ? { ...block, usedByProfiles: item.usedByProfiles } : item) : [block, ...current]);

  return {
    blocks,
    loading,
    refresh,
    create: async (input: CreateInstructionBlockInput) => {
      acceptSaved(await window.agentEnv.createInstructionBlock(input));
    },
    update: async (block: InstructionBlock, input: CreateInstructionBlockInput) => {
      acceptSaved(await window.agentEnv.updateInstructionBlock({
        ...input,
        id: block.id,
        expectedContentHash: block.contentHash
      } satisfies UpdateInstructionBlockInput));
    },
    remove: async (block: InstructionBlock) => {
      await window.agentEnv.removeInstructionBlock({
        id: block.id,
        expectedContentHash: block.contentHash
      });
      finishMutation((current) => current.filter((item) => item.id !== block.id));
    }
  };
};
