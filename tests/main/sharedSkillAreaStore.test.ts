import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSharedSkillAreaStore } from "../../src/main/sharedSkillAreaStore";

describe("sharedSkillAreaStore", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("keeps device-local management receipts without writing into the shared Skill", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-shared-skill-area-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSharedSkillAreaStore(paths);
    const sharedPath = join(paths.userSkillsDir, "reviewer");

    await expect(store.read()).resolves.toEqual({ formatVersion: 1, receipts: [] });
    const managed = await store.recordManaged([{
      path: sharedPath,
      sharedLocationId: "agents-skills",
      libraryId: "reviewer",
      adoptedContentHash: "hash-one",
      materialization: "copied"
    }]);

    expect(managed).toMatchObject({
      formatVersion: 1,
      mode: "managed",
      receipts: [{ path: sharedPath, libraryId: "reviewer", materialization: "copied" }]
    });
    expect(JSON.parse(await readFile(paths.sharedSkillAreaStatePath, "utf8"))).toMatchObject({
      mode: "managed",
      receipts: [{ path: sharedPath, libraryId: "reviewer" }]
    });
  });

  it("preserves receipt identity across updates and clears it when the area is kept unmanaged", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-shared-skill-area-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSharedSkillAreaStore(paths);
    const path = join(paths.userSkillsDir, "reviewer");
    const first = await store.recordManaged([{
      path,
      sharedLocationId: "agents-skills",
      libraryId: "reviewer",
      adoptedContentHash: "hash-one",
      materialization: "copied"
    }]);
    const second = await store.recordManaged([{
      path,
      sharedLocationId: "agents-skills",
      libraryId: "reviewer",
      adoptedContentHash: "hash-two",
      materialization: "linked"
    }]);

    expect(second.receipts[0].createdAt).toBe(first.receipts[0].createdAt);
    expect(second.receipts[0]).toMatchObject({ adoptedContentHash: "hash-two", materialization: "linked" });
    await expect(store.setMode("profiles-only")).resolves.toMatchObject({
      mode: "profiles-only",
      receipts: []
    });
    await expect(store.setMode("keep")).resolves.toMatchObject({ mode: "keep", receipts: [] });
  });
});
