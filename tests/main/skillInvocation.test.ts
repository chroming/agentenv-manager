import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { manualInvocationContent, hashInvokedSkill } from "../../src/main/skillInvocation";
import { deploySkillDirectory } from "../../src/main/skillDeployment";
import { hashSkillContent } from "../../src/main/skillContentHash";
import { ProfileSkillSchema } from "../../src/shared/schemas";
import { materializeProfileSkillGroups } from "../../src/shared/profileSkillGroups";
import { createProfileContentHash } from "../../src/main/profileFingerprint";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
const original = "---\nname: review\ndescription: Review code\nmetadata:\n  version: '1.0'\n# retain comment\nuser-invocable: false\n---\n\n# Review\nDo not edit this body.\n";

it("preserves unrelated metadata and body while making explicit invocation usable", () => {
  const result = manualInvocationContent(original);
  expect(result).toContain("disable-model-invocation: true");
  expect(result).toContain("user-invocable: true");
  expect(result).toContain("# retain comment");
  expect(result).toContain("version: '1.0'");
  expect(result.split("---\n").at(-1)).toBe(original.split("---\n").at(-1));
  expect(manualInvocationContent(result)).toBe(result);
  expect(() => manualInvocationContent("---\nname: [\n---\nbody")).toThrow();
});

it("materializes a private copy, hashes the actual output, and restores Default without touching Library", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-invocation-"));
  const sourceDir = join(root, "library");
  const targetDir = join(root, "agent", "review");
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, "SKILL.md"), original);
  const sourceHash = await hashSkillContent(sourceDir);
  await deploySkillDirectory({ sourceDir, targetDir, syncMethod: "symlink", targetId: "claude-code", invocationMode: "manual" });
  expect((await lstat(targetDir)).isSymbolicLink()).toBe(false);
  expect(await hashSkillContent(targetDir)).toBe(await hashInvokedSkill(sourceDir, "claude-code", "manual"));
  expect(await hashSkillContent(sourceDir)).toBe(sourceHash);
  expect(await readFile(join(sourceDir, "SKILL.md"), "utf8")).toBe(original);
  await expect(deploySkillDirectory({ sourceDir, targetDir, syncMethod: "copy", targetId: "opencode", invocationMode: "manual" })).rejects.toThrow("does not support");
  expect(await readFile(join(targetDir, "SKILL.md"), "utf8")).toContain("disable-model-invocation: true");
  await deploySkillDirectory({ sourceDir, targetDir, syncMethod: "copy", invocationMode: "default" });
  expect(await hashSkillContent(targetDir)).toBe(sourceHash);
});

it("persists invocation independently of enabled", () => {
  expect(ProfileSkillSchema.parse({ libraryId: "review", targetName: "review", enabled: false, invocationMode: "manual" }))
    .toMatchObject({ enabled: false, invocationMode: "manual" });
});

it("keeps the child policy when a group is off and excludes inactive policy from deployment fingerprints", () => {
  const resources = {
    skills: [{ libraryId: "review", targetName: "review", enabled: true, invocationMode: "manual" as const, direct: false, groupIds: ["group"] }],
    skillGroups: [{ id: "group", kind: "manual" as const, groupId: "reviews", name: "Reviews", enabled: false, memberIds: ["review"] }],
    mcpByTarget: {}
  };
  const effective = materializeProfileSkillGroups(resources);
  expect(effective.skills[0]).toMatchObject({ enabled: false, invocationMode: "manual" });
  const base = { manifest: { id: "demo", name: "Demo", description: "", version: 2 as const }, instructions: "", resources };
  const defaultPolicy = { ...base, resources: { ...resources, skills: resources.skills.map((entry) => ({ ...entry, invocationMode: undefined })) } };
  expect(createProfileContentHash(base, "claude-code")).toBe(createProfileContentHash(defaultPolicy, "claude-code"));
  const active = { ...resources, skillGroups: resources.skillGroups.map((group) => ({ ...group, enabled: true })) };
  expect(createProfileContentHash({ ...base, resources: active }, "claude-code"))
    .not.toBe(createProfileContentHash({ ...base, resources: { ...active, skills: defaultPolicy.resources.skills } }, "claude-code"));
});
