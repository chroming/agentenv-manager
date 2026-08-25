import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSkillGroupStore } from "../../src/main/skillGroupStore";
import type { SkillLibraryEntry } from "../../src/shared/types";

const skill = (id: string): SkillLibraryEntry => ({
  id,
  name: id,
  description: "",
  path: `/library/${id}`,
  sourceType: "local",
  updatePolicy: "untracked",
  contentHash: `${id}-hash`,
  updatedAt: "2026-08-21T00:00:00.000Z"
});

describe("SkillGroupStore", () => {
  it("creates, updates, and removes manual groups atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentenv-skill-groups-"));
    const store = createSkillGroupStore(join(root, "skill-groups.json"), async () => [skill("alpha"), skill("beta")]);

    const created = await store.create({
      name: "Review",
      description: "Review tools",
      iconKey: "shield",
      skillIds: ["beta", "alpha"]
    });
    expect((await store.list())[0]).toMatchObject({
      name: "Review",
      iconKey: "shield",
      skillIds: ["alpha", "beta"]
    });

    await store.update({
      id: created.id,
      name: "Focused review",
      description: "",
      iconKey: "palette",
      skillIds: ["alpha"]
    });
    expect((await store.list())[0]).toMatchObject({
      name: "Focused review",
      iconKey: "palette",
      skillIds: ["alpha"]
    });

    await store.remove(created.id);
    expect(await store.list()).toEqual([]);
  });

  it("rejects missing members and duplicate names", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentenv-skill-groups-"));
    const store = createSkillGroupStore(join(root, "skill-groups.json"), async () => [skill("alpha")]);
    await store.create({ name: "Review", description: "", skillIds: ["alpha"] });

    await expect(store.create({ name: "review", description: "", skillIds: [] }))
      .rejects.toThrow("already exists");
    await expect(store.create({ name: "Missing", description: "", skillIds: ["beta"] }))
      .rejects.toThrow("unavailable");
  });

  it("does not replace a valid file when an update is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentenv-skill-groups-"));
    const path = join(root, "nested", "skill-groups.json");
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(path, '{"formatVersion":1,"groups":[]}\n');
    const store = createSkillGroupStore(path, async () => [skill("alpha")]);

    await expect(store.create({ name: "Missing", description: "", skillIds: ["beta"] }))
      .rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });
});
