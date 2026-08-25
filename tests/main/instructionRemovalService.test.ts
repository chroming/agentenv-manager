import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackupStore } from "../../src/main/backupStore";
import { createInstructionLibraryStore } from "../../src/main/instructionLibraryStore";
import { removeInstructionBlockWithReferences } from "../../src/main/instructionRemovalService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-instruction-removal-"));
  const paths = createPaths({ appDataRoot: root, homeDir: join(root, "home") });
  const instructionLibraryStore = createInstructionLibraryStore(paths);
  const profileStore = createProfileStore(paths, undefined, instructionLibraryStore);
  const backupStore = createBackupStore(paths);
  const block = await instructionLibraryStore.create({
    name: "Review rules",
    content: "# Review\nCheck behavior.\n"
  });
  const created = await profileStore.createProfile({ name: "Daily" });
  const profile = await profileStore.saveProfile({
    manifest: created.manifest,
    instructions: created.instructions,
    resources: {
      ...created.resources,
      instructions: [{ libraryId: block.id, enabled: true }]
    },
    expectedContentHash: created.contentHash
  });
  return { backupStore, block, instructionLibraryStore, paths, profile, profileStore };
};

describe("Instruction removal", () => {
  it("backs up the Instruction and removes its Profile references in one operation", async () => {
    const { backupStore, block, instructionLibraryStore, profile, profileStore } = await setup();

    const result = await removeInstructionBlockWithReferences(
      { backupStore, instructionLibraryStore, profileStore },
      { id: block.id, expectedContentHash: block.contentHash }
    );

    expect(result.affectedProfiles).toEqual([{ id: profile.id, name: "Daily" }]);
    await expect(instructionLibraryStore.read(block.id)).rejects.toThrow();
    await expect(profileStore.readProfile(profile.id)).resolves.toMatchObject({
      resources: { instructions: [] }
    });
    await expect(backupStore.readBackup(result.backupId)).resolves.toMatchObject({
      profileName: "Before deleting Instruction Review rules",
      entries: expect.arrayContaining([
        expect.objectContaining({ sourcePath: profile.profileDir })
      ])
    });
  });

  it("restores every affected Profile when deleting the Library copy fails", async () => {
    const { backupStore, block, instructionLibraryStore, profile, profileStore } = await setup();
    const failingStore = {
      read: instructionLibraryStore.read,
      remove: async () => {
        throw new Error("simulated delete failure");
      }
    };

    await expect(removeInstructionBlockWithReferences(
      { backupStore, instructionLibraryStore: failingStore, profileStore },
      { id: block.id, expectedContentHash: block.contentHash }
    )).rejects.toThrow("simulated delete failure");

    await expect(instructionLibraryStore.read(block.id)).resolves.toMatchObject({ id: block.id });
    await expect(profileStore.readProfile(profile.id)).resolves.toMatchObject({
      resources: {
        instructions: [{ libraryId: block.id, enabled: true }]
      }
    });
  });
});
