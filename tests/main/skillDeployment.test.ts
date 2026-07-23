import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deploySkillDirectory } from "../../src/main/skillDeployment";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

const codedError = (code: string) => Object.assign(new Error(code), { code });

const createFixture = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-skill-deployment-"));
  const sourceDir = join(root, "library", "review");
  const targetDir = join(root, "agent", "skills", "review");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "SKILL.md"), "# Review\n", "utf8");
  return { sourceDir, targetDir };
};

describe("Skill deployment", () => {
  it("falls back to a copy in Auto mode only when links are unsupported", async () => {
    const fixture = await createFixture();
    const deployedAs = await deploySkillDirectory({
      ...fixture,
      syncMethod: "auto",
      markerContent: "{}",
      createSymlink: async () => {
        throw codedError("ENOTSUP");
      }
    });

    expect(deployedAs).toBe("copy");
    await expect(readFile(join(fixture.targetDir, "SKILL.md"), "utf8"))
      .resolves.toBe("# Review\n");
  });

  it("does not hide permission or filesystem failures behind Auto copy mode", async () => {
    const fixture = await createFixture();

    await expect(deploySkillDirectory({
      ...fixture,
      syncMethod: "auto",
      markerContent: "{}",
      createSymlink: async () => {
        throw codedError("EACCES");
      }
    })).rejects.toMatchObject({ code: "EACCES" });
  });

  it("never falls back when Live link is explicitly selected", async () => {
    const fixture = await createFixture();

    await expect(deploySkillDirectory({
      ...fixture,
      syncMethod: "symlink",
      markerContent: "{}",
      createSymlink: async () => {
        throw codedError("ENOTSUP");
      }
    })).rejects.toMatchObject({ code: "ENOTSUP" });
  });
});
