import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateAppDataToV2 } from "../../src/main/appDataMigration";
import { createPaths } from "../../src/main/paths";

let root = "";

const writeJson = (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"));

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("app data v2 migration", () => {
  it("backs up and migrates unversioned v1 data before registering v2", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-migration-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home")
    });
    const profileDir = join(paths.profilesDir, "daily-coding");
    const ownedSkillDir = join(profileDir, "skills", "review");
    await mkdir(ownedSkillDir, { recursive: true });
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(join(ownedSkillDir, "SKILL.md"), "---\nname: review\n---\n# Review\n");
    await writeFile(join(ownedSkillDir, "source-note.md"), "self-contained\n");
    await symlink("source-note.md", join(ownedSkillDir, "linked-note.md"));
    await writeJson(join(profileDir, "profile.json"), {
      id: "daily-coding",
      targetId: "opencode",
      name: "Daily Coding",
      description: "Migrated profile",
      version: 1,
      managed: { agents: true, mcp: true, skills: true }
    });
    await writeFile(join(profileDir, "AGENTS.md"), "# Agent\n");
    await writeJson(join(profileDir, "assets.json"), {
      ownedDirs: [{ kind: "skill", source: "skills/review", targetName: "review" }],
      mcpSelections: [{ targetId: "opencode", name: "context7", enabled: false }]
    });
    await writeJson(join(paths.targetStatesDir, "opencode.json"), {
      formatVersion: 1,
      managedConfigKeys: ["theme"],
      managedMcpNames: ["context7"],
      activeProfileId: "daily-coding",
      appliedProfileHash: "legacy-hash",
      appliedLibraryVersions: { skills: { review: "review-hash" }, mcp: {} },
      managedResources: [
        { kind: "instructions", id: "AGENTS.md", path: "/tmp/AGENTS.md", contentHash: "a" },
        { kind: "config", id: "config", path: "/tmp/config", contentHash: "b" },
        { kind: "skill", id: "review", path: "/tmp/review", contentHash: "c" }
      ]
    });

    const result = await migrateAppDataToV2(paths);

    expect(result).toMatchObject({ migrated: true, profileCount: 1 });
    expect(result.backupPath).toBeTruthy();
    await expect(readJson(join(result.backupPath!, "migration-backup.json"))).resolves.toMatchObject({
      fromVersion: "unversioned",
      toVersion: 2
    });
    await expect(readFile(join(result.backupPath!, "data", "profiles", "daily-coding", "profile.json"), "utf8"))
      .resolves.toContain('"version": 1');
    await expect(readJson(join(paths.appDataRoot, "agentenv-data.json"))).resolves.toEqual({
      formatVersion: 2
    });
    await expect(readJson(join(profileDir, "profile.json"))).resolves.toMatchObject({
      id: "daily-coding",
      preferredTargetId: "opencode",
      createdFromTargetId: "opencode",
      version: 2
    });
    await expect(readFile(join(profileDir, "INSTRUCTIONS.md"), "utf8")).resolves.toBe("# Agent\n");
    await expect(readJson(join(profileDir, "resources.json"))).resolves.toEqual({
      skills: [{ libraryId: "review", targetName: "review", enabled: true }],
      mcpByTarget: {
        opencode: {
          mode: "manage",
          selections: [{ name: "context7", enabled: false }]
        }
      }
    });
    expect((await readdir(profileDir)).sort()).toEqual([
      "INSTRUCTIONS.md",
      "profile.json",
      "resources.json"
    ]);
    expect((await lstat(join(paths.skillsLibraryDir, "review", "linked-note.md"))).isSymbolicLink())
      .toBe(false);
    await expect(readFile(join(paths.skillsLibraryDir, "review", "linked-note.md"), "utf8"))
      .resolves.toBe("self-contained\n");
    await expect(readJson(join(paths.targetStatesDir, "opencode.json"))).resolves.toEqual({
      formatVersion: 2,
      managedMcpNames: ["context7"],
      activeProfileId: "daily-coding",
      appliedLibraryVersions: { skills: { review: "review-hash" } },
      managedResources: [
        { kind: "instructions", id: "AGENTS.md", path: "/tmp/AGENTS.md", contentHash: "a" },
        { kind: "skill", id: "review", path: "/tmp/review", contentHash: "c" }
      ],
      sharedSkillPreparations: []
    });
  });

  it("fails closed and leaves the v1 marker and Profile untouched", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-migration-"));
    const paths = createPaths({ appDataRoot: join(root, "data") });
    const profileDir = join(paths.profilesDir, "unsafe-profile");
    await mkdir(profileDir, { recursive: true });
    await writeJson(join(paths.appDataRoot, "agentenv-data.json"), { formatVersion: 1 });
    await writeJson(join(profileDir, "profile.json"), {
      id: "unsafe-profile",
      targetId: "codex",
      name: "Unsafe",
      version: 1,
      managed: { instructions: true, config: true, assets: true }
    });
    await writeJson(join(profileDir, "assets.json"), {
      ownedDirs: [{ kind: "skill", source: "../outside", targetName: "unsafe" }]
    });

    await expect(migrateAppDataToV2(paths)).rejects.toThrow("Asset source");

    await expect(readJson(join(paths.appDataRoot, "agentenv-data.json"))).resolves.toEqual({
      formatVersion: 1
    });
    await expect(readJson(join(profileDir, "profile.json"))).resolves.toMatchObject({
      id: "unsafe-profile",
      version: 1
    });
    expect(await readdir(join(root, "agentenv-manager-migration-backups")))
      .toHaveLength(1);
  });

  it("registers v2 while retaining a malformed Profile for repair", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-migration-"));
    const paths = createPaths({ appDataRoot: join(root, "data") });
    const profileDir = join(paths.profilesDir, "partial-profile");
    await mkdir(profileDir, { recursive: true });
    await writeJson(join(paths.appDataRoot, "agentenv-data.json"), { formatVersion: 1 });
    await writeJson(join(profileDir, "profile.json"), {
      id: "partial-profile",
      name: "Partial",
      description: "",
      version: 2
    });
    await writeFile(join(profileDir, "INSTRUCTIONS.md"), "# Partial\n");

    await expect(migrateAppDataToV2(paths)).resolves.toMatchObject({
      migrated: true,
      profileCount: 0,
      retainedProfileCount: 1
    });

    await expect(readJson(join(paths.appDataRoot, "agentenv-data.json"))).resolves.toEqual({
      formatVersion: 2
    });
    await expect(readFile(join(profileDir, "INSTRUCTIONS.md"), "utf8"))
      .resolves.toBe("# Partial\n");
    await expect(readJson(join(paths.appDataRoot, "migration-v2-report.json")))
      .resolves.toMatchObject({
        retainedProfiles: [{ profileId: "partial-profile" }]
      });
  });

  it("registers v2 while retaining malformed Target state for recovery", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-migration-"));
    const paths = createPaths({ appDataRoot: join(root, "data") });
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeJson(join(paths.appDataRoot, "agentenv-data.json"), { formatVersion: 1 });
    const statePath = join(paths.targetStatesDir, "opencode.json");
    await writeFile(statePath, "not json\n", "utf8");

    await expect(migrateAppDataToV2(paths)).resolves.toMatchObject({
      migrated: true,
      profileCount: 0,
      retainedProfileCount: 0
    });

    await expect(readFile(statePath, "utf8")).resolves.toBe("not json\n");
    await expect(readJson(join(paths.appDataRoot, "migration-v2-report.json")))
      .resolves.toMatchObject({
        retainedTargetStates: [{ file: "opencode.json" }]
      });
  });
});
