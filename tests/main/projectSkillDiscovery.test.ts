import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanProjectSkillRoots } from "../../src/main/projectSkillDiscovery";

const writeSkill = async (path: string, name: string, body = "Do useful work.") => {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${body}\nversion: 1.2.3\n---\n\n# ${name}\n`
  );
};

describe("scanProjectSkillRoots", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-project-scan-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const path = (...parts: string[]) => join(root, ...parts);

  it("discovers nested Skills without entering generated or nested Skill folders", async () => {
    const projectRoot = path("project");
    await writeSkill(join(projectRoot, ".agents", "skills", "review"), "Review");
    await writeSkill(join(projectRoot, ".agents", "skills", "review", "nested"), "Nested");
    await writeSkill(join(projectRoot, "node_modules", "package-skill"), "Package Skill");

    const result = await scanProjectSkillRoots([projectRoot], []);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      name: "Review",
      relativePath: ".agents/skills/review",
      version: "1.2.3",
      status: "ready"
    });
  });

  it("does not follow directory symlinks", async () => {
    const projectRoot = path("project");
    const outside = path("outside", "linked-skill");
    await mkdir(projectRoot, { recursive: true });
    await writeSkill(outside, "Outside");
    await symlink(outside, join(projectRoot, "linked-skill"), "dir");

    const result = await scanProjectSkillRoots([projectRoot], []);

    expect(result.candidates).toEqual([]);
  });

  it("recognizes content already represented in Library", async () => {
    const projectRoot = path("project");
    const skillPath = join(projectRoot, "skills", "review");
    await writeSkill(skillPath, "Review");
    const first = await scanProjectSkillRoots([projectRoot], []);

    const result = await scanProjectSkillRoots([projectRoot], [{
      id: "library-review",
      name: "Review",
      description: "Do useful work.",
      path: path("library", "library-review"),
      sourceType: "local",
      updatePolicy: "untracked",
      contentHash: first.candidates[0].contentHash,
      updatedAt: "2026-07-22T00:00:00.000Z"
    }]);

    expect(result.candidates[0]).toMatchObject({
      status: "in-library",
      existingLibraryId: "library-review"
    });
  });

  it("reports unavailable roots without failing the entire scan", async () => {
    const healthy = path("healthy");
    await writeSkill(join(healthy, "skill"), "Healthy");

    const result = await scanProjectSkillRoots([path("missing"), healthy], []);

    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["Healthy"]);
    expect(result.issues).toHaveLength(1);
  });
});
