import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { AgentTargetAdapter } from "../../src/main/targets/types";

let root = "";

const makeEnv = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-apply-"));
  const codexHome = join(root, ".codex");
  const userSkillsDir = join(root, ".agents", "skills");
  await mkdir(codexHome, { recursive: true });
  await mkdir(userSkillsDir, { recursive: true });
  const paths = createPaths({ appDataRoot: root, homeDir: root, codexHome, userSkillsDir });

  const profileDir = join(paths.profilesDir, "daily-coding");
  await mkdir(join(profileDir, "skills", "example-skill"), { recursive: true });
  await writeFile(
    join(profileDir, "profile.json"),
    JSON.stringify({
      id: "daily-coding",
      name: "Daily Coding",
      description: "Default",
      version: 1,
      managed: { agents: true, mcp: true, skills: true }
    })
  );
  await writeFile(join(profileDir, "AGENTS.md"), "# New agents\n");
  await writeFile(
    join(profileDir, "mcp.toml"),
    '[mcp_servers.context7]\ncommand = "npx"\n'
  );
  await writeFile(
    join(profileDir, "assets.json"),
    JSON.stringify({
      ownedDirs: [
        {
          kind: "skill",
          source: "skills/example-skill",
          targetName: "agentenv-daily-coding-example-skill"
        }
      ],
      ownedFiles: [],
      skillRefs: [],
      mcpRefs: [
        {
          libraryId: "shared-docs",
          targetName: "shared_docs"
        }
      ],
      disabledSkillPaths: ["/Users/example/.agents/skills/old/SKILL.md"]
    })
  );
  await writeFile(
    join(paths.appDataRoot, "mcp-library.json"),
    JSON.stringify([
      {
        id: "shared-docs",
        name: "Shared Docs",
        transport: "http",
        url: "https://example.com/shared-docs/mcp"
      }
    ])
  );
  await writeFile(
    join(profileDir, "skills", "example-skill", "SKILL.md"),
    "---\nname: example\n---\n"
  );

  const profileStore = createProfileStore({
    appDataRoot: paths.appDataRoot,
    codexHome: paths.codexHome,
    userSkillsDir: paths.userSkillsDir
  });
  const settingsStore = createSettingsStore(paths);
  const skillLibraryStore = createSkillLibraryStore(paths);
  const service = createActivationService({
    paths,
    profileStore,
    settingsStore,
    skillLibraryStore
  });

  return { paths, profileStore, service, settingsStore, skillLibraryStore };
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("activation service", () => {
  it("hides deployment state and blocks Apply after an Agent is turned off", async () => {
    const { paths, service, settingsStore } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');

    const preview = await service.previewProfile("daily-coding");
    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual(
      expect.objectContaining({ ok: true })
    );
    await settingsStore.updateSettings({ enabledTargetIds: [] });

    await expect(service.listTargetStates()).resolves.toEqual([]);
    await expect(service.previewProfile("daily-coding")).rejects.toThrow(
      "Codex is turned off in Settings"
    );
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe("# New agents\n");
  });

  it("scans Target Skill inventory once per preview", async () => {
    const { service, skillLibraryStore } = await makeEnv();
    const scanInventory = vi.spyOn(skillLibraryStore, "scanInventory");

    await service.previewProfile("daily-coding");

    expect(scanInventory).toHaveBeenCalledTimes(1);
  });

  it("applies a profile, creates a backup, and copies owned skills", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n# keep me\n');

    const preview = await service.previewProfile("daily-coding");
    expect(preview.resourceChanges).toContainEqual({
      kind: "skill",
      action: "install",
      name: "agentenv-daily-coding-example-skill",
      path: join(paths.codexHome, "skills", "agentenv-daily-coding-example-skill"),
      source: "skills/example-skill"
    });
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result.ok).toBe(true);
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# New agents\n"
    );
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toContain(
      "# keep me"
    );
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toContain(
      "[mcp_servers.context7]"
    );
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toContain(
      "[mcp_servers.shared_docs]"
    );
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toContain(
      'url = "https://example.com/shared-docs/mcp"'
    );
    await expect(
      readFile(
        join(
          paths.codexHome,
          "skills",
          "agentenv-daily-coding-example-skill",
          "SKILL.md"
        ),
        "utf8"
      )
    ).resolves.toContain("name: example");
    const state = (await service.listTargetStates())[0];
    expect(state?.activeProfileId).toBe("daily-coding");
    expect(state?.appliedProfileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state?.appliedLibraryVersions?.mcp["shared-docs"]).toContain(
      "https://example.com/shared-docs/mcp"
    );

    const backups = await createBackupStore(paths).listBackups();
    expect(backups).toHaveLength(1);
  });

  it("reports no changes after the same profile is fully applied", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');

    const firstPreview = await service.previewProfile("daily-coding");
    expect((await service.applyProfile("daily-coding", firstPreview.id)).ok).toBe(true);

    const secondPreview = await service.previewProfile("daily-coding");
    expect(secondPreview.errors).toEqual([]);
    expect(secondPreview.changes).toEqual([]);
    expect(secondPreview.resourceChanges).toEqual([]);
    await expect(service.applyProfile("daily-coding", secondPreview.id)).resolves.toEqual({
      ok: false,
      errors: ["No changes to apply"]
    });

    const state = (await service.listTargetStates()).find(({ targetId }) => targetId === "codex");
    expect(state?.errorCount).toBe(0);
  });

  it("never exposes legacy literal credentials through an Apply Preview", async () => {
    const { paths, service } = await makeEnv();
    const literalSecret = "sk-1234567890abcdefghijklmnop";
    await writeFile(
      join(paths.profilesDir, "daily-coding", "mcp.toml"),
      `api_key = "${literalSecret}"\n`
    );

    const preview = await service.previewProfile("daily-coding");
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain(literalSecret);
    expect(serialized).toContain("<redacted>");
    expect(preview.warnings).toContain(
      "Possible literal secret in profile content: api_key"
    );
  });

  it("adopts compatible live instructions, native config, and Library MCP references", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-adopt-target-"));
    const paths = createPaths({ appDataRoot: root, homeDir: root });
    const profileDir = join(paths.profilesDir, "open-profile");
    const liveDir = join(root, ".config", "opencode");
    await mkdir(profileDir, { recursive: true });
    await mkdir(liveDir, { recursive: true });
    await writeFile(
      join(profileDir, "profile.json"),
      JSON.stringify({
        id: "open-profile",
        targetId: "opencode",
        name: "Open Profile",
        description: "Adoption test",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      })
    );
    await writeFile(join(profileDir, "AGENTS.md"), "# Old guidance\n");
    await writeFile(join(profileDir, "opencode.jsonc"), '{ "theme": "old" }\n');
    await writeFile(
      join(profileDir, "assets.json"),
      JSON.stringify({ ownedDirs: [], ownedFiles: [], skillRefs: [], mcpRefs: [], disabledSkillPaths: [] })
    );
    await writeFile(join(liveDir, "AGENTS.md"), "# Live guidance\n");
    await writeFile(
      join(liveDir, "opencode.jsonc"),
      JSON.stringify({
        theme: "new",
        mcp: { docs: { type: "remote", url: "https://example.com/mcp" } }
      })
    );
    await writeFile(
      paths.mcpLibraryPath,
      JSON.stringify([
        {
          id: "library-docs",
          name: "Docs",
          transport: "http",
          url: "https://example.com/mcp"
        }
      ])
    );
    const profileStore = createProfileStore({ appDataRoot: root, homeDir: root });
    const service = createActivationService({ paths, profileStore });

    const result = await service.adoptTargetChanges("open-profile", "opencode");

    expect(result.adopted).toEqual(["instructions", "config", "mcp"]);
    expect(result.skipped).toEqual([]);
    expect(result.profile.instructions).toBe("# Live guidance\n");
    expect(JSON.parse(result.profile.configText)).toEqual({ theme: "new" });
    expect(result.profile.assetPolicy.mcpRefs).toEqual([
      { libraryId: "library-docs", targetName: "docs" }
    ]);
    await expect(createBackupStore(paths).listBackups()).resolves.toHaveLength(1);
  });

  it("does not back up or track an untouched Target config during takeover", async () => {
    const { paths, service } = await makeEnv();
    const profileDir = join(paths.profilesDir, "daily-coding");
    await writeFile(join(profileDir, "mcp.toml"), "");
    await writeFile(
      join(profileDir, "assets.json"),
      JSON.stringify({
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [],
        mcpRefs: [],
        disabledSkillPaths: []
      })
    );
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n# user-owned config\n');

    const preview = await service.previewProfile("daily-coding");
    expect(preview.changes.map((change) => change.path)).not.toContain(paths.codexConfigPath);
    const result = await service.applyProfile("daily-coding", preview.id);
    expect(result.ok).toBe(true);

    const state = JSON.parse(
      await readFile(join(paths.targetStatesDir, "codex.json"), "utf8")
    ) as { managedResources: Array<{ path: string }> };
    expect(state.managedResources.map((resource) => resource.path)).not.toContain(
      paths.codexConfigPath
    );
    if (result.ok) {
      const backup = await createBackupStore(paths).readBackup(result.backupId);
      expect(backup.entries.map((entry) => entry.sourcePath)).not.toContain(paths.codexConfigPath);
    }
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toBe(
      'model = "gpt-5"\n# user-owned config\n'
    );
  });

  it("prepares and atomically completes a shared Skill migration", async () => {
    const { paths, service } = await makeEnv();
    const librarySkill = join(paths.skillsLibraryDir, "reviewer");
    const sharedSkill = join(paths.userSkillsDir, "reviewer");
    const targetSkill = join(paths.codexHome, "skills", "reviewer");
    await mkdir(librarySkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(librarySkill, "SKILL.md"), "---\nname: reviewer\n---\n");
    await writeFile(join(sharedSkill, "SKILL.md"), "---\nname: reviewer\n---\n");

    const assetPolicyPath = join(paths.profilesDir, "daily-coding", "assets.json");
    const assetPolicy = JSON.parse(await readFile(assetPolicyPath, "utf8")) as {
      skillRefs: Array<{ libraryId: string; targetName: string }>;
    };
    assetPolicy.skillRefs.push({ libraryId: "reviewer", targetName: "reviewer" });
    await writeFile(assetPolicyPath, JSON.stringify(assetPolicy));

    const preview = await service.previewProfile("daily-coding");
    expect(preview.sharedSkillPreparationChanged).toBe(true);
    expect(preview.sharedSkillPreparations).toEqual([
      expect.objectContaining({
        skillKey: "reviewer",
        libraryId: "reviewer",
        disposition: "install",
        targetName: "reviewer"
      })
    ]);
    expect(preview.resourceChanges).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: targetSkill })])
    );

    expect((await service.applyProfile("daily-coding", preview.id)).ok).toBe(true);
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).resolves.toContain(
      "name: reviewer"
    );
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8")).rejects.toThrow();
    expect((await service.listTargetStates())[0]?.sharedSkillPreparations).toHaveLength(1);

    const migration = await service.completeSharedSkillMigration({
      skillKey: "reviewer",
      libraryId: "reviewer",
      sharedPaths: [sharedSkill],
      consumerTargetIds: ["codex"]
    });
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8")).resolves.toContain(
      "name: reviewer"
    );
    expect((await service.listTargetStates())[0]?.sharedSkillPreparations).toEqual([]);
    await expect(service.listSharedSkillMigrationBackups()).resolves.toEqual([
      expect.objectContaining({ id: migration.backupId, libraryId: "reviewer" })
    ]);

    await service.rollbackSharedSkillMigration(migration.backupId);
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).resolves.toContain(
      "name: reviewer"
    );
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8")).rejects.toThrow();
    expect((await service.listTargetStates())[0]?.sharedSkillPreparations).toHaveLength(1);
  });

  it("removes a shared Skill without deploying it when the prepared Profile omits it", async () => {
    const { paths, service } = await makeEnv();
    const librarySkill = join(paths.skillsLibraryDir, "unused-reviewer");
    const sharedSkill = join(paths.userSkillsDir, "unused-reviewer");
    const targetSkill = join(paths.codexHome, "skills", "unused-reviewer");
    await mkdir(librarySkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(librarySkill, "SKILL.md"), "---\nname: unused-reviewer\n---\n");
    await writeFile(join(sharedSkill, "SKILL.md"), "---\nname: unused-reviewer\n---\n");

    const preview = await service.previewProfile("daily-coding");
    expect(preview.sharedSkillPreparations).toEqual([
      expect.objectContaining({
        skillKey: "unused-reviewer",
        disposition: "omit"
      })
    ]);
    expect((await service.applyProfile("daily-coding", preview.id)).ok).toBe(true);
    await service.completeSharedSkillMigration({
      skillKey: "unused-reviewer",
      libraryId: "unused-reviewer",
      sharedPaths: [sharedSkill],
      consumerTargetIds: ["codex"]
    });

    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("restores shared paths and Target state when migration deployment fails", async () => {
    const { paths, profileStore } = await makeEnv();
    const baseSkillStore = createSkillLibraryStore(paths);
    const failingService = createActivationService({
      paths,
      profileStore,
      skillLibraryStore: {
        ...baseSkillStore,
        deployLibrarySkill: async () => {
          throw new Error("Injected deployment failure");
        }
      }
    });
    const librarySkill = join(paths.skillsLibraryDir, "failure-reviewer");
    const sharedSkill = join(paths.userSkillsDir, "failure-reviewer");
    const targetSkill = join(paths.codexHome, "skills", "failure-reviewer");
    await mkdir(librarySkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(librarySkill, "SKILL.md"), "---\nname: failure-reviewer\n---\n");
    await writeFile(join(sharedSkill, "SKILL.md"), "---\nname: failure-reviewer\n---\n");
    const assetPolicyPath = join(paths.profilesDir, "daily-coding", "assets.json");
    const assetPolicy = JSON.parse(await readFile(assetPolicyPath, "utf8")) as {
      skillRefs: Array<{ libraryId: string; targetName: string }>;
    };
    assetPolicy.skillRefs.push({
      libraryId: "failure-reviewer",
      targetName: "failure-reviewer"
    });
    await writeFile(assetPolicyPath, JSON.stringify(assetPolicy));

    const preview = await failingService.previewProfile("daily-coding");
    expect((await failingService.applyProfile("daily-coding", preview.id)).ok).toBe(true);
    await expect(
      failingService.completeSharedSkillMigration({
        skillKey: "failure-reviewer",
        libraryId: "failure-reviewer",
        sharedPaths: [sharedSkill],
        consumerTargetIds: ["codex"]
      })
    ).rejects.toThrow("migration failed and was restored");

    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).resolves.toContain(
      "name: failure-reviewer"
    );
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8")).rejects.toThrow();
    expect((await failingService.listTargetStates())[0]?.sharedSkillPreparations).toHaveLength(1);
  });

  it("migrates legacy AgentEnv-owned Codex Skills out of the compatibility directory", async () => {
    const { paths, service } = await makeEnv();
    const legacySkill = join(paths.userSkillsDir, "agentenv-daily-coding-example-skill");
    const dedicatedSkill = join(paths.codexHome, "skills", "agentenv-daily-coding-example-skill");
    await mkdir(legacySkill, { recursive: true });
    await writeFile(join(legacySkill, "SKILL.md"), "---\nname: example\n---\n");
    await writeFile(
      join(legacySkill, ".agentenv-owner.json"),
      `${JSON.stringify({
        owner: "agentenv-manager",
        profileId: "daily-coding",
        targetId: "codex",
        kind: "skill",
        source: "skills/example-skill"
      }, null, 2)}\n`
    );

    const preview = await service.previewProfile("daily-coding");
    expect(preview.resourceChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: legacySkill, action: "remove", kind: "skill" }),
      expect.objectContaining({ path: dedicatedSkill, action: "install", kind: "skill" })
    ]));
    expect((await service.applyProfile("daily-coding", preview.id)).ok).toBe(true);

    await expect(readFile(join(legacySkill, "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(dedicatedSkill, "SKILL.md"), "utf8")).resolves.toContain("name: example");
  });

  it("keeps a Target visible when recovery is required without an active Profile", async () => {
    const { paths, service } = await makeEnv();
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(
      join(paths.targetStatesDir, "codex.json"),
      JSON.stringify({
        managedConfigKeys: [],
        managedMcpNames: [],
        managedResources: [],
        recoveryRequired: {
          operation: "rollback",
          error: "Restore could not complete",
          occurredAt: "2026-07-12T00:00:00.000Z"
        }
      })
    );

    await expect(service.listTargetStates()).resolves.toEqual([
      expect.objectContaining({
        targetId: "codex",
        lifecycleStatus: "recovery-required",
        lifecycleReason: "Restore could not complete"
      })
    ]);
  });

  it("adapts portable profile resources when applying to another target", async () => {
    const { paths, service } = await makeEnv();
    const openCodeDir = join(paths.homeDir, ".config", "opencode");
    const openCodeInstructions = join(openCodeDir, "AGENTS.md");
    const openCodeConfig = join(openCodeDir, "opencode.jsonc");
    const openCodeSkill = join(openCodeDir, "skills", "agentenv-daily-coding-example-skill");
    await mkdir(openCodeDir, { recursive: true });
    await writeFile(openCodeInstructions, "# Old OpenCode agents\n");
    await writeFile(openCodeConfig, "{}\n");

    const preview = await service.previewProfile("daily-coding", "opencode");
    expect(preview.targetId).toBe("opencode");
    expect(preview.warnings).toContain(
      "codex Advanced config is Agent-specific and is not applied to OpenCode"
    );
    expect(preview.effectivePayload).toMatchObject({
      instructions: 1,
      skills: 1,
      mcpServers: 1,
      nativeConfig: 0
    });
    expect(preview.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "config" }),
        expect.objectContaining({ kind: "setting" })
      ])
    );
    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      errors: ["Compatibility omissions must be acknowledged before Apply"]
    });
    expect(preview.changes.map(({ path }) => path)).toContain(openCodeInstructions);
    expect(preview.resourceChanges).toContainEqual(
      expect.objectContaining({ path: openCodeSkill, action: "install" })
    );

    expect(
      (await service.applyProfile("daily-coding", preview.id, { allowOmissions: true })).ok
    ).toBe(true);
    await expect(readFile(openCodeInstructions, "utf8")).resolves.toBe("# New agents\n");
    await expect(readFile(openCodeConfig, "utf8")).resolves.toContain("shared_docs");
    await expect(readFile(join(openCodeSkill, "SKILL.md"), "utf8")).resolves.toContain(
      "name: example"
    );
  });

  it("blocks apply when a resource changes after preview", async () => {
    const { paths, service } = await makeEnv();
    const targetSkill = join(paths.codexHome, "skills", "agentenv-daily-coding-example-skill");
    const preview = await service.previewProfile("daily-coding");

    await mkdir(targetSkill, { recursive: true });
    await writeFile(join(targetSkill, "SKILL.md"), "# Added outside AgentEnv\n");

    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result).toEqual({
      ok: false,
      errors: [`Live resource changed after preview: ${targetSkill}`]
    });
  });

  it("blocks apply when the profile changes after preview", async () => {
    const { paths, service } = await makeEnv();
    const preview = await service.previewProfile("daily-coding");
    await writeFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "# Changed profile\n");

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      errors: ["Profile changed after preview; review the latest version"]
    });
  });

  it("blocks apply when a profile resource source changes after preview", async () => {
    const { paths, service } = await makeEnv();
    const sourceSkill = join(
      paths.profilesDir,
      "daily-coding",
      "skills",
      "example-skill",
      "SKILL.md"
    );
    const preview = await service.previewProfile("daily-coding");
    await writeFile(sourceSkill, "# Changed resource source\n");

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      errors: [`Resource source changed after preview: ${dirname(sourceSkill)}`]
    });
  });

  it("blocks apply when a referenced library resource changes after preview", async () => {
    const { paths, service } = await makeEnv();
    const preview = await service.previewProfile("daily-coding");
    await writeFile(
      join(paths.appDataRoot, "mcp-library.json"),
      JSON.stringify([
        {
          id: "shared-docs",
          name: "Shared Docs",
          transport: "http",
          url: "https://example.com/changed/mcp"
        }
      ])
    );

    await expect(service.applyProfile("daily-coding", preview.id)).resolves.toEqual({
      ok: false,
      errors: ["Library resources changed after preview; review the latest versions"]
    });
  });

  it("refuses stale previews without writing", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");

    const preview = await service.previewProfile("daily-coding");
    await writeFile(paths.globalAgentsPath, "# Changed elsewhere\n");
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result).toEqual({
      ok: false,
      errors: [`Live file changed after preview: ${paths.globalAgentsPath}`]
    });
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Changed elsewhere\n"
    );
  });

  it("blocks preview when an AgentEnv-managed file was changed outside the app after apply", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');

    const firstPreview = await service.previewProfile("daily-coding");
    const firstApply = await service.applyProfile("daily-coding", firstPreview.id);
    expect(firstApply.ok).toBe(true);

    await writeFile(paths.globalAgentsPath, "# Changed outside AgentEnv\n");
    const changedState = (await service.listTargetStates()).find(
      ({ targetId }) => targetId === "codex"
    );
    expect(changedState?.errorCount).toBe(1);
    const secondPreview = await service.previewProfile("daily-coding");

    expect(secondPreview.errors).toContain(
      `External changes detected in AgentEnv-managed instructions instructions: ${paths.globalAgentsPath}`
    );
  });

  it("backs up and replaces managed drift only after explicit approval", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');

    const firstPreview = await service.previewProfile("daily-coding");
    expect((await service.applyProfile("daily-coding", firstPreview.id)).ok).toBe(true);

    await writeFile(paths.globalAgentsPath, "# Changed outside AgentEnv\n");
    const driftPreview = await service.previewProfile("daily-coding");
    expect((await service.applyProfile("daily-coding", driftPreview.id)).ok).toBe(false);

    const result = await service.applyProfile("daily-coding", driftPreview.id, {
      allowManagedDrift: true
    });
    expect(result.ok).toBe(true);
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe("# New agents\n");
    if (result.ok) {
      const backup = await createBackupStore(paths).readBackup(result.backupId);
      expect(backup).toMatchObject({
        operation: "apply",
        targetId: "codex",
        profileId: "daily-coding",
        profileName: "Daily Coding"
      });
      const instructionsEntry = backup.entries.find(
        (entry) => entry.sourcePath === paths.globalAgentsPath
      );
      await expect(readFile(instructionsEntry?.backupPath ?? "", "utf8")).resolves.toBe(
        "# Changed outside AgentEnv\n"
      );
    }
  });

  it("backs up and replaces a managed Skill that an external tool rewrote", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');

    const firstPreview = await service.previewProfile("daily-coding");
    expect((await service.applyProfile("daily-coding", firstPreview.id)).ok).toBe(true);

    const targetSkillDir = join(
      paths.codexHome,
      "skills",
      "agentenv-daily-coding-example-skill"
    );
    await rm(targetSkillDir, { recursive: true, force: true });
    await rm(`${targetSkillDir}.agentenv-owner.json`, { force: true });
    await mkdir(targetSkillDir, { recursive: true });
    await writeFile(
      join(targetSkillDir, "SKILL.md"),
      "---\nname: example\n---\n\nUpdated by another tool.\n"
    );

    const driftPreview = await service.previewProfile("daily-coding");
    expect(driftPreview.errors).toEqual([
      `External changes detected in AgentEnv-managed skill agentenv-daily-coding-example-skill: ${targetSkillDir}`
    ]);
    expect((await service.applyProfile("daily-coding", driftPreview.id)).ok).toBe(false);

    const result = await service.applyProfile("daily-coding", driftPreview.id, {
      allowManagedDrift: true
    });
    expect(result.ok).toBe(true);
    await expect(readFile(join(targetSkillDir, "SKILL.md"), "utf8")).resolves.toBe(
      "---\nname: example\n---\n"
    );
    if (result.ok) {
      const backup = await createBackupStore(paths).readBackup(result.backupId);
      const skillEntry = backup.entries.find((entry) => entry.sourcePath === targetSkillDir);
      await expect(
        readFile(join(skillEntry?.backupPath ?? "", "SKILL.md"), "utf8")
      ).resolves.toContain("Updated by another tool.");
    }
  });

  it("keeps newly added unmanaged skills visible as warnings without blocking preview", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');

    const firstPreview = await service.previewProfile("daily-coding");
    const firstApply = await service.applyProfile("daily-coding", firstPreview.id);
    expect(firstApply.ok).toBe(true);

    const manualSkillDir = join(paths.userSkillsDir, "manual-reviewer");
    await mkdir(manualSkillDir, { recursive: true });
    await writeFile(
      join(manualSkillDir, "SKILL.md"),
      "---\nname: Manual Reviewer\ndescription: Added outside AgentEnv.\n---\n"
    );

    const secondPreview = await service.previewProfile("daily-coding");

    expect(secondPreview.errors).toEqual([]);
    expect(secondPreview.warnings).toContain(`Unmanaged local skill kept: ${manualSkillDir}`);
  });

  it("reports missing owned asset sources during preview", async () => {
    const { paths, service } = await makeEnv();
    await rm(join(paths.profilesDir, "daily-coding", "skills", "example-skill"), {
      recursive: true,
      force: true
    });

    const preview = await service.previewProfile("daily-coding");

    expect(preview.errors[0]).toContain("Owned skill source does not exist");
  });

  it("allows an empty managed instructions surface to clear the target", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "   \n");

    const preview = await service.previewProfile("daily-coding");

    expect(preview.errors).not.toContain("Managed instructions are empty");
  });

  it("requires explicit backup replacement for non-AgentEnv skill target conflicts", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    const targetSkillDir = join(
      paths.codexHome,
      "skills",
      "agentenv-daily-coding-example-skill"
    );
    await mkdir(targetSkillDir, {
      recursive: true
    });
    await writeFile(
      join(targetSkillDir, "SKILL.md"),
      "---\nname: existing local copy\n---\n"
    );

    const preview = await service.previewProfile("daily-coding");
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(preview.replaceableTargetPaths).toEqual([targetSkillDir]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Skill target already exists");
    }
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Old agents\n"
    );

    const replacement = await service.applyProfile("daily-coding", preview.id, {
      allowUnmanagedSkillReplacement: true
    });

    expect(replacement.ok).toBe(true);
    if (!replacement.ok) {
      throw new Error(replacement.errors.join("\n"));
    }
    await expect(readFile(join(targetSkillDir, "SKILL.md"), "utf8")).resolves.toContain(
      "name: example"
    );
    await expect(
      readFile(join(targetSkillDir, ".agentenv-owner.json"), "utf8")
    ).resolves.toContain('"owner": "agentenv-manager"');
    const backup = await createBackupStore(paths).readBackup(replacement.backupId);
    const skillEntry = backup.entries.find((entry) => entry.sourcePath === targetSkillDir);
    await expect(
      readFile(join(skillEntry?.backupPath ?? "", "SKILL.md"), "utf8")
    ).resolves.toContain("name: existing local copy");
  });

  it("identifies Skills CLI ownership when it blocks a Profile skill", async () => {
    const { paths, service } = await makeEnv();
    const targetDir = join(paths.codexHome, "skills", "agentenv-daily-coding-example-skill");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), "---\nname: External copy\n---\n");
    await writeFile(
      join(paths.homeDir, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          "agentenv-daily-coding-example-skill": {
            sourceType: "github",
            sourceUrl: "https://github.com/acme/skills",
            ref: "main",
            skillPath: "skills/example/SKILL.md",
            skillFolderHash: "tree-sha"
          }
        }
      })
    );

    const preview = await service.previewProfile("daily-coding");

    expect(preview.errors).toContain(
      `Cannot install agentenv-daily-coding-example-skill because Skills CLI manages the existing Skill at ${targetDir}. Remove it from Skills CLI, then rescan before applying this Profile.`
    );
    expect(preview.errors.some((error) => error.includes("not AgentEnv-owned"))).toBe(false);
    expect(preview.replaceableTargetPaths).toEqual([]);
  });

  it("reports ignored unmanaged skill conflicts during profile preview", async () => {
    const { paths, service } = await makeEnv();
    await mkdir(join(paths.codexHome, "skills", "agentenv-daily-coding-example-skill"), {
      recursive: true
    });
    await writeFile(
      join(paths.codexHome, "skills", "agentenv-daily-coding-example-skill", "SKILL.md"),
      "---\nname: Local copy\ndescription: Keep unmanaged.\n---\n"
    );
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(
      join(paths.appDataRoot, "skill-cleanup-ignore-rules.json"),
      JSON.stringify([
        {
          id: "ignore-agentenv-daily-coding-example-skill",
          scope: "group",
          skillKey: "agentenv-daily-coding-example-skill",
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z"
        }
      ])
    );

    const preview = await service.previewProfile("daily-coding");

    expect(preview.errors).toContain(
      `Cannot install agentenv-daily-coding-example-skill because an ignored unmanaged skill already exists at ${join(
        paths.codexHome,
        "skills",
        "agentenv-daily-coding-example-skill"
      )}`
    );
  });

  it("rolls back files from a backup", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");

    const preview = await service.previewProfile("daily-coding");
    const applyResult = await service.applyProfile("daily-coding", preview.id);
    expect(applyResult.ok).toBe(true);

    const backups = await createBackupStore(paths).listBackups();
    const rollbackPreview = await service.previewRollback(backups[0]?.id ?? "");
    expect(rollbackPreview.changes[0]?.after).toBe("# Old agents\n");

    const rollbackResult = await service.rollback(backups[0]?.id ?? "");

    expect(rollbackResult.ok).toBe(true);
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Old agents\n"
    );
  });

  it("rejects a rollback when target files change after preview", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");

    const preview = await service.previewProfile("daily-coding");
    const applyResult = await service.applyProfile("daily-coding", preview.id);
    expect(applyResult.ok).toBe(true);

    const backups = await createBackupStore(paths).listBackups();
    const backupId = backups[0]?.id ?? "";
    await service.previewRollback(backupId);
    await writeFile(paths.globalAgentsPath, "# External edit after preview\n");

    const rollbackResult = await service.rollback(backupId);

    expect(rollbackResult.ok).toBe(false);
    if (!rollbackResult.ok) {
      expect(rollbackResult.errors[0]).toContain("changed after the rollback preview");
    }
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# External edit after preview\n"
    );
  });

  it("stops managing while keeping the currently applied Target environment", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Before takeover\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');
    const applyPreview = await service.previewProfile("daily-coding");
    expect((await service.applyProfile("daily-coding", applyPreview.id)).ok).toBe(true);

    const stopPreview = await service.previewStopManaging("codex", "keep-current");
    expect(stopPreview.errors).toEqual([]);
    expect(stopPreview.managedResourceCount).toBeGreaterThan(0);
    const result = await service.stopManaging(stopPreview.id);

    expect(result.ok).toBe(true);
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe("# New agents\n");
    await expect(
      readFile(
        join(paths.codexHome, "skills", "agentenv-daily-coding-example-skill", ".agentenv-owner.json"),
        "utf8"
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(service.listTargetStates()).resolves.toEqual([]);
  });

  it("materializes a whole-directory Skill link when stopping management", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Before takeover\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');
    const applyPreview = await service.previewProfile("daily-coding");
    expect((await service.applyProfile("daily-coding", applyPreview.id)).ok).toBe(true);

    const targetSkill = join(
      paths.codexHome,
      "skills",
      "agentenv-daily-coding-example-skill"
    );
    const canonicalSkill = join(paths.appDataRoot, "test-library", "example-skill");
    await mkdir(dirname(canonicalSkill), { recursive: true });
    await cp(targetSkill, canonicalSkill, { recursive: true });
    const marker = await readFile(join(targetSkill, ".agentenv-owner.json"), "utf8");
    await rm(targetSkill, { recursive: true, force: true });
    await symlink(canonicalSkill, targetSkill, "dir");
    await writeFile(`${targetSkill}.agentenv-owner.json`, marker, "utf8");

    const stopPreview = await service.previewStopManaging("codex", "keep-current");
    expect((await service.stopManaging(stopPreview.id)).ok).toBe(true);

    expect((await lstat(targetSkill)).isSymbolicLink()).toBe(false);
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8")).resolves.toContain(
      "name: example"
    );
    await expect(readFile(`${targetSkill}.agentenv-owner.json`, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("stops managing by restoring the Target environment captured before takeover", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Before takeover\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');
    const applyPreview = await service.previewProfile("daily-coding");
    expect((await service.applyProfile("daily-coding", applyPreview.id)).ok).toBe(true);

    const stopPreview = await service.previewStopManaging("codex", "restore-pre-takeover");
    expect(stopPreview.errors).toEqual([]);
    expect(stopPreview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: paths.globalAgentsPath, after: "# Before takeover\n" })
      ])
    );
    const result = await service.stopManaging(stopPreview.id);

    expect(result.ok).toBe(true);
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Before takeover\n"
    );
    await expect(service.listTargetStates()).resolves.toEqual([]);
  });

  it("applies Codex profiles without modifying auth.json", async () => {
    const { paths, service } = await makeEnv();
    const authPath = join(paths.codexHome, "auth.json");
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');
    await writeFile(authPath, '{"token":"keep-me"}\n');

    const preview = await service.previewProfile("daily-coding");
    expect(Object.keys(preview.liveFingerprints)).not.toContain(authPath);
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result.ok).toBe(true);
    await expect(readFile(authPath, "utf8")).resolves.toBe('{"token":"keep-me"}\n');
  });

  it("restores already-written files when target asset apply fails", async () => {
    const { paths } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');
    const baseProfileStore = createProfileStore({
      appDataRoot: paths.appDataRoot,
      codexHome: paths.codexHome,
      userSkillsDir: paths.userSkillsDir
    });
    let recoveryMarkerWasVisible = false;
    const failingAdapter: AgentTargetAdapter = {
      descriptor: {
        id: "codex",
        name: "Failing Codex",
        description: "Test adapter",
        instructionsLabel: "AGENTS.md",
        configLabel: "config.toml",
        configLanguage: "toml",
        realWritesEnabled: true,
        capabilities: {
          instructions: true,
          skills: true,
          mcpTransports: ["stdio", "http", "sse"],
          agentFormat: "codex",
          disabledSkillPaths: true
        }
      },
      createTargetPaths: () => ({
        targetId: "codex",
        configDir: paths.codexHome,
        instructionsPath: paths.globalAgentsPath,
        configPath: paths.codexConfigPath,
        skillsDir: paths.userSkillsDir
      }),
      createDefaultProfile: () => {
        throw new Error("not used");
      },
      captureProfile: () => {
        throw new Error("not used");
      },
      readProfileFiles: () => {
        throw new Error("not used");
      },
      writeProfileFiles: () => {
        throw new Error("not used");
      },
      materializeMcpRefs: (profile) => profile,
      createPreview: async () => ({
        warnings: [],
        errors: [],
        changes: [
          {
            path: paths.globalAgentsPath,
            before: "# Old agents\n",
            after: "# New agents\n",
            diff: ""
          }
        ],
        liveFingerprints: {},
        targetState: { managedConfigKeys: [], managedMcpNames: [] }
      }),
      validateAssets: async () => [],
      getAssetBackupPaths: async () => [
        join(paths.userSkillsDir, "agentenv-daily-coding-example-skill")
      ],
      applyAssets: async () => {
        const state = JSON.parse(
          await readFile(join(paths.targetStatesDir, "codex.json"), "utf8")
        );
        recoveryMarkerWasVisible =
          state.recoveryRequired?.operation === "apply" &&
          typeof state.recoveryRequired?.backupId === "string";
        throw new Error("asset copy exploded");
      }
    };
    const service = createActivationService({
      paths,
      profileStore: baseProfileStore,
      targetRegistry: createTargetRegistry([failingAdapter])
    });

    const preview = await service.previewProfile("daily-coding");
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result).toEqual({
      ok: false,
      errors: ["Failed to apply profile; restored backup: asset copy exploded"]
    });
    expect(recoveryMarkerWasVisible).toBe(true);
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Old agents\n"
    );
  });
});
