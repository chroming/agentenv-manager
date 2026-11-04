import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createSkillGroupStore } from "../../src/main/skillGroupStore";
import { createProfileStore } from "../../src/main/profileStore";
import { createSkillRemovalService } from "../../src/main/skillRemovalService";
import { createTargetStateRepository } from "../../src/main/targetStateRepository";
import { createTargetRegistry } from "../../src/main/targets/registry";
import { hashSkillContent } from "../../src/main/skillContentHash";

let root = "";
afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); });
const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "aem-remove-"));
  const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
  const settingsStore = createSettingsStore(paths), library = createSkillLibraryStore(paths, settingsStore);
  const source = join(root, "source"); await mkdir(source);
  await writeFile(join(source, "SKILL.md"), "---\nname: review\ndescription: Review code\n---\nReview\n");
  await library.importSkill({ id: "review", sourcePath: source });
  const groups = createSkillGroupStore(paths.skillGroupsPath, () => library.listSkills());
  const group = await groups.create({ name: "Daily", description: "", skillIds: ["review"] });
  const profiles = createProfileStore(paths);
  await profiles.saveProfile({ manifest: { version: 2, id: "daily", name: "Daily", description: "" },
    instructions: "Original instructions", resources: { skills: [{ libraryId: "review", targetName: "review", enabled: true, direct: true, groupIds: ["daily-group"] }], mcpByTarget: {},
      skillGroups: [{ id: "daily-group", kind: "manual", groupId: group.id, name: group.name, enabled: true, memberIds: ["review"] }] } });
  const target = createTargetRegistry().get("codex").createTargetPaths({ homeDir: paths.homeDir });
  const canonical = join(paths.skillsLibraryDir, "review"), copy = join(target.skillsDir!, "review");
  await mkdir(target.skillsDir!, { recursive: true }); await cp(canonical, copy, { recursive: true });
  const link = join(target.skillsDir!, "alias"); await symlink(canonical, link);
  const unmanaged = join(target.skillsDir!, "outside"); await cp(canonical, unmanaged, { recursive: true });
  const states = createTargetStateRepository(paths);
  await states.write("codex", { managedMcpNames: [], activeProfileId: "daily", managedResources: [copy, link].map((path, index) => ({
    kind: "skill", id: index ? "runtime-alias" : "review", path, source: "skills-library/review", contentHash: "saved"
  })) });
  const service = createSkillRemovalService({ paths, settingsStore, skillGroupStore: groups, skillLibraryStore: library,
    targetPaths: async () => [target] });
  return { paths, library, groups, profiles, states, service, canonical, copy, link, unmanaged };
};

it("removes direct/group references and copied/linked installs together, with one complete Undo", async () => {
  const f = await setup(), preview = await f.service.preview("review");
  expect(preview.profiles.map((profile) => profile.id)).toEqual(["daily"]);
  expect(preview.groups).toHaveLength(1); expect(preview.installs).toHaveLength(2);
  const result = await f.service.remove("review", preview.previewId);
  await expect(lstat(f.canonical)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(f.copy)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(f.link)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await hashSkillContent(f.unmanaged)).toBeTruthy();
  expect((await f.profiles.readProfile("daily")).resources.skills).toEqual([]);
  expect((await f.profiles.readProfile("daily")).resources.skillGroups?.[0].memberIds).toEqual([]);
  expect((await f.groups.list())[0].skillIds).toEqual([]);
  expect((await f.states.read("codex")).state.managedResources).toEqual([]);
  await f.library.rollbackSkillCleanup(result.backupId);
  expect((await f.profiles.readProfile("daily")).resources.skills[0].libraryId).toBe("review");
  expect((await f.groups.list())[0].skillIds).toEqual(["review"]);
  expect((await lstat(f.link)).isSymbolicLink()).toBe(true);
  expect((await f.states.read("codex")).state.managedResources).toHaveLength(2);
});

it("rejects an actually changed selected install without touching any reference or file", async () => {
  const f = await setup(), preview = await f.service.preview("review");
  await writeFile(join(f.copy, "notes.txt"), "External work");
  await expect(f.service.remove("review", preview.previewId)).rejects.toThrow("changed after preview");
  expect(await readFile(join(f.copy, "notes.txt"), "utf8")).toBe("External work");
  expect((await f.groups.list())[0].skillIds).toEqual(["review"]);
  expect((await f.profiles.readProfile("daily")).resources.skills).toHaveLength(1);
});

it("rolls back already changed Profile references if updating groups fails", async () => {
  const f = await setup(), preview = await f.service.preview("review");
  vi.spyOn(f.groups, "replace").mockRejectedValueOnce(new Error("Disk unavailable"));
  await expect(f.service.remove("review", preview.previewId)).rejects.toThrow("Disk unavailable");
  expect((await f.profiles.readProfile("daily")).resources.skills).toHaveLength(1);
  expect((await f.groups.list())[0].skillIds).toEqual(["review"]);
  expect(await hashSkillContent(f.copy)).toBeTruthy(); expect(await hashSkillContent(f.canonical)).toBeTruthy();
  expect((await f.states.read("codex")).state.managedResources).toHaveLength(2);
});

it("does not compile unrelated Instructions while checking Skill references", async () => {
  const f = await setup();
  await mkdir(join(f.paths.profilesDir, "unrelated"));
  await writeFile(join(f.paths.profilesDir, "unrelated", "resources.json"), '{"skills":[],"instructions":[{"libraryId":"missing","enabled":true}]}');
  const preview = await f.service.preview("review");
  expect(preview.profiles).toHaveLength(1);
  await f.service.remove("review", preview.previewId);
});

it("detects a newly introduced reference after preview without deleting the Skill", async () => {
  const f = await setup(), preview = await f.service.preview("review");
  await f.profiles.saveProfile({ manifest: { version: 2, id: "new", name: "New", description: "" }, instructions: "", resources: {
    skills: [{ libraryId: "review", targetName: "review", enabled: true }], mcpByTarget: {}
  } });
  await expect(f.service.remove("review", preview.previewId)).rejects.toThrow("changed after preview");
  expect((await f.profiles.readProfile("new")).resources.skills).toHaveLength(1);
  expect(await hashSkillContent(f.canonical)).toBeTruthy();
});

it("restores Profile, group and private Agent receipts if a later transaction step fails", async () => {
  const f = await setup(), preview = await f.service.preview("review");
  const remove = f.library.removeSkill;
  vi.spyOn(f.library, "removeSkill").mockImplementation((id, paths, references) => remove(id, paths, {
    ...references!, apply: async (claim) => { await references!.apply(claim); throw new Error("Failure after reference commit"); }
  }));
  await expect(f.service.remove("review", preview.previewId)).rejects.toThrow("Failure after reference commit");
  expect((await f.profiles.readProfile("daily")).resources.skills[0].libraryId).toBe("review");
  expect((await f.groups.list())[0].skillIds).toEqual(["review"]);
  expect((await f.states.read("codex")).state.managedResources).toHaveLength(2);
  expect(await hashSkillContent(f.canonical)).toBeTruthy();
});
