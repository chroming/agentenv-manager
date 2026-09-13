import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashSkillContent } from "../../src/main/skillContentHash";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const createSkill = async (name: string) => {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  return path;
};

describe("Skill content hash v2", () => {
  it("rejects cycles, unavailable links, and bounded work without producing a hash", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-hash-"));
    await writeFile(join(root, "SKILL.md"), "content");
    await expect(hashSkillContent(root, { maxBytes: 2 })).rejects.toThrow("read limit");
    await expect(hashSkillContent(root, { maxEntries: 0 })).rejects.toThrow("too many entries");
    const controller = new AbortController();
    controller.abort();
    await expect(hashSkillContent(root, { signal: controller.signal })).rejects.toThrow();
    await symlink(".", join(root, "cycle"));
    await expect(hashSkillContent(root)).rejects.toThrow("symbolic link cycle");
    await rm(join(root, "cycle"));
    await symlink("missing", join(root, "broken"));
    await expect(hashSkillContent(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retries an ordinary concurrent content change and returns only the stable version", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-hash-"));
    const path = join(root, "SKILL.md");
    await writeFile(path, "original");
    const controller = new AbortController();
    let checks = 0;
    const hook = vi.spyOn(controller.signal, "throwIfAborted").mockImplementation(() => {
      // The first file has been read; mutate before final snapshot validation.
      if (++checks === 4) writeFileSync(path, "changed content");
    });
    const hash = await hashSkillContent(root, { signal: controller.signal });
    hook.mockRestore();
    expect(hash).toBe(await hashSkillContent(root));
    expect(checks).toBeGreaterThan(5);
  });

  it("keeps copied content equivalent to external linked content without changing the target", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-hash-"));
    const outside = await createSkill("outside");
    const linked = await createSkill("linked");
    const copied = await createSkill("copied");
    await writeFile(join(outside, "文本.md"), "same content");
    await symlink(join(outside, "文本.md"), join(linked, "文本.md"));
    await writeFile(join(copied, "文本.md"), "same content");
    expect(await hashSkillContent(linked)).toBe(await hashSkillContent(copied));
  });
  it("frames paths and content so ambiguous byte streams do not collide", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-hash-"));
    const first = await createSkill("first");
    const second = await createSkill("second");
    await writeFile(join(first, "a"), "bc");
    await writeFile(join(second, "ab"), "c");

    await expect(hashSkillContent(first)).resolves.not.toBe(await hashSkillContent(second));
  });

  it("includes empty directories and ignores only AgentEnv metadata", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-hash-"));
    const first = await createSkill("first");
    const second = await createSkill("second");
    await mkdir(join(first, "empty"));
    await writeFile(join(first, ".agentenv-skill.json"), "one");
    await writeFile(join(second, ".agentenv-skill.json"), "two");

    await expect(hashSkillContent(first)).resolves.not.toBe(await hashSkillContent(second));
    await rm(join(first, "empty"), { recursive: true });
    await expect(hashSkillContent(first)).resolves.toBe(await hashSkillContent(second));
  });

  it("hashes equivalent copied and linked files identically", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-hash-"));
    const first = await createSkill("first");
    const second = await createSkill("second");
    await writeFile(join(first, "source.md"), "shared");
    await symlink("source.md", join(first, "linked.md"));
    await writeFile(join(second, "source.md"), "shared");
    await writeFile(join(second, "linked.md"), "shared");

    await expect(hashSkillContent(first)).resolves.toBe(await hashSkillContent(second));
  });
});
