import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { blockingMessages, noticeMessages, reviewMessages } from "../helpers/applyIssues";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const makeEnv = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-activation-v2-"));
  const paths = createPaths({
    appDataRoot: join(root, "data"),
    homeDir: join(root, "home")
  });
  await mkdir(paths.codexHome, { recursive: true });
  const profileStore = createProfileStore({
    appDataRoot: paths.appDataRoot,
    homeDir: paths.homeDir
  });
  const settingsStore = createSettingsStore(paths);
  const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
  const source = join(root, "source", "review");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), [
    "---", "name: review", "description: Review changes.", "---", "", "# Review", ""
  ].join("\n"));
  await skillLibraryStore.importSkill({ sourcePath: source, id: "review" });
  const profile = await profileStore.saveProfile({
    manifest: {
      id: "daily-coding",
      name: "Daily Coding",
      description: "Default",
      preferredTargetId: "codex",
      version: 2
    },
    instructions: "# New guidance\n",
    resources: {
      skills: [{ libraryId: "review", targetName: "review", enabled: true }],
      mcpByTarget: {
        codex: {
          mode: "manage",
          selections: [{ name: "docs", enabled: true }]
        }
      }
    }
  });
  const service = createActivationService({
    paths,
    profileStore,
    settingsStore,
    skillLibraryStore
  });
  return { paths, profileStore, settingsStore, skillLibraryStore, profile, service };
};

const writeCodexLiveFiles = async (paths: ReturnType<typeof createPaths>) => {
  await mkdir(paths.codexHome, { recursive: true });
  await writeFile(paths.globalAgentsPath, "# Old guidance\n");
  await writeFile(paths.codexConfigPath, [
    'model = "gpt-5"',
    "",
    "[mcp_servers.docs]",
    'command = "docs"',
    "enabled = false",
    ""
  ].join("\n"));
};

describe("activation service v2", () => {
  it("fails closed when persisted Agent management state is invalid", async () => {
    const { paths, service } = await makeEnv();
    await mkdir(paths.targetStatesDir, { recursive: true });
    const statePath = join(paths.targetStatesDir, "codex.json");
    await writeFile(statePath, "{ invalid json");

    await expect(service.listTargetStates()).resolves.toEqual([
      expect.objectContaining({
        targetId: "codex",
        lifecycleStatus: "recovery-required",
        lifecycleReason: expect.stringContaining(statePath)
      })
    ]);
    await expect(service.previewProfile("daily-coding", "codex"))
      .rejects.toThrow("management state is invalid");
    await expect(readFile(statePath, "utf8")).resolves.toBe("{ invalid json");
  });

  it("applies Instructions, a Library Skill, and a selected MCP switch", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);

    const preview = await service.previewProfile("daily-coding", "codex");
    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.changes.map(({ path }) => path)).toEqual(expect.arrayContaining([
      paths.globalAgentsPath,
      paths.codexConfigPath
    ]));
    expect(preview.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: paths.globalAgentsPath, category: "instructions" }),
      expect.objectContaining({ path: paths.codexConfigPath, category: "mcp" })
    ]));
    expect(preview.resourceChanges).toContainEqual(expect.objectContaining({
      kind: "skill",
      action: "install",
      name: "review",
      path: join(paths.codexHome, "skills", "review")
    }));

    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe("# New guidance\n");
    const config = await readFile(paths.codexConfigPath, "utf8");
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain("enabled = true");
    await expect(readFile(join(paths.codexHome, "skills", "review", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    expect((await service.listTargetStates())[0]).toMatchObject({
      targetId: "codex",
      activeProfileId: "daily-coding",
      appliedLibraryVersions: { skills: { review: expect.any(String) } }
    });
    await expect(createBackupStore(paths).listBackups()).resolves.toHaveLength(1);
  });

  it("is a true no-op after the same Profile is applied", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const first = await service.previewProfile("daily-coding", "codex");
    expect((await service.applyProfile("daily-coding", first.id)).ok).toBe(true);

    const second = await service.previewProfile("daily-coding", "codex");

    expect(blockingMessages(second.issues)).toEqual([]);
    expect(second.changes).toEqual([]);
    expect(second.resourceChanges).toEqual([]);
    await expect(service.applyProfile("daily-coding", second.id)).resolves.toEqual({
      ok: false,
      kind: "no-op",
      errors: ["No changes to apply"]
    });
  });

  it("automatically re-adopts an exact unmanaged Skill copy on a later Apply", async () => {
    const { paths, service, skillLibraryStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const first = await service.previewProfile("daily-coding", "codex");
    expect((await service.applyProfile("daily-coding", first.id)).ok).toBe(true);

    const targetSkill = join(paths.codexHome, "skills", "review");
    await rm(targetSkill, { recursive: true, force: true });
    await rm(`${targetSkill}.agentenv-owner.json`, { force: true });
    const librarySkill = (await skillLibraryStore.listSkills()).find((skill) => skill.id === "review");
    if (!librarySkill) throw new Error("Expected review in the Skill Library");
    await cp(librarySkill.path, targetSkill, { recursive: true });

    const preview = await service.previewProfile("daily-coding", "codex");

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(reviewMessages(preview.issues)).toEqual([]);
    expect(preview.resourceChanges).toContainEqual(expect.objectContaining({
      action: "replace",
      path: targetSkill
    }));
    expect((await service.applyProfile("daily-coding", preview.id)).ok).toBe(true);
    expect((await lstat(targetSkill)).isSymbolicLink()).toBe(true);
  });

  it("backs up and replaces a broken Target Skills root link without touching its destination", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const skillsRoot = join(paths.codexHome, "skills");
    const missingDestination = join(root, "shared-skills-that-do-not-exist");
    await symlink(missingDestination, skillsRoot, "dir");

    const preview = await service.previewProfile("daily-coding", "codex");

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(reviewMessages(preview.issues)).toEqual([
      expect.stringContaining("Skills root link will be backed up and replaced")
    ]);
    const applied = await service.applyProfile("daily-coding", preview.id);
    if (!applied.ok) throw new Error(applied.errors.join("; "));
    expect((await lstat(skillsRoot)).isDirectory()).toBe(true);
    await expect(readFile(join(skillsRoot, "review", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    await expect(lstat(missingDestination)).rejects.toThrow();

    const backup = await createBackupStore(paths).readBackup(applied.backupId);
    const rootEntry = backup.entries.find((entry) => entry.sourcePath === skillsRoot);
    expect(rootEntry?.kind).toBe("symlink");
    if (!rootEntry?.backupPath) throw new Error("Expected Skills root backup path");
    expect(await readlink(rootEntry.backupPath)).toBe(missingDestination);
  });

  it("does not inspect or write MCP config in ignore mode", async () => {
    const { paths, service, profileStore, profile } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old\n");
    await writeFile(paths.codexConfigPath, "[invalid");
    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        mcpByTarget: { codex: { mode: "ignore", selections: [] } }
      }
    });

    const preview = await service.previewProfile(profile.id, "codex");

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.changes.map(({ path }) => path)).not.toContain(paths.codexConfigPath);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.codexConfigPath);
    expect((await service.applyProfile(profile.id, preview.id)).ok).toBe(true);
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toBe("[invalid");
  });

  it("counts empty Instructions and an Off MCP choice as explicit managed states", async () => {
    const { paths, service, profileStore, profile } = await makeEnv();
    await mkdir(paths.codexHome, { recursive: true });
    await writeFile(paths.globalAgentsPath, "# Existing\n");
    await writeFile(paths.codexConfigPath, [
      "[mcp_servers.docs]",
      'command = "docs"',
      "enabled = true",
      ""
    ].join("\n"));
    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: "",
      resources: {
        skills: [],
        mcpByTarget: {
          codex: {
            mode: "manage",
            selections: [{ name: "docs", enabled: false }]
          }
        }
      }
    });

    const preview = await service.previewProfile(profile.id, "codex");

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.effectivePayload).toEqual({
      instructions: 1,
      skills: 0,
      mcpServers: 1,
      total: 2
    });
    expect(preview.changes.map(({ path }) => path)).toEqual(expect.arrayContaining([
      paths.globalAgentsPath,
      paths.codexConfigPath
    ]));
  });

  it("blocks enabled missing Skills but accepts disabled missing Skills", async () => {
    const { paths, service, profileStore, profile } = await makeEnv();
    await writeCodexLiveFiles(paths);
    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        skills: [{ libraryId: "missing", targetName: "missing", enabled: true }],
        mcpByTarget: { codex: { mode: "ignore", selections: [] } }
      }
    });
    expect(blockingMessages((await service.previewProfile(profile.id, "codex")).issues))
      .toEqual([expect.stringContaining("Library Skill does not exist")]);

    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        skills: [{ libraryId: "missing", targetName: "missing", enabled: false }],
        mcpByTarget: { codex: { mode: "ignore", selections: [] } }
      }
    });
    const disabled = await service.previewProfile(profile.id, "codex");
    expect(blockingMessages(disabled.issues)).toEqual([]);
    expect(disabled.resourceChanges).toEqual([]);
  });

  it("removes an AgentEnv-owned Skill when it is disabled", async () => {
    const { paths, service, profileStore, profile } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const enabled = await service.previewProfile(profile.id, "codex");
    expect((await service.applyProfile(profile.id, enabled.id)).ok).toBe(true);
    const installedPath = join(paths.codexHome, "skills", "review");
    expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);

    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        skills: [{ libraryId: "review", targetName: "review", enabled: false }]
      }
    });
    const disabled = await service.previewProfile(profile.id, "codex");
    expect(blockingMessages(disabled.issues)).toEqual([]);
    expect(disabled.resourceChanges).toContainEqual(expect.objectContaining({
      action: "remove",
      name: "review",
      path: installedPath
    }));
    expect((await service.applyProfile(profile.id, disabled.id)).ok).toBe(true);
    await expect(lstat(installedPath)).rejects.toThrow();
  });

  it("backs up and removes an ordinary unmanaged copy when the Profile turns it off", async () => {
    const { paths, service, profileStore, profile } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const externalPath = join(paths.codexHome, "skills", "review");
    await mkdir(externalPath, { recursive: true });
    await writeFile(join(externalPath, "SKILL.md"), "---\nname: review\n---\n# External\n");
    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        skills: [{ libraryId: "review", targetName: "review", enabled: false }]
      }
    });

    const preview = await service.previewProfile(profile.id, "codex");

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(reviewMessages(preview.issues)).toEqual([
      expect.stringContaining("backed up and removed")
    ]);
    const result = await service.applyProfile(profile.id, preview.id);
    expect(result.ok).toBe(true);
    await expect(lstat(externalPath)).rejects.toThrow();
    await expect(createBackupStore(paths).listBackups()).resolves.toHaveLength(1);
  });

  it("records a disabled shared Skill intent without claiming that Apply removes the shared copy", async () => {
    const { paths, service, profileStore, profile, skillLibraryStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const librarySkill = (await skillLibraryStore.listSkills()).find((skill) => skill.id === "review");
    if (!librarySkill) throw new Error("Expected review in the Skill Library");
    const sharedSkill = join(paths.homeDir, ".agents", "skills", "review");
    await mkdir(join(paths.homeDir, ".agents", "skills"), { recursive: true });
    await cp(librarySkill.path, sharedSkill, { recursive: true });
    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        skills: [{ libraryId: "review", targetName: "review", enabled: false }]
      }
    });

    const preview = await service.previewProfile(profile.id, "codex");

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(reviewMessages(preview.issues)).toEqual([]);
    expect(noticeMessages(preview.issues)).toEqual([
      expect.stringContaining("stays active until shared migration removes")
    ]);
    expect(preview.resourceChanges.map((change) => change.path)).not.toContain(sharedSkill);
    expect(preview.sharedSkillPreparations).toContainEqual(expect.objectContaining({
      libraryId: "review",
      disposition: "omit",
      sharedPaths: [sharedSkill]
    }));
    expect((await service.applyProfile(profile.id, preview.id)).ok).toBe(true);
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).resolves.toContain("# Review");
  });

  it("rejects stale previews without overwriting live files", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    await writeFile(paths.globalAgentsPath, "# Changed after preview\n");

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      kind: "stale",
      errors: [`Live file changed after preview: ${paths.globalAgentsPath}`]
    });
    await expect(readFile(paths.globalAgentsPath, "utf8"))
      .resolves.toBe("# Changed after preview\n");
  });

  it("rejects a Preview when any deployment-relevant Skill fact changes", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    const lateSkill = join(paths.codexHome, "skills", "late-skill");
    await mkdir(lateSkill, { recursive: true });
    await writeFile(join(lateSkill, "SKILL.md"), "---\nname: late-skill\n---\n# Late\n");

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      kind: "stale",
      errors: ["Skill environment changed after preview; review the latest version"]
    });
    await expect(readFile(paths.globalAgentsPath, "utf8"))
      .resolves.toBe("# Old guidance\n");
    await expect(readFile(join(paths.codexHome, "skills", "review", "SKILL.md"), "utf8"))
      .rejects.toThrow();
  });

  it("rejects a Preview when Skill deployment settings change", async () => {
    const { paths, service, settingsStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    await settingsStore.updateSettings({ skillSyncMethod: "copy" });

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      kind: "stale",
      errors: ["Skill deployment settings changed after preview; review the latest version"]
    });
    await expect(readFile(paths.globalAgentsPath, "utf8"))
      .resolves.toBe("# Old guidance\n");
  });

  it("restores the pre-Apply environment from its backup", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    const applied = await service.applyProfile("daily-coding", preview.id);
    if (!applied.ok) throw new Error(applied.errors.join("; "));

    const rollback = await service.previewRollback(applied.backupId);
    expect(rollback.errors).toEqual([]);
    expect((await service.rollback(applied.backupId)).ok).toBe(true);

    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe("# Old guidance\n");
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toContain("enabled = false");
  });
});
