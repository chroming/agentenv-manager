import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInstructionLibraryStore } from "../../src/main/instructionLibraryStore";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-instructions-"));
  const paths = createPaths({ appDataRoot: root, homeDir: join(root, "home") });
  return { paths, store: createInstructionLibraryStore(paths) };
};

describe("Instruction Library", () => {
  it("creates, updates, and resolves Blocks without mutating stale data", async () => {
    const { paths, store } = await setup();
    const created = await store.create({
      name: "Review rules",
      description: "Reusable review guidance",
      iconKey: "book",
      content: "# Review\nCheck behavior.\n"
    });

    expect(await store.read(created.id)).toMatchObject({
      name: "Review rules",
      iconKey: "book",
      content: "# Review\nCheck behavior.\n"
    });

    const updated = await store.update({
      id: created.id,
      expectedContentHash: created.contentHash,
      name: "Review rules",
      description: "Reusable review guidance",
      iconKey: "pen",
      content: "# Review\nCheck behavior and tests.\n"
    });
    await expect(store.update({
      id: created.id,
      expectedContentHash: created.contentHash,
      name: "Stale edit",
      content: "stale"
    })).rejects.toThrow("changed since it was opened");
    expect((await store.list())[0]?.contentHash).toBe(updated.contentHash);
    await expect(readFile(
      join(paths.instructionsLibraryDir, created.id, "instruction.json"),
      "utf8"
    ).then(JSON.parse)).resolves.toMatchObject({ iconKey: "pen" });
  });

  it("moves deleted Blocks to recoverable Trash", async () => {
    const { paths, store } = await setup();
    const block = await store.create({ name: "Temporary", content: "Temporary guidance\n" });

    await store.remove({ id: block.id, expectedContentHash: block.contentHash });

    await expect(store.read(block.id)).rejects.toThrow();
    const trashRoot = join(paths.appDataRoot, "trash", "instructions");
    const { readdir } = await import("node:fs/promises");
    const [trashEntry] = await readdir(trashRoot);
    await expect(readFile(join(trashRoot, trashEntry!, "CONTENT.md"), "utf8"))
      .resolves.toBe("Temporary guidance\n");
  });

  it("moves Profile-specific content into a final ordered Library Block", async () => {
    const { paths, store } = await setup();
    const first = await store.create({ name: "First", content: "# First\n\nDo A.\n" });
    const second = await store.create({ name: "Second", content: "# Second\nDo B.\n" });
    const profileStore = createProfileStore(paths, undefined, store);
    const profile = await profileStore.createProfile({ name: "Daily" });

    const saved = await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: "# Local\nDo C.\n",
      resources: {
        ...profile.resources,
        instructions: [
          { libraryId: second.id, enabled: true },
          { libraryId: first.id, enabled: false }
        ]
      },
      expectedContentHash: profile.contentHash
    });

    expect(saved.instructions).toBe("");
    expect(saved.resolvedInstructions).toBe("# Second\nDo B.\n\n# Local\nDo C.\n");
    expect(saved.resources.instructions).toEqual([
      { libraryId: second.id, enabled: true },
      { libraryId: first.id, enabled: false },
      { libraryId: expect.stringMatching(/^profile-[a-f0-9]{12}-[a-f0-9]{12}$/), enabled: true }
    ]);
  });
});
