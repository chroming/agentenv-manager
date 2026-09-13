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
  it("finishes independent batches and retries only the corrupt member", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-hash-batches-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const directories = Array.from({ length: 12 }, (_, index) => join(paths.skillsLibraryDir, `skill-${index}`));
    for (const [index, directory] of directories.entries()) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "SKILL.md"), `# Skill ${index}\n`);
      await writeFile(join(directory, ".agentenv-skill.json"), index === 5 ? "{broken" : "{}");
    }
    await migrateSkillContentHashes(paths);
    expect(await readJson(join(paths.appDataRoot, "content-hash-format.json")))
      .toMatchObject({ pendingPaths: [directories[5]] });
    for (const [index, directory] of directories.entries()) {
      const metadata = await readFile(join(directory, ".agentenv-skill.json"), "utf8");
      if (index === 5) expect(metadata).toBe("{broken");
      else expect(JSON.parse(metadata)).toMatchObject({ contentHashVersion: 2, contentHash: await hashSkillContent(directory) });
    }
    const healthyMetadata = await readFile(join(directories[0]!, ".agentenv-skill.json"), "utf8");
    await writeFile(join(directories[0]!, "SKILL.md"), "# Later external edit\n");
    await writeFile(join(directories[5]!, ".agentenv-skill.json"), "{}");
    await migrateSkillContentHashes(paths);
    expect(await readFile(join(directories[0]!, ".agentenv-skill.json"), "utf8")).toBe(healthyMetadata);
    expect(await migrateSkillContentHashes(paths)).toBe(false);
  });

  it("keeps corrupt Library data intact and retries only until it becomes readable", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-hash-migration-partial-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const skill = join(paths.skillsLibraryDir, "broken");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "# Content");
    await writeFile(join(skill, ".agentenv-skill.json"), "{broken");
    const deployed = join(root, "deployed");
    await mkdir(deployed);
    await writeFile(join(deployed, "SKILL.md"), "# Original");
    await mkdir(paths.targetStatesDir, { recursive: true });
    const statePath = join(paths.targetStatesDir, "codex.json");
    await writeFile(statePath, JSON.stringify({
      formatVersion: 3, managedMcpNames: [], managedResources: [
        { kind: "skill", id: "working", path: deployed, contentHash: "legacy" }
      ], skillReceipts: [], sharedSkillPreparations: []
    }));
    await expect(migrateSkillContentHashes(paths)).resolves.toBe(true);
    const migratedState = await readFile(statePath, "utf8");
    expect(await readFile(join(skill, ".agentenv-skill.json"), "utf8")).toBe("{broken");
    expect(await readJson(join(paths.appDataRoot, "content-hash-format.json"))).toMatchObject({ pendingPaths: [skill] });
    await writeFile(join(skill, ".agentenv-skill.json"), "{}");
    await writeFile(join(deployed, "SKILL.md"), "# External edit after migration");
    await expect(migrateSkillContentHashes(paths)).resolves.toBe(true);
    expect(await readFile(statePath, "utf8")).toBe(migratedState);
    await expect(migrateSkillContentHashes(paths)).resolves.toBe(false);
  });
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

  it("retains malformed Target state and optional Capture receipts while upgrading healthy data", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-hash-migration-invalid-neighbor-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const healthySkill = join(paths.skillsLibraryDir, "healthy");
    await mkdir(healthySkill, { recursive: true });
    await mkdir(paths.targetStatesDir, { recursive: true });
    await mkdir(paths.captureReceiptsDir, { recursive: true });
    await writeFile(join(healthySkill, "SKILL.md"), "# Healthy\n");
    const invalidStatePath = join(paths.targetStatesDir, "codex.json");
    const invalidReceiptPath = join(paths.captureReceiptsDir, "daily--codex.json");
    await writeFile(invalidStatePath, "{ invalid state", "utf8");
    await writeFile(invalidReceiptPath, "{ invalid receipt", "utf8");
    const warnings: string[] = [];

    await expect(migrateSkillContentHashes(paths, {
      onWarning: (message) => {
        warnings.push(message);
      }
    })).resolves.toBe(true);

    await expect(readFile(invalidStatePath, "utf8")).resolves.toBe("{ invalid state");
    await expect(readFile(invalidReceiptPath, "utf8")).resolves.toBe("{ invalid receipt");
    expect(warnings).toEqual([
      expect.stringContaining("Skipped invalid Target state"),
      expect.stringContaining("Skipped invalid optional Capture receipt")
    ]);
    await expect(readJson<{ skillContentHashVersion: number }>(
      join(paths.appDataRoot, "content-hash-format.json")
    )).resolves.toEqual({ skillContentHashVersion: 2 });
  });

  it("removes legacy ownership sidecars from managed Skill state without touching the files", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-hash-migration-owner-sidecar-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const targetSkill = join(root, "home", ".claude", "skills", "operations-helper");
    const ownerSidecar = `${targetSkill}.agentenv-owner.json`;
    await mkdir(paths.targetStatesDir, { recursive: true });
    await mkdir(join(root, "home", ".claude", "skills"), { recursive: true });
    await writeFile(ownerSidecar, "{\"owner\":\"agentenv-manager\"}\n", "utf8");
    await writeFile(join(paths.targetStatesDir, "claude-code.json"), JSON.stringify({
      formatVersion: 2,
      managedMcpNames: [],
      managedResources: [{
        kind: "skill",
        id: "operations-helper.agentenv-owner.json",
        path: ownerSidecar,
        contentHash: "legacy"
      }],
      sharedSkillPreparations: []
    }));
    const warnings: string[] = [];

    await expect(migrateSkillContentHashes(paths, {
      onWarning: (message) => {
        warnings.push(message);
      }
    })).resolves.toBe(true);

    await expect(readFile(ownerSidecar, "utf8"))
      .resolves.toBe("{\"owner\":\"agentenv-manager\"}\n");
    await expect(readJson<{ managedResources: unknown[] }>(
      join(paths.targetStatesDir, "claude-code.json")
    )).resolves.toMatchObject({ managedResources: [] });
    expect(warnings).toEqual([
      expect.stringContaining("Removed legacy ownership sidecar")
    ]);
  });
});
