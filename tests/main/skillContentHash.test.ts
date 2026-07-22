import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
