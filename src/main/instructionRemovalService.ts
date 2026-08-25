import { dirname } from "node:path";
import type {
  InstructionRemovalResult,
  ProfileDetail,
  RemoveInstructionBlockInput
} from "../shared/types";
import { restoreBackupWithSafety, selectBackupEntries } from "./backupRestore";
import type { BackupStore } from "./backupStore";
import { hashPathEntry } from "./filesystemIntegrity";
import type { InstructionLibraryStore } from "./instructionLibraryStore";
import type { ProfileStore } from "./profileStore";

export interface InstructionUsage {
  id: string;
  name: string;
  profile: ProfileDetail;
}

export const collectInstructionUsage = async (
  profileStore: Pick<ProfileStore, "listProfiles" | "readProfile">,
  instructionId?: string
): Promise<InstructionUsage[]> => {
  const usage: InstructionUsage[] = [];
  for (const summary of await profileStore.listProfiles()) {
    if (summary.loadError) continue;
    const profile = await profileStore.readProfile(summary.id);
    if (
      instructionId &&
      !(profile.resources.instructions ?? []).some(
        (reference) => reference.libraryId === instructionId
      )
    ) continue;
    usage.push({ id: profile.id, name: profile.manifest.name, profile });
  }
  return usage;
};

export const removeInstructionBlockWithReferences = async (
  services: {
    backupStore: Pick<BackupStore, "createBackup">;
    instructionLibraryStore: Pick<InstructionLibraryStore, "read" | "remove">;
    profileStore: Pick<ProfileStore, "listProfiles" | "readProfile" | "saveProfile">;
  },
  input: RemoveInstructionBlockInput
): Promise<InstructionRemovalResult> => {
  const block = await services.instructionLibraryStore.read(input.id);
  if (block.contentHash !== input.expectedContentHash) {
    throw new Error(`${block.name} changed since deletion was prepared`);
  }
  const affected = await collectInstructionUsage(services.profileStore, input.id);
  const sourcePaths = [
    dirname(block.path),
    ...affected.flatMap(({ profile }) => profile.profileDir ? [profile.profileDir] : [])
  ];
  const backup = await services.backupStore.createBackup(sourcePaths, {
    profileName: `Before deleting Instruction ${block.name}`
  });
  const mutationHashes = new Map<string, string | undefined>();

  try {
    for (const { profile } of affected) {
      const saved = await services.profileStore.saveProfile({
        manifest: profile.manifest,
        instructions: profile.instructions,
        resources: {
          ...profile.resources,
          instructions: (profile.resources.instructions ?? []).filter(
            (reference) => reference.libraryId !== input.id
          )
        },
        expectedContentHash: profile.contentHash
      });
      if (saved.profileDir) {
        mutationHashes.set(saved.profileDir, await hashPathEntry(saved.profileDir));
      }
    }
    await services.instructionLibraryStore.remove(input);
    mutationHashes.set(dirname(block.path), await hashPathEntry(dirname(block.path)));
  } catch (error) {
    const rollbackBackup = selectBackupEntries(backup, mutationHashes.keys());
    if (rollbackBackup.entries.length === 0) throw error;
    try {
      await restoreBackupWithSafety({
        backup: rollbackBackup,
        backupStore: services.backupStore,
        expectedCurrentHashes: mutationHashes,
        safetyProfileName: `Failed deletion of Instruction ${block.name}`
      });
    } catch (rollbackError) {
      throw new Error(
        `Instruction deletion failed and automatic recovery needs attention. ` +
        `Backup ${backup.id} contains the state from before deletion. ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }`,
        { cause: error }
      );
    }
    throw error;
  }

  return {
    id: block.id,
    affectedProfiles: affected.map(({ id, name }) => ({ id, name })),
    backupId: backup.id
  };
};
