import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashSkillContent } from "../../../src/main/skillContentHash";
import {
  applySkillRefs,
  validateSkillRefs
} from "../../../src/main/targets/skillRefs";
import type { ProfileDetail, TargetPaths } from "../../../src/shared/types";
import { blockingMessages } from "../../helpers/applyIssues";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Skill deployment execution guard", () => {
  it("rejects an approved unmanaged copy if its content changes before execution", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-execution-guard-"));
    const skillLibraryDir = join(root, "skills-library");
    const sourceDir = join(skillLibraryDir, "reviewer");
    const skillsDir = join(root, "target", "skills");
    const targetDir = join(skillsDir, "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    const original = "---\nname: reviewer\n---\n# Original\n";
    await writeFile(join(sourceDir, "SKILL.md"), original, "utf8");
    await writeFile(join(targetDir, "SKILL.md"), original, "utf8");
    const approvedHash = await hashSkillContent(targetDir);
    const approvedUnmanagedSkillHashes = new Map([[targetDir, approvedHash]]);
    const targetPaths: TargetPaths = {
      targetId: "codex",
      configDir: join(root, "target"),
      instructionsPath: join(root, "target", "AGENTS.md"),
      configPath: join(root, "target", "config.toml"),
      skillsDir
    };
    const profile: ProfileDetail = {
      id: "daily",
      manifest: {
        id: "daily",
        name: "Daily",
        description: "",
        preferredTargetId: "codex",
        version: 2
      },
      instructions: "",
      resources: {
        skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: true }],
        mcpByTarget: {}
      }
    };

    await writeFile(join(targetDir, "SKILL.md"), "# Changed after Preview\n", "utf8");
    const input = {
      profile,
      targetPaths,
      skillLibraryDir,
      approvedUnmanagedSkillHashes
    };

    expect(blockingMessages(await validateSkillRefs(input))).toEqual([
      expect.stringContaining("Skill target already exists and is not AgentEnv-owned")
    ]);
    await expect(applySkillRefs(input)).rejects.toThrow(
      `Skill target changed after preview and is not AgentEnv-owned: ${targetDir}`
    );
    await expect(readFile(join(targetDir, "SKILL.md"), "utf8"))
      .resolves.toBe("# Changed after Preview\n");
  });
});
