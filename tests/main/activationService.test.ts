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
    const persistedState = JSON.parse(
      await readFile(join(paths.targetStatesDir, "codex.json"), "utf8")
    ) as { managedResources?: Array<{ kind: string; path: string }> };
    expect(persistedState.managedResources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "skill",
        path: join(paths.codexHome, "skills", "review")
      })
    ]));
    expect(persistedState.managedResources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringMatching(/\.agentenv-owner\.json$/) })
    ]));
    expect((await service.listTargetStates())[0]).toMatchObject({
      targetId: "codex",
      activeProfileId: "daily-coding",
      appliedLibraryVersions: { skills: { review: expect.any(String) } }
    });
    await expect(createBackupStore(paths).listBackups()).resolves.toHaveLength(1);
  });

  it("retains managed state visibility for configuration-root safety when an Agent is turned off", async () => {
    const { paths, service, settingsStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    expect((await service.applyProfile("daily-coding", preview.id)).ok).toBe(true);
    await settingsStore.updateSettings({ enabledTargetIds: ["opencode"] });

    await expect(service.listTargetStates()).resolves.toEqual([]);
    await expect(service.listTargetStates({ includeDisabled: true })).resolves.toEqual([
      expect.objectContaining({
        targetId: "codex",
        lifecycleStatus: "applied",
        activeProfileId: "daily-coding"
      })
    ]);
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

  it("removes a managed Codex Skill after editing the active Profile and converges", async () => {
    const { paths, profile, profileStore, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const installedSkill = join(paths.codexHome, "skills", "review");
    const first = await service.previewProfile(profile.id, "codex");
    expect((await service.applyProfile(profile.id, first.id)).ok).toBe(true);
    await expect(readFile(join(installedSkill, "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");

    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        skills: []
      }
    });

    const removal = await service.previewProfile(profile.id, "codex");
    expect(blockingMessages(removal.issues)).toEqual([]);
    expect(removal.resourceChanges).toContainEqual(
      expect.objectContaining({
        kind: "skill",
        action: "remove",
        name: "review",
        path: installedSkill
      })
    );
    expect(removal.targetStateChanged).toBe(true);
    expect((await service.applyProfile(profile.id, removal.id)).ok).toBe(true);
    await expect(lstat(installedSkill)).rejects.toThrow();
    expect((await service.listTargetStates())[0]).toMatchObject({
      targetId: "codex",
      activeProfileId: profile.id,
      lifecycleStatus: "applied",
      appliedLibraryVersions: { skills: {} }
    });

    const stable = await service.previewProfile(profile.id, "codex");
    expect(stable.changes).toEqual([]);
    expect(stable.resourceChanges).toEqual([]);
    expect(stable.sharedSkillPreparationChanged).toBe(false);
    expect(stable.targetStateChanged).toBe(false);
  });

  it("restores a missing managed Skill without treating the fresh Preview as stale", async () => {
    const { paths, profile, profileStore, service, skillLibraryStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const first = await service.previewProfile("daily-coding", "codex");
    expect((await service.applyProfile("daily-coding", first.id)).ok).toBe(true);
    const installedPath = join(paths.codexHome, "skills", "review");
    await rm(installedPath, { recursive: true, force: true });
    const dormantSource = join(root, "source", "dormant");
    await mkdir(dormantSource, { recursive: true });
    await writeFile(join(dormantSource, "SKILL.md"), "---\nname: dormant\n---\n# Dormant\n");
    await skillLibraryStore.importSkill({ sourcePath: dormantSource, id: "dormant" });
    await skillLibraryStore.setAvailability({ id: "dormant", enabled: false });
    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        skills: [
          ...profile.resources.skills,
          { libraryId: "dormant", targetName: "dormant", enabled: true }
        ]
      }
    });

    const restore = await service.previewProfile("daily-coding", "codex");

    expect(noticeMessages(restore.issues).join("\n")).toContain(
      "Missing managed skill review will be restored"
    );
    expect(noticeMessages(restore.issues).join("\n")).toContain(
      "Library Skill dormant is globally disabled and will not be applied"
    );
    await expect(service.applyProfile("daily-coding", restore.id)).resolves.toEqual(
      expect.objectContaining({ ok: true })
    );
    await expect(readFile(join(installedPath, "SKILL.md"), "utf8")).resolves.toContain(
      "# Review"
    );
  });

  it("removes writable Trae copies of a globally disabled Library Skill without treating evidence as ownership", async () => {
    const { paths, profileStore, service, skillLibraryStore } = await makeEnv();
    const source = join(root, "source", "ppe-debug");
    const traeDir = join(paths.homeDir, ".trae");
    const externalPaths = [
      join(traeDir, "skills", "ppe-debug"),
      join(paths.homeDir, ".coco", "skills", "ppe-debug"),
      join(paths.homeDir, ".trae-cn", "skills", "ppe-debug")
    ];
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: ppe-debug\ndescription: Debug PPE.\n---\n# PPE Debug\n"
    );
    await skillLibraryStore.importSkill({ sourcePath: source, id: "ppe-debug" });
    await skillLibraryStore.setAvailability({ id: "ppe-debug", enabled: false });
    for (const externalPath of externalPaths) {
      await mkdir(externalPath, { recursive: true });
      await cp(source, externalPath, { recursive: true });
    }
    await mkdir(traeDir, { recursive: true });
    await writeFile(join(traeDir, "AGENTS.md"), "# Existing Trae guidance\n");
    await profileStore.saveProfile({
      manifest: {
        id: "trae-captured",
        name: "Trae CLI",
        description: "Captured Trae environment",
        preferredTargetId: "trae-cli",
        version: 2
      },
      instructions: "# Managed Trae guidance\n",
      resources: {
        skills: [{ libraryId: "ppe-debug", targetName: "ppe-debug", enabled: true }],
        mcpByTarget: {
          "trae-cli": { mode: "ignore", selections: [] }
        }
      }
    });

    const preview = await service.previewProfile("trae-captured", "trae-cli");

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(noticeMessages(preview.issues)).toContain(
      "Library Skill ppe-debug is globally disabled and will not be applied"
    );
    expect(preview.issues.filter(({ resourceId }) => resourceId === "ppe-debug"))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("Cannot turn off Skill")
        })
      ]));
    await expect(service.applyProfile("trae-captured", preview.id)).resolves.toEqual(
      expect.objectContaining({ ok: true })
    );
    await expect(readFile(join(traeDir, "rules", "agentenv-manager.md"), "utf8"))
      .resolves.toBe("# Managed Trae guidance\n");
    await expect(readFile(join(traeDir, "AGENTS.md"), "utf8"))
      .resolves.toBe("# Existing Trae guidance\n");
    await expect(readFile(join(externalPaths[0], "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    for (const observedPath of externalPaths.slice(1)) {
      await expect(readFile(join(observedPath, "SKILL.md"), "utf8"))
        .resolves.toContain("# PPE Debug");
    }
  });

  it("accepts a semantically identical AgentEnv state serialization", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(
      join(paths.targetStatesDir, "codex.json"),
      JSON.stringify({
        sharedSkillPreparations: [],
        managedResources: [],
        managedMcpNames: [],
        formatVersion: 2
      })
    );

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual(
      expect.objectContaining({ ok: true })
    );
  });

  it("ignores Library metadata changes that do not affect deployed Skill content", async () => {
    const { paths, service, skillLibraryStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    const librarySkill = (await skillLibraryStore.listSkills()).find((skill) => skill.id === "review");
    if (!librarySkill) throw new Error("Expected review in the Skill Library");
    const metadataPath = join(librarySkill.path, ".agentenv-skill.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      metadataPath,
      `${JSON.stringify({ ...metadata, updatedAt: "2026-07-21T12:00:00.000Z" }, null, 2)}\n`
    );

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual(
      expect.objectContaining({ ok: true })
    );
    await expect(readFile(join(paths.codexHome, "skills", "review", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
  });

  it("still rejects a real AgentEnv management state change after preview", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(
      join(paths.targetStatesDir, "codex.json"),
      `${JSON.stringify({
        formatVersion: 2,
        managedMcpNames: [],
        managedResources: [],
        sharedSkillPreparations: [],
        activeProfileId: "another-profile"
      }, null, 2)}\n`
    );

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      kind: "stale",
      errors: ["AgentEnv management state changed after preview; review the latest version"]
    });
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe("# Old guidance\n");
  });

  it("treats reordered shared Skill preparation state as unchanged", async () => {
    const { paths, service, profileStore, profile, skillLibraryStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const secondSource = join(root, "source", "test");
    await mkdir(secondSource, { recursive: true });
    await writeFile(join(secondSource, "SKILL.md"), "---\nname: test\n---\n# Test\n");
    await skillLibraryStore.importSkill({ sourcePath: secondSource, id: "test" });
    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        skills: [
          { libraryId: "review", targetName: "review", enabled: true },
          { libraryId: "test", targetName: "test", enabled: true }
        ]
      }
    });
    for (const id of ["review", "test"]) {
      const librarySkill = (await skillLibraryStore.listSkills()).find((skill) => skill.id === id);
      if (!librarySkill) throw new Error(`Expected ${id} in the Skill Library`);
      await mkdir(join(paths.userSkillsDir, id), { recursive: true });
      await cp(librarySkill.path, join(paths.userSkillsDir, id), { recursive: true });
    }

    const first = await service.previewProfile(profile.id, "codex");
    expect(first.sharedSkillPreparations).toHaveLength(2);
    expect((await service.applyProfile(profile.id, first.id)).ok).toBe(true);
    expect((await service.listTargetStates())[0]).toMatchObject({
      lifecycleStatus: "applied",
      appliedLibraryVersions: { skills: {} }
    });
    const statePath = join(paths.targetStatesDir, "codex.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      sharedSkillPreparations: Array<{ sharedPaths: string[] }>;
    };
    state.sharedSkillPreparations.reverse();
    state.sharedSkillPreparations.forEach((preparation) => preparation.sharedPaths.reverse());
    await writeFile(statePath, `${JSON.stringify(state, null, 4)}\n`);

    const stable = await service.previewProfile(profile.id, "codex");
    expect(stable.sharedSkillPreparationChanged).toBe(false);
    expect(stable.changes).toEqual([]);
    expect(stable.resourceChanges).toEqual([]);
    await expect(service.applyProfile(profile.id, stable.id)).resolves.toEqual({
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

  it("does not report managed drift when a live link matches the current Library Skill", async () => {
    const { paths, service, skillLibraryStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const first = await service.previewProfile("daily-coding", "codex");
    expect((await service.applyProfile("daily-coding", first.id)).ok).toBe(true);

    const incoming = join(root, "source", "review-update");
    await mkdir(incoming, { recursive: true });
    await writeFile(
      join(incoming, "SKILL.md"),
      "---\nname: review\ndescription: Review changes.\n---\n\n# Updated review\n"
    );
    const importPreview = await skillLibraryStore.previewImport({
      kind: "local",
      input: { sourcePath: incoming, id: "review" }
    });
    await skillLibraryStore.importSkill({
      sourcePath: incoming,
      id: "review",
      expectedContentHash: importPreview.incoming.contentHash,
      conflictResolution: { action: "replace", existingId: "review" }
    });

    const updated = await service.previewProfile("daily-coding", "codex");
    const [targetState] = await service.listTargetStates();

    expect(updated.issues.filter((issue) => issue.code === "managed-resource-drift")).toEqual([]);
    expect(updated.targetStateChanged).toBe(false);
    expect(targetState).toMatchObject({
      lifecycleStatus: "applied",
      errorCount: 0,
      appliedLibraryVersions: {
        skills: { review: importPreview.incoming.contentHash }
      }
    });
    expect(await readFile(join(paths.codexHome, "skills", "review", "SKILL.md"), "utf8"))
      .toContain("# Updated review");
  });

  it("names a genuinely changed managed Skill in the protected-change issue", async () => {
    const { paths, service, settingsStore } = await makeEnv();
    await settingsStore.updateSettings({ skillSyncMethod: "copy" });
    await writeCodexLiveFiles(paths);
    const first = await service.previewProfile("daily-coding", "codex");
    expect((await service.applyProfile("daily-coding", first.id)).ok).toBe(true);
    const targetSkill = join(paths.codexHome, "skills", "review");
    await writeFile(join(targetSkill, "SKILL.md"), "---\nname: review\n---\n# External change\n");

    const preview = await service.previewProfile("daily-coding", "codex");
    const drift = preview.issues.find((issue) => issue.code === "managed-resource-drift");

    expect(drift).toMatchObject({
      disposition: "review",
      resourceKind: "skill",
      resourceId: "review",
      path: targetSkill
    });
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
    expect(rootEntry?.linkTarget).toBe(missingDestination);
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

  it("disables saved Profile resources without discarding their configuration", async () => {
    const { paths, service, profileStore, profile } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const enabledPreview = await service.previewProfile(profile.id, "codex");
    expect((await service.applyProfile(profile.id, enabledPreview.id)).ok).toBe(true);
    const installedSkill = join(paths.codexHome, "skills", "review");

    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        managementByTarget: {
          codex: { instructions: "disable", skills: "disable" }
        },
        mcpByTarget: {
          codex: {
            mode: "disable",
            selections: [{ name: "docs", enabled: true }]
          }
        }
      }
    });

    const disabledPreview = await service.previewProfile(profile.id, "codex");

    expect(blockingMessages(disabledPreview.issues)).toEqual([]);
    expect(disabledPreview.effectivePayload).toEqual({
      instructions: 0,
      skills: 0,
      mcpServers: 0,
      total: 0
    });
    expect(disabledPreview.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: paths.globalAgentsPath,
        category: "instructions",
        action: "remove"
      }),
      expect.objectContaining({
        path: paths.codexConfigPath,
        category: "mcp"
      })
    ]));
    expect(disabledPreview.resourceChanges).toContainEqual(
      expect.objectContaining({
        action: "remove",
        name: "review",
        path: installedSkill
      })
    );

    const disabledResult = await service.applyProfile(profile.id, disabledPreview.id);
    expect(disabledResult).toEqual(expect.objectContaining({ ok: true }));
    await expect(lstat(paths.globalAgentsPath)).rejects.toThrow();
    await expect(lstat(installedSkill)).rejects.toThrow();
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toContain(
      "enabled = false"
    );

    const saved = await profileStore.readProfile(profile.id);
    expect(saved.instructions).toBe("# New guidance\n");
    expect(saved.resources.skills).toEqual([
      { libraryId: "review", targetName: "review", enabled: true }
    ]);
    expect(saved.resources.managementByTarget?.codex).toEqual({
      instructions: "disable",
      skills: "disable"
    });
    expect(saved.resources.mcpByTarget.codex).toEqual({
      mode: "disable",
      selections: [{ name: "docs", enabled: true }]
    });

    const noOp = await service.previewProfile(profile.id, "codex");
    expect(noOp.changes).toEqual([]);
    expect(noOp.resourceChanges).toEqual([]);
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

  it("keeps a reviewed Skill path outside AgentEnv without changing the portable Profile", async () => {
    const { paths, service, skillLibraryStore, profileStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const outsidePath = join(paths.codexHome, "skills", "review");
    await mkdir(outsidePath, { recursive: true });
    await writeFile(
      join(outsidePath, "SKILL.md"),
      "---\nname: review\n---\n# Device-specific review\n"
    );

    const firstPreview = await service.previewProfile("daily-coding", "codex");
    expect(firstPreview.issues).toContainEqual(expect.objectContaining({
      code: "outside-skill-replacement",
      path: outsidePath,
      disposition: "review"
    }));

    await skillLibraryStore.setUnmanagedSkillLocations({
      items: [{
        path: outsidePath,
        targetId: "codex",
        coverage: "exact"
      }],
      unmanaged: true
    });
    const keptPreview = await service.previewProfile("daily-coding", "codex");

    expect(reviewMessages(keptPreview.issues)).toEqual([]);
    expect(keptPreview.issues).toContainEqual(expect.objectContaining({
      code: "unmanaged-skill-location",
      path: outsidePath,
      disposition: "notice"
    }));
    expect(keptPreview.resourceChanges.map((change) => change.path)).not.toContain(outsidePath);
    expect((await profileStore.readProfile("daily-coding")).resources.skills).toEqual([
      { libraryId: "review", targetName: "review", enabled: true }
    ]);

    expect((await service.applyProfile("daily-coding", keptPreview.id)).ok).toBe(true);
    await expect(readFile(join(outsidePath, "SKILL.md"), "utf8"))
      .resolves.toContain("# Device-specific review");
    expect((await service.listTargetStates())[0]).toMatchObject({
      lifecycleStatus: "applied-with-local-override",
      warningCount: 1,
      skillReceipts: [expect.objectContaining({
        path: outsidePath,
        libraryId: "review",
        targetName: "review",
        outcome: "external-active",
        localOverride: true
      })],
      appliedLibraryVersions: { skills: {} }
    });

    const stablePreview = await service.previewProfile("daily-coding", "codex");
    expect(reviewMessages(stablePreview.issues)).toEqual([]);
    expect(stablePreview.resourceChanges).toEqual([]);

    await writeFile(
      join(outsidePath, "SKILL.md"),
      "---\nname: review\n---\n# Changed outside AgentEnv\n"
    );
    const changedOutsidePreview = await service.previewProfile(
      "daily-coding",
      "codex"
    );
    expect(blockingMessages(changedOutsidePreview.issues)).toEqual([]);
    expect(reviewMessages(changedOutsidePreview.issues)).toEqual([]);
    expect(changedOutsidePreview.resourceChanges).toEqual([]);
    expect((await service.listTargetStates())[0]).toMatchObject({
      lifecycleStatus: "applied-with-local-override",
      warningCount: 1
    });
  });

  it("keeps a disabled Skill path visible as a device exception after Apply", async () => {
    const { paths, service, skillLibraryStore, profileStore, profile } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const outsidePath = join(paths.codexHome, "skills", "review");
    await mkdir(outsidePath, { recursive: true });
    await writeFile(
      join(outsidePath, "SKILL.md"),
      "---\nname: review\n---\n# Device-specific review\n"
    );
    await profileStore.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        skills: [{ libraryId: "review", targetName: "review", enabled: false }]
      }
    });
    await skillLibraryStore.setUnmanagedSkillLocations({
      items: [{ path: outsidePath, targetId: "codex", coverage: "exact" }],
      unmanaged: true
    });

    const preview = await service.previewProfile(profile.id, "codex");
    expect(reviewMessages(preview.issues)).toEqual([]);
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: "unmanaged-skill-location",
      path: outsidePath
    }));
    expect((await service.applyProfile(profile.id, preview.id)).ok).toBe(true);

    await expect(readFile(join(outsidePath, "SKILL.md"), "utf8"))
      .resolves.toContain("# Device-specific review");
    expect((await service.listTargetStates())[0]).toMatchObject({
      lifecycleStatus: "applied-with-local-override",
      warningCount: 1,
      appliedLibraryVersions: { skills: {} },
      skillReceipts: [expect.objectContaining({
        path: outsidePath,
        desired: "omit",
        outcome: "external-remains",
        localOverride: true
      })]
    });
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

  it("keeps a reviewed shared compatibility copy without installing a duplicate", async () => {
    const { paths, service, skillLibraryStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const librarySkill = (await skillLibraryStore.listSkills()).find((skill) => skill.id === "review");
    if (!librarySkill) throw new Error("Expected review in the Skill Library");
    const sharedSkill = join(paths.homeDir, ".agents", "skills", "review");
    const targetSkill = join(paths.codexHome, "skills", "review");
    await mkdir(join(paths.homeDir, ".agents", "skills"), { recursive: true });
    await cp(librarySkill.path, sharedSkill, { recursive: true });
    await skillLibraryStore.setSharedSkillRetention({
      skillKey: "review",
      paths: [sharedSkill],
      retained: true
    });

    const preview = await service.previewProfile("daily-coding", "codex");
    expect(reviewMessages(preview.issues)).toEqual([]);
    expect(preview.skillReceipts).toContainEqual(expect.objectContaining({
      path: sharedSkill,
      libraryId: "review",
      targetName: "review",
      localOverride: true
    }));
    expect((await service.applyProfile("daily-coding", preview.id)).ok).toBe(true);

    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).resolves.toContain("# Review");
    await expect(lstat(targetSkill)).rejects.toThrow();
    expect((await service.listTargetStates())[0]).toMatchObject({
      lifecycleStatus: "applied-with-local-override",
      skillReceipts: [expect.objectContaining({ path: sharedSkill })]
    });
  });

  it("moves a collection link only after preparing every nested Skill and preserves its source", async () => {
    const { paths, service, skillLibraryStore } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const librarySkill = (await skillLibraryStore.listSkills()).find(
      (skill) => skill.id === "review"
    );
    if (!librarySkill) throw new Error("Expected review in the Skill Library");
    const collectionSource = join(root, "external", "superpowers");
    const collectionSkill = join(collectionSource, "review");
    const collectionLink = join(paths.homeDir, ".agents", "skills", "superpowers");
    await mkdir(join(paths.homeDir, ".agents", "skills"), { recursive: true });
    await mkdir(collectionSource, { recursive: true });
    await cp(librarySkill.path, collectionSkill, { recursive: true });
    await symlink(collectionSource, collectionLink);

    const preview = await service.previewProfile("daily-coding", "codex");
    expect(preview.sharedSkillPreparations).toContainEqual(expect.objectContaining({
      skillKey: "review",
      libraryId: "review",
      sharedPaths: [join(collectionLink, "review")],
      disposition: "install"
    }));
    expect((await service.applyProfile("daily-coding", preview.id)).ok).toBe(true);

    const result = await service.completeSkillCollectionMigration({
      collectionPath: collectionLink,
      canonicalPath: collectionSource,
      members: [{
        skillKey: "review",
        libraryId: "review",
        sharedPath: join(collectionLink, "review"),
        consumerTargetIds: ["codex"]
      }]
    });

    await expect(lstat(collectionLink)).rejects.toThrow();
    await expect(readFile(join(collectionSource, "review", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    await expect(readFile(join(paths.codexHome, "skills", "review", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");

    await service.rollbackSharedSkillMigration(result.backupId);
    await expect(readlink(collectionLink)).resolves.toBe(collectionSource);
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

  it("does not stale a Preview when an unrelated local Skill appears", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    const lateSkill = join(paths.codexHome, "skills", "late-skill");
    await mkdir(lateSkill, { recursive: true });
    await writeFile(join(lateSkill, "SKILL.md"), "---\nname: late-skill\n---\n# Late\n");

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual(
      expect.objectContaining({ ok: true })
    );
    await expect(readFile(paths.globalAgentsPath, "utf8"))
      .resolves.toBe("# New guidance\n");
    await expect(readFile(join(lateSkill, "SKILL.md"), "utf8"))
      .resolves.toContain("# Late");
  });

  it("rejects a Preview when a missing Skills directory becomes a non-directory", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    const skillsRoot = join(paths.codexHome, "skills");
    await writeFile(skillsRoot, "occupied by a file\n", "utf8");

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        kind: "stale",
        errors: [expect.stringContaining("Skills root changed after preview")]
      })
    );
    await expect(readFile(skillsRoot, "utf8")).resolves.toBe(
      "occupied by a file\n"
    );
  });

  it("rejects a Preview when a deployment-relevant runtime Skill appears", async () => {
    const { paths, service } = await makeEnv();
    await writeCodexLiveFiles(paths);
    const preview = await service.previewProfile("daily-coding", "codex");
    const lateSkill = join(paths.codexHome, "skills", "late-review");
    await mkdir(lateSkill, { recursive: true });
    await writeFile(join(lateSkill, "SKILL.md"), "---\nname: review\n---\n# Late\n");

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      kind: "stale",
      errors: [
        "A deployment-relevant Skill changed after preview; review the latest version"
      ]
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

  it("rejects a Trae Preview when V2 layout evidence appears before Apply", async () => {
    const { paths, profileStore, service } = await makeEnv();
    const traeRoot = join(paths.homeDir, ".trae");
    const legacyConfigPath = join(traeRoot, "traecli.yaml");
    const managedInstructionsPath = join(traeRoot, "rules", "agentenv-manager.md");
    await mkdir(traeRoot, { recursive: true });
    await writeFile(legacyConfigPath, "model: legacy\n");
    await profileStore.saveProfile({
      manifest: {
        id: "trae-layout-transition",
        name: "Trae layout transition",
        description: "",
        preferredTargetId: "trae-cli",
        version: 2
      },
      instructions: "# Managed Trae guidance\n",
      resources: {
        skills: [],
        mcpByTarget: {
          "trae-cli": { mode: "ignore", selections: [] }
        }
      }
    });

    const preview = await service.previewProfile("trae-layout-transition", "trae-cli");
    await mkdir(join(traeRoot, "cli", "sessions"), { recursive: true });

    await expect(
      service.applyProfile("trae-layout-transition", preview.id)
    ).resolves.toEqual({
      ok: false,
      kind: "stale",
      errors: ["Agent paths changed after preview; review the latest version"]
    });
    await expect(readFile(legacyConfigPath, "utf8")).resolves.toBe("model: legacy\n");
    await expect(readFile(managedInstructionsPath, "utf8")).rejects.toThrow();
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
