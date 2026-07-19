import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemSkillDriver } from "../../../src/main/targets/shared/skillRuntime";
import type { TargetPaths } from "../../../src/shared/types";

let root = "";

const writeSkill = async (path: string, name?: string) => {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "SKILL.md"),
    name
      ? `---\nname: ${name}\ndescription: Test Skill\nversion: 1.2.3\n---\n# Test\n`
      : "# Test\n",
    "utf8"
  );
};

const pathsFor = (
  targetId: string,
  skillsDir: string,
  scanDepth: "direct" | "recursive" = "direct"
): TargetPaths => ({
  targetId,
  configDir: join(root, "config"),
  instructionsPath: join(root, "instructions.md"),
  configPath: join(root, "config.json"),
  skillsDir,
  skillLocations: [{
    path: skillsDir,
    role: "preferred-runtime",
    shared: false,
    scope: "user",
    scanDepth,
    management: "managed"
  }]
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("filesystem Skill runtime driver", () => {
  it("uses frontmatter name as runtime identity and detects duplicate declarations", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-runtime-"));
    const skillsDir = join(root, "skills");
    await writeSkill(join(skillsDir, "first-folder"), "same-skill");
    await writeSkill(join(skillsDir, "second-folder"), "same-skill");

    const snapshot = await createFilesystemSkillDriver({ targetId: "test" })
      .inspectRuntime(pathsFor("test", skillsDir));

    expect(snapshot.observations.map((item) => item.runtimeName)).toEqual([
      "same-skill",
      "same-skill"
    ]);
    expect(snapshot.observations.map((item) => item.deploymentName)).toEqual([
      "first-folder",
      "second-folder"
    ]);
    expect(snapshot.observations.map((item) => item.availability)).toEqual([
      "enabled",
      "enabled"
    ]);
    expect(snapshot.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "duplicate-runtime-name" })
          ])
        })
      ])
    );
  });

  it("honors direct versus recursive discovery and safely stops symlink cycles", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-runtime-"));
    const skillsDir = join(root, "skills");
    await writeSkill(join(skillsDir, "collection", "nested"), "nested-skill");
    await symlink(skillsDir, join(skillsDir, "collection", "cycle"));
    const driver = createFilesystemSkillDriver({ targetId: "test" });

    await expect(driver.inspectRuntime(pathsFor("test", skillsDir, "direct")))
      .resolves.toMatchObject({ observations: [] });
    const recursive = await driver.inspectRuntime(pathsFor("test", skillsDir, "recursive"));
    expect(recursive.observations.map((item) => item.runtimeName)).toEqual(["nested-skill"]);
  });

  it("recognizes a Skill symlink owned by a Claude Code plugin", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-runtime-"));
    const skillsDir = join(root, ".claude", "skills");
    const pluginDir = join(root, ".claude", "plugins", "cache", "review-plugin");
    const pluginSkill = join(pluginDir, "skills", "reviewer");
    await writeSkill(pluginSkill, "reviewer");
    await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
    await writeFile(join(pluginDir, ".claude-plugin", "plugin.json"), "{}\n", "utf8");
    await mkdir(skillsDir, { recursive: true });
    await symlink(pluginSkill, join(skillsDir, "reviewer"));
    const targetPaths = pathsFor("claude-code", skillsDir);
    targetPaths.skillLocations![0].externalContainerMarkers = [{
      relativePath: ".claude-plugin/plugin.json",
      manager: "claude-plugin",
      displayName: "Claude Code plugin",
      importable: false
    }];

    const snapshot = await createFilesystemSkillDriver({ targetId: "claude-code" })
      .inspectRuntime(targetPaths);

    expect(snapshot.observations[0]).toMatchObject({
      owner: "external",
      externalOwnership: {
        manager: "claude-plugin",
        displayName: "Claude Code plugin",
        importable: false
      }
    });
  });
});
