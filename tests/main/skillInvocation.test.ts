import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { codexManualInvocationContent, manualInvocationContent, hashInvokedSkill } from "../../src/main/skillInvocation";
import { deploySkillDirectory } from "../../src/main/skillDeployment";
import { hashSkillContent } from "../../src/main/skillContentHash";
import { ProfileSkillSchema } from "../../src/shared/schemas";
import { materializeProfileSkillGroups } from "../../src/shared/profileSkillGroups";
import { createProfileContentHash } from "../../src/main/profileFingerprint";
import { parse } from "yaml";
import { supportsManualSkillInvocation } from "../../src/shared/skillInvocation";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
const original = "---\nname: review\ndescription: Review code\nmetadata:\n  version: '1.0'\n# retain comment\nuser-invocable: false\n---\n\n# Review\nDo not edit this body.\n";

it.each(["codex", "ssh:device:codex"])("supports Codex explicit-only invocation: %s", (targetId) => {
  expect(supportsManualSkillInvocation(targetId)).toBe(true);
});

it("keeps an existing explicit-only Codex policy byte-for-byte and preserves CRLF on edits", () => {
  const manual = "# keep\r\npolicy:\r\n  allow_implicit_invocation: false\r\n";
  expect(codexManualInvocationContent(manual)).toBe(manual);
  const changed = codexManualInvocationContent(manual.replace("false", "true"));
  expect(changed).toBe(manual);
  expect(codexManualInvocationContent("# Comment only\n")).toContain("# Comment only");
});

it.each([undefined, "", "# retain comment\ninterface:\n  display_name: Review\npolicy:\n  allow_implicit_invocation: true\n  other_setting: keep\ndependencies:\n  tools: []\n"])("materializes Codex policy without changing Library or SKILL.md (%s)", async (metadata) => {
  root = await mkdtemp(join(tmpdir(), "aem-codex-invocation-"));
  const sourceDir = join(root, "library");
  const targetDir = join(root, "agent", "review");
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, "SKILL.md"), original);
  if (metadata !== undefined) {
    await mkdir(join(sourceDir, "agents"));
    await writeFile(join(sourceDir, "agents", "openai.yaml"), metadata);
  }
  const sourceHash = await hashSkillContent(sourceDir);
  const expected = await hashInvokedSkill(sourceDir, "codex", "manual");
  await deploySkillDirectory({ sourceDir, targetDir, syncMethod: "symlink", targetId: "codex", invocationMode: "manual" });
  expect((await lstat(targetDir)).isSymbolicLink()).toBe(false);
  expect(await readFile(join(targetDir, "SKILL.md"), "utf8")).toBe(original);
  const generated = await readFile(join(targetDir, "agents", "openai.yaml"), "utf8");
  expect(parse(generated).policy.allow_implicit_invocation).toBe(false);
  if (metadata) {
    expect(generated).toContain("# retain comment");
    expect(parse(generated)).toMatchObject({ interface: { display_name: "Review" },
      policy: { other_setting: "keep" }, dependencies: { tools: [] } });
  }
  expect(await hashSkillContent(targetDir)).toBe(expected);
  expect(await hashSkillContent(sourceDir)).toBe(sourceHash);
  expect(await hashInvokedSkill(targetDir, "codex", "manual")).toBe(expected);
  await deploySkillDirectory({ sourceDir, targetDir, syncMethod: "copy", targetId: "codex", invocationMode: "default" });
  expect(await hashSkillContent(targetDir)).toBe(sourceHash);
});

it.each(["policy: [\n", "policy: false\n", "- list\n", "null\n"])("refuses malformed Codex metadata before replacing an existing deployment: %s", async (metadata) => {
  root = await mkdtemp(join(tmpdir(), "aem-codex-invocation-"));
  const sourceDir = join(root, "library");
  const targetDir = join(root, "target");
  await mkdir(join(sourceDir, "agents"), { recursive: true });
  await mkdir(targetDir);
  await writeFile(join(sourceDir, "SKILL.md"), original);
  await writeFile(join(sourceDir, "agents", "openai.yaml"), metadata);
  await writeFile(join(targetDir, "SKILL.md"), "# Existing content");
  await expect(deploySkillDirectory({ sourceDir, targetDir, syncMethod: "copy", targetId: "codex", invocationMode: "manual" }))
    .rejects.toThrow("Codex");
  expect(await readFile(join(targetDir, "SKILL.md"), "utf8")).toBe("# Existing content");
});

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
  const workBuddyDir = join(root, "workbuddy", "review");
  await deploySkillDirectory({
    sourceDir,
    targetDir: workBuddyDir,
    syncMethod: "symlink",
    targetId: "workbuddy",
    invocationMode: "manual"
  });
  expect((await lstat(workBuddyDir)).isSymbolicLink()).toBe(false);
  expect(await readFile(join(workBuddyDir, "SKILL.md"), "utf8"))
    .toContain("disable-model-invocation: true");
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
