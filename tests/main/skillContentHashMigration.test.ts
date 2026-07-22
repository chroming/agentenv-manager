import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { hashSkillContent } from "../../src/main/skillContentHash";
import { migrateSkillContentHashes } from "../../src/main/skillContentHashMigration";

let root = "";
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Skill content hash migration", () => {
  it("rehashes Library metadata, deployed resources, and capture receipts once", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-hash-migration-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const librarySkill = join(paths.skillsLibraryDir, "reviewer");
    const deployedSkill = join(root, "deployed", "reviewer");
    await mkdir(librarySkill, { recursive: true });
    await mkdir(deployedSkill, { recursive: true });
    await mkdir(paths.targetStatesDir, { recursive: true });
    await mkdir(paths.captureReceiptsDir, { recursive: true });
    await writeFile(join(librarySkill, "SKILL.md"), "# Library\n");
    await writeFile(join(deployedSkill, "SKILL.md"), "# Deployed\n");
    await writeFile(join(librarySkill, ".agentenv-skill.json"), JSON.stringify({ contentHash: "legacy" }));
    await writeFile(join(paths.targetStatesDir, "codex.json"), JSON.stringify({
      formatVersion: 2,
      managedMcpNames: [],
      managedResources: [{ kind: "skill", id: "reviewer", path: deployedSkill, contentHash: "legacy" }],
      sharedSkillPreparations: [],
      appliedLibraryVersions: { skills: { reviewer: "legacy" } }
    }));
    await writeFile(join(paths.captureReceiptsDir, "daily--codex.json"), JSON.stringify({
      formatVersion: 1,
      profileId: "daily",
      targetId: "codex",
      createdAt: new Date().toISOString(),
      skills: [{ libraryId: "reviewer", targetName: "reviewer", copies: [{ path: deployedSkill, contentHash: "legacy" }] }]
    }));

    await expect(migrateSkillContentHashes(paths)).resolves.toBe(true);
    await expect(migrateSkillContentHashes(paths)).resolves.toBe(false);

    const libraryHash = await hashSkillContent(librarySkill);
    const deployedHash = await hashSkillContent(deployedSkill);
    await expect(readJson<{ contentHash: string; contentHashVersion: number }>(join(librarySkill, ".agentenv-skill.json")))
      .resolves.toMatchObject({ contentHash: libraryHash, contentHashVersion: 2 });
    await expect(readJson<{ managedResources: Array<{ contentHash: string }>; appliedLibraryVersions: { skills: Record<string, string> } }>(join(paths.targetStatesDir, "codex.json")))
      .resolves.toMatchObject({ managedResources: [{ contentHash: deployedHash }], appliedLibraryVersions: { skills: { reviewer: libraryHash } } });
    await expect(readJson<{ skills: Array<{ copies: Array<{ contentHash: string }> }> }>(join(paths.captureReceiptsDir, "daily--codex.json")))
      .resolves.toMatchObject({ skills: [{ copies: [{ contentHash: deployedHash }] }] });
  });
});
