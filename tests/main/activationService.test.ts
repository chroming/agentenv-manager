import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
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
  const service = createActivationService({ paths, profileStore });

  return { paths, service };
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("activation service", () => {
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
      "codex Advanced config is target-specific and is not applied to OpenCode"
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
      errors: ["Cross-target omissions must be acknowledged before Apply"]
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

  it("reports empty managed instructions during preview", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "   \n");

    const preview = await service.previewProfile("daily-coding");

    expect(preview.errors).toContain("Managed instructions are empty");
  });

  it("refuses non-AgentEnv skill target conflicts without writing", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await mkdir(join(paths.codexHome, "skills", "agentenv-daily-coding-example-skill"), {
      recursive: true
    });

    const preview = await service.previewProfile("daily-coding");
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Skill target already exists");
    }
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Old agents\n"
    );
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
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Old agents\n"
    );
  });
});
