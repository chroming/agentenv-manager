import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createSkillLibraryReader } from "../../src/main/skillLibraryReader";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createPaths } from "../../src/main/paths";
import type { SkillLibraryEntry } from "../../src/shared/types";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "aem-library-read-"));
  for (const id of ["healthy", "broken"]) await mkdir(join(root, id));
};
const entry = (id: string, path: string): SkillLibraryEntry => ({
  id, path, name: id, description: "", sourceType: "local", contentHash: "known",
  updatePolicy: "untracked", updatedAt: "2026-01-01T00:00:00Z"
});

it("isolates an unreadable sibling and fails closed for mutation callers", async () => {
  await setup();
  const reader = createSkillLibraryReader(async () => root, async (id, path) => {
    if (id === "broken") throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    return entry(id, path);
  });
  const issues = vi.fn();
  const result = await reader(issues);
  expect(result.find((item) => item.id === "healthy")?.readIssue).toBeUndefined();
  expect(result.find((item) => item.id === "broken")?.readIssue).toContain("Permission denied");
  expect(issues).toHaveBeenCalledWith([expect.objectContaining({ code: "unreadable-skill" })]);
  await expect(reader()).rejects.toThrow("Permission denied");
});

it("coalesces overlapping display scans but keeps strict reads fresh", async () => {
  await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const readEntry = vi.fn(async (id: string, path: string) => {
    await gate;
    return entry(id, path);
  });
  const reader = createSkillLibraryReader(async () => root, readEntry);
  const first = reader(() => undefined);
  const second = reader(() => undefined);
  release();
  expect(await first).toEqual(await second);
  expect(readEntry).toHaveBeenCalledTimes(2);
  await reader();
  expect(readEntry).toHaveBeenCalledTimes(4);
  await reader(() => undefined);
  expect(readEntry).toHaveBeenCalledTimes(6);
});

it("retains last-good content only for display and clears the issue after recovery", async () => {
  await setup();
  let failed = false;
  const reader = createSkillLibraryReader(async () => root, async (id, path) => {
    if (failed) throw new Error("Temporary read error");
    return entry(id, path);
  });
  await reader();
  failed = true;
  expect(await reader(() => undefined)).toEqual([
    expect.objectContaining({ id: "broken", contentHash: "known", readIssue: expect.any(String) }),
    expect.objectContaining({ id: "healthy", contentHash: "known", readIssue: expect.any(String) })
  ]);
  await expect(reader()).rejects.toThrow("Temporary read error");
  failed = false;
  expect((await reader()).every((item) => !item.readIssue)).toBe(true);
  await rm(join(root, "broken"), { recursive: true });
  expect((await reader()).map((item) => item.id)).toEqual(["healthy"]);
});

it("does not convert an unavailable root to an empty result or leak a different Library cache", async () => {
  await setup();
  let selected = root;
  const reader = createSkillLibraryReader(async () => selected, async (id, path) => entry(id, path));
  await reader();
  await rm(root, { recursive: true });
  expect(await reader(() => undefined)).toHaveLength(2);
  await expect(reader()).rejects.toThrow("Could not read Skill");
  selected = join(root, "new-library");
  expect(await reader(() => undefined)).toEqual([]);
});

it("handles invalid metadata and missing SKILL.md without modifying original files", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-library-invalid-"));
  const paths = createPaths({ appDataRoot: root, homeDir: join(root, "home") });
  for (const id of ["good", "bad", "empty"]) await mkdir(join(paths.skillsLibraryDir, id), { recursive: true });
  for (const id of ["good", "bad"]) await writeFile(join(paths.skillsLibraryDir, id, "SKILL.md"), `---\nname: ${id}\ndescription: Example\n---\nText`);
  await writeFile(join(paths.skillsLibraryDir, "bad", ".agentenv-skill.json"), "null");
  const store = createSkillLibraryStore(paths);
  const result = await store.listSkills(() => undefined);
  expect(result).toHaveLength(3);
  expect(result.filter((item) => item.readIssue)).toHaveLength(2);
  expect(result.find((item) => item.id === "good")?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(store.listSkills()).rejects.toThrow("metadata must be an object");
});

it("reports an unavailable Agent independently and never invents an empty successful inventory", async () => {
  await setup();
  const paths = createPaths({ appDataRoot: join(root, "app"), homeDir: join(root, "home") });
  const targets = ["codex", "opencode"].map((targetId) => ({
    targetId, configDir: join(root, targetId), configPath: join(root, targetId, "config"),
    instructionsPath: join(root, targetId, "AGENTS.md"), skillsDir: join(root, targetId, "skills")
  }));
  const provider = vi.fn(async ({ targetId }: { targetId: string }) => {
    if (targetId === "codex") throw new Error("EACCES Codex");
    return { targetId, observations: [], issues: [] };
  });
  const store = createSkillLibraryStore(paths, undefined, { runtimeSnapshotProvider: provider });
  const issues = vi.fn();
  expect(await store.scanInventory(targets, [], issues)).toEqual([]);
  expect(provider).toHaveBeenCalledTimes(2);
  expect(issues).toHaveBeenCalledWith([expect.objectContaining({ message: expect.stringContaining("EACCES Codex") })]);
  await expect(store.scanInventory(targets, [])).rejects.toThrow("EACCES Codex");
});

it("does not rewrite metadata or its timestamp for an unchanged icon", async () => {
  await setup();
  const paths = createPaths({ appDataRoot: join(root, "app"), homeDir: join(root, "home") });
  const source = join(root, "healthy");
  await writeFile(join(source, "SKILL.md"), "---\nname: healthy\ndescription: Example\n---\nContent");
  const store = createSkillLibraryStore(paths);
  const imported = await store.importSkill({ sourcePath: source });
  await store.setIcon({ id: imported.id, iconKey: "folder" });
  const path = join(imported.path, ".agentenv-skill.json");
  const before = { content: await readFile(path, "utf8"), stat: await stat(path) };
  await store.setIcon({ id: imported.id, iconKey: "folder" });
  expect(await readFile(path, "utf8")).toBe(before.content);
  expect((await stat(path)).mtimeMs).toBe(before.stat.mtimeMs);
});
