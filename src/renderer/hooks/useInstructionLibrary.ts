import { useCallback, useState } from "react";
import type {
  CreateInstructionBlockInput,
  InstructionBlock,
  UpdateInstructionBlockInput
} from "../../shared/types";

export const useInstructionLibrary = (onMutated: () => Promise<void>) => {
  const [blocks, setBlocks] = useState<InstructionBlock[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.agentEnv.listInstructionBlocks();
      setBlocks(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  const finishMutation = async () => {
    await Promise.all([refresh(), onMutated()]);
  };

  return {
    blocks,
    loading,
    refresh,
    create: async (input: CreateInstructionBlockInput) => {
      await window.agentEnv.createInstructionBlock(input);
      await finishMutation();
    },
    update: async (block: InstructionBlock, input: CreateInstructionBlockInput) => {
      await window.agentEnv.updateInstructionBlock({
        ...input,
        id: block.id,
        expectedContentHash: block.contentHash
      } satisfies UpdateInstructionBlockInput);
      await finishMutation();
    },
    remove: async (block: InstructionBlock) => {
      await window.agentEnv.removeInstructionBlock({
        id: block.id,
        expectedContentHash: block.contentHash
      });
      await finishMutation();
    }
  };
};
