import type { InstructionLibraryStore } from "../instructionLibraryStore";
import type { ProfileStore } from "../profileStore";
import type { BackupStore } from "../backupStore";
import {
  collectInstructionUsage,
  removeInstructionBlockWithReferences
} from "../instructionRemovalService";
import type {
  CreateInstructionBlockInput,
  RemoveInstructionBlockInput,
  UpdateInstructionBlockInput
} from "../../shared/types";
import type { IpcRegistrationHandles } from "./registration";

export const registerInstructionIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  services: {
    backupStore: BackupStore;
    instructionLibraryStore: InstructionLibraryStore;
    profileStore: ProfileStore;
  }
) => {
  const { diagnosticHandle, handleMutation } = handles;
  const { backupStore, instructionLibraryStore, profileStore } = services;

  const usage = async () => {
    const result = new Map<string, string[]>();
    for (const { name, profile } of await collectInstructionUsage(profileStore)) {
      for (const reference of profile.resources.instructions ?? []) {
        result.set(reference.libraryId, [...(result.get(reference.libraryId) ?? []), name]);
      }
    }
    return result;
  };

  diagnosticHandle("instructions:list", async () => {
    const [blocks, usedBy] = await Promise.all([instructionLibraryStore.list(), usage()]);
    return blocks.map((block) => ({ ...block, usedByProfiles: usedBy.get(block.id) ?? [] }));
  });
  handleMutation("instructions:create", (_event, input: CreateInstructionBlockInput) =>
    instructionLibraryStore.create(input)
  );
  handleMutation("instructions:update", (_event, input: UpdateInstructionBlockInput) =>
    instructionLibraryStore.update(input)
  );
  handleMutation("instructions:remove", (_event, input: RemoveInstructionBlockInput) =>
    removeInstructionBlockWithReferences(
      { backupStore, instructionLibraryStore, profileStore },
      input
    )
  );
};
