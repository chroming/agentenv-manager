import type { InstructionLibraryStore } from "../instructionLibraryStore";
import type { ProfileStore } from "../profileStore";
import type {
  CreateInstructionBlockInput,
  RemoveInstructionBlockInput,
  UpdateInstructionBlockInput
} from "../../shared/types";
import type { IpcRegistrationHandles } from "./registration";

export const registerInstructionIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  services: {
    instructionLibraryStore: InstructionLibraryStore;
    profileStore: ProfileStore;
  }
) => {
  const { diagnosticHandle, handleMutation } = handles;
  const { instructionLibraryStore, profileStore } = services;

  const usage = async () => {
    const result = new Map<string, string[]>();
    for (const summary of await profileStore.listProfiles()) {
      if (summary.loadError) continue;
      const profile = await profileStore.readProfile(summary.id);
      for (const reference of profile.resources.instructions ?? []) {
        result.set(reference.libraryId, [...(result.get(reference.libraryId) ?? []), summary.name]);
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
  handleMutation("instructions:remove", async (_event, input: RemoveInstructionBlockInput) => {
    const profileNames = (await usage()).get(input.id) ?? [];
    if (profileNames.length > 0) {
      throw new Error(
        `Instruction Block is used by ${profileNames.length} Profile${profileNames.length === 1 ? "" : "s"}: ${profileNames.join(", ")}`
      );
    }
    await instructionLibraryStore.remove(input);
  });
};
