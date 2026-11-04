import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import type { ProfileStore } from "../../src/main/profileStore";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
const fixture = async (options: Parameters<typeof createSkillLibraryStore>[2] = {}) => {
  root = await mkdtemp(join(tmpdir(), "aem-update-advice-"));
  const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
  const source = join(root, "source"); await mkdir(source);
  await writeFile(join(source, "SKILL.md"), "---\nname: review\ndescription: Reviews code\n---\nOld\n");
  const store = createSkillLibraryStore(paths, undefined, options);
  await store.importSkill({ id: "review", sourcePath: source });
  await store.setUpdateSource({ id: "review", sourceType: "local", source });
  await writeFile(join(source, "SKILL.md"), "---\nname: review\ndescription: Reviews code\n---\nNew\n");
  return { store, paths };
};

it("previews and updates a Library Skill despite an unrelated damaged Profile", async () => {
  const { store, paths } = await fixture({ profileStore: {
    listProfiles: vi.fn().mockResolvedValue([{ id: "broken", name: "Unrelated", loadError: "damaged" }]),
    readProfile: vi.fn(), saveProfile: vi.fn()
  } as unknown as ProfileStore });
  const plan = await store.previewUpdate("review");
  expect(plan.changes).toHaveLength(1);
  expect(plan.impact.status).toBe("partial");
  await store.updateSkill({ id: plan.id, previewId: plan.previewId! });
  expect(await readFile(join(paths.skillsLibraryDir, "review", "SKILL.md"), "utf8")).toContain("New");
});

it("returns the Diff before a pending Agent impact read, then enriches the same preview", async () => {
  let finish!: (value: []) => void;
  const { store } = await fixture({ targetPathsProvider: () => new Promise<[]>((done) => { finish = done; }) });
  const plan = await Promise.race([store.previewUpdate("review"), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Diff blocked by optional impact")), 1500))]);
  expect(plan.changes).toHaveLength(1);
  expect(plan.impact.status).toBe("pending");
  finish([]);
  expect((await store.readUpdateImpact(plan.previewId!)).status).not.toBe("pending");
});
