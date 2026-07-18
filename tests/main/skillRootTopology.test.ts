import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSkillRoot } from "../../src/main/skillRootTopology";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Skill root topology", () => {
  it("distinguishes a real directory from a root link", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-root-"));
    const shared = join(root, "shared");
    const linked = join(root, "linked");
    await mkdir(shared);
    await symlink(shared, linked, "dir");

    await expect(inspectSkillRoot(shared)).resolves.toEqual({ kind: "directory" });
    await expect(inspectSkillRoot(linked)).resolves.toEqual(
      expect.objectContaining({
        kind: "symlink",
        transition: expect.objectContaining({ path: linked, linkTarget: shared })
      })
    );
  });

  it("reports broken and cyclic root links without traversing them", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-root-invalid-"));
    const broken = join(root, "broken");
    const cycleA = join(root, "cycle-a");
    const cycleB = join(root, "cycle-b");
    await symlink(join(root, "missing"), broken, "dir");
    await symlink(cycleB, cycleA, "dir");
    await symlink(cycleA, cycleB, "dir");

    await expect(inspectSkillRoot(broken)).resolves.toEqual(
      expect.objectContaining({ kind: "invalid", error: expect.stringContaining("unavailable") })
    );
    await expect(inspectSkillRoot(cycleA)).resolves.toEqual(
      expect.objectContaining({ kind: "invalid", error: expect.stringContaining("cycle") })
    );
  });
});
