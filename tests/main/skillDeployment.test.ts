import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deploySkillDirectory,
  removeSkillDeployment
} from "../../src/main/skillDeployment";
import {
  createOwnerMarkerContent,
  markerPathFor,
  markerPathForFile
} from "../../src/main/ownershipMarkers";

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
      createSymlink: async () => {
        throw codedError("ENOTSUP");
      }
    });

    expect(deployedAs).toBe("copy");
    await expect(readFile(join(fixture.targetDir, "SKILL.md"), "utf8"))
      .resolves.toBe("# Review\n");
    await expect(access(markerPathFor(fixture.targetDir))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(markerPathForFile(fixture.targetDir))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses a junction for live directory links on Windows", async () => {
    const fixture = await createFixture();
    let requestedType: string | null | undefined;

    await deploySkillDirectory({
      ...fixture,
      platform: "win32",
      syncMethod: "auto",
      createSymlink: async (_source, _target, type) => {
        requestedType = type;
        throw codedError("ENOTSUP");
      }
    });

    expect(requestedType).toBe("junction");
  });

  it("does not hide permission or filesystem failures behind Auto copy mode", async () => {
    const fixture = await createFixture();

    await expect(deploySkillDirectory({
      ...fixture,
      syncMethod: "auto",
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
      createSymlink: async () => {
        throw codedError("ENOTSUP");
      }
    })).rejects.toMatchObject({ code: "ENOTSUP" });
  });

  it("removes only an owned deployment and never follows nested symbolic links", async () => {
    if (process.platform === "win32") return;
    const fixture = await createFixture();
    const outside = join(root, "outside");
    await mkdir(fixture.targetDir, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "keep.txt"), "keep", "utf8");
    await symlink(outside, join(fixture.targetDir, "cycle"));
    await writeFile(
      markerPathFor(fixture.targetDir),
      createOwnerMarkerContent({
        profileId: "profile-1",
        targetId: "codex",
        kind: "skill",
        source: "skills-library/review"
      }),
      "utf8"
    );

    await removeSkillDeployment(fixture.targetDir, {
      allowedRoot: join(root, "agent", "skills"),
      expectedOwnership: { targetId: "codex", kind: "skill" }
    });

    await expect(access(fixture.targetDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(outside, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("refuses unowned or root-level removal", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.targetDir, { recursive: true });
    const skillsRoot = join(root, "agent", "skills");

    await expect(removeSkillDeployment(fixture.targetDir, {
      allowedRoot: skillsRoot,
      expectedOwnership: { targetId: "codex", kind: "skill" }
    })).rejects.toThrow("outside AgentEnv ownership");
    await expect(removeSkillDeployment(skillsRoot, {
      allowedRoot: skillsRoot
    })).rejects.toThrow("outside its allowed root");
  });
});
