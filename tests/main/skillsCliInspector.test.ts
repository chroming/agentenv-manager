import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSkillsCliLocks } from "../../src/main/skillsCliInspector";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("Skills CLI lock inspection", () => {
  it("reads v3 provenance without mutating the lock", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skills-cli-"));
    const lockPath = join(root, ".agents", ".skill-lock.json");
    const original = JSON.stringify({
      version: 3,
      skills: {
        reviewer: {
          source: "acme/skills",
          sourceType: "github",
          sourceUrl: "https://github.com/acme/skills",
          ref: "main",
          skillPath: "skills/reviewer/SKILL.md",
          skillFolderHash: "tree-sha"
        }
      }
    });
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, original);

    const inspection = await inspectSkillsCliLocks(root, [lockPath]);

    expect(inspection.diagnostics).toEqual([]);
    expect(inspection.evidenceBySkillKey.get("reviewer")).toEqual({
      manager: "skills-cli",
      displayName: "Skills CLI",
      importable: true,
      lockPath,
      lockVersion: 3,
      canonicalPath: join(root, ".agents", "skills", "reviewer"),
      confidence: "inferred",
      state: "healthy",
      upstream: {
        kind: "github",
        locator: "https://github.com/acme/skills",
        ref: "main",
        subpath: "skills/reviewer",
        revision: "tree-sha"
      }
    });
  });

  it("ignores corrupt and unsupported locks with diagnostics", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skills-cli-"));
    const corrupt = join(root, "corrupt.json");
    const unsupported = join(root, "unsupported.json");
    await writeFile(corrupt, "{not-json");
    await writeFile(unsupported, JSON.stringify({ version: 2, skills: {} }));

    const inspection = await inspectSkillsCliLocks(root, [corrupt, unsupported]);

    expect(inspection.evidenceBySkillKey.size).toBe(0);
    expect(inspection.diagnostics).toHaveLength(2);
  });
});
