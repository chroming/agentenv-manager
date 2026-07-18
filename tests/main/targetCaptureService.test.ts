import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createMcpLibraryStore } from "../../src/main/mcpLibraryStore";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createTargetCaptureService } from "../../src/main/targetCaptureService";
import type { TargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { TargetInfo } from "../../src/shared/types";

let root = "";

const installedTargetDiscovery = (id = "opencode"): TargetDiscoveryService => ({
  listTargets: async () => [{ id, health: { executableFound: true } } as TargetInfo]
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("target capture service", () => {
  it("blocks capture when the Target command is missing", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-missing-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "app-data");
    const paths = createPaths({ appDataRoot, homeDir });
    const targetRegistry = createTargetRegistry();
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const service = createTargetCaptureService({
      paths,
      profileStore,
      targetRegistry,
      skillLibraryStore,
      mcpLibraryStore,
      targetDiscoveryService: {
        listTargets: async () => [
          { id: "opencode", health: { executableFound: false } } as TargetInfo
        ]
      }
    });

    await expect(service.previewTarget("opencode")).rejects.toThrow("Target command is not installed");
    await expect(profileStore.listProfiles()).resolves.toEqual([]);
  });

  it("captures an OpenCode profile without changing the Target", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "app-data");
    const paths = createPaths({ appDataRoot, homeDir });
    const targetRegistry = createTargetRegistry();
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const activationService = createActivationService({
      paths,
      profileStore,
      targetRegistry,
      settingsStore,
      skillLibraryStore,
      mcpLibraryStore
    });
    const service = createTargetCaptureService({
      paths,
      profileStore,
      targetRegistry,
      skillLibraryStore,
      mcpLibraryStore,
      targetDiscoveryService: installedTargetDiscovery()
    });

    const targetDir = join(homeDir, ".config", "opencode");
    const privateSkill = join(targetDir, "skills", "review-workflow");
    const agentDir = join(targetDir, "agents", "reviewer");
    await mkdir(privateSkill, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n", "utf8");
    await writeFile(
      join(targetDir, "opencode.jsonc"),
      `${JSON.stringify({
        username: "local-user",
        mcp: {
          docs: {
            type: "local",
            command: ["node", "--version"],
            environment: { API_TOKEN: "{env:API_TOKEN}" }
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      join(privateSkill, "SKILL.md"),
      "---\nname: review-workflow\ndescription: Review changes.\n---\n\n# Review\n",
      "utf8"
    );
    await writeFile(join(agentDir, "agent.md"), "# Reviewer\n", "utf8");

    const preview = await service.previewTarget("opencode");
    expect(preview.errors).toEqual([]);
    expect(preview.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "skill", id: "review-workflow", action: "import" }),
        expect.objectContaining({ kind: "mcp", id: "docs", action: "import" }),
        expect.objectContaining({ kind: "agent", id: "reviewer", action: "include" })
      ])
    );

    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "OpenCode Existing"
    });
    expect(result.importedSkillCount).toBe(1);
    expect(result.importedMcpCount).toBe(1);
    expect(result.profile.assetPolicy.skillRefs).toEqual([
      { libraryId: "review-workflow", targetName: "review-workflow" }
    ]);
    expect(result.profile.assetPolicy.mcpRefs).toEqual([
      { libraryId: "docs", targetName: "docs" }
    ]);
    await expect(readFile(join(privateSkill, "SKILL.md"), "utf8")).resolves.toContain("# Review");
    await expect(readFile(join(privateSkill, ".agentenv-owner.json"), "utf8"))
      .rejects.toThrow();
    await expect(
      readFile(join(paths.skillsLibraryDir, "review-workflow", "SKILL.md"), "utf8")
    ).resolves.toContain("# Review");
    await expect(readFile(join(agentDir, "agent.md"), "utf8")).resolves.toContain("Reviewer");
    await expect(activationService.listTargetStates()).resolves.toEqual([]);
  });

  it("rejects stale capture previews without importing resources", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-stale-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "app-data");
    const paths = createPaths({ appDataRoot, homeDir });
    const targetRegistry = createTargetRegistry();
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const service = createTargetCaptureService({
      paths,
      profileStore,
      targetRegistry,
      skillLibraryStore,
      mcpLibraryStore,
      targetDiscoveryService: installedTargetDiscovery()
    });
    const targetDir = join(homeDir, ".config", "opencode");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Before\n");
    await writeFile(join(targetDir, "opencode.jsonc"), "{}\n");
    const preview = await service.previewTarget("opencode");
    await writeFile(join(targetDir, "AGENTS.md"), "# Changed\n");

    await expect(
      service.createFromTarget({ previewId: preview.id, name: "Stale" })
    ).rejects.toThrow("Target changed after capture preview");
    await expect(profileStore.listProfiles()).resolves.toEqual([]);
  });

  it("keeps ignored runtime skills in place and excludes them from the new Profile", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-ignored-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "app-data");
    const paths = createPaths({ appDataRoot, homeDir });
    const targetRegistry = createTargetRegistry();
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const service = createTargetCaptureService({
      paths,
      profileStore,
      targetRegistry,
      skillLibraryStore,
      mcpLibraryStore,
      targetDiscoveryService: installedTargetDiscovery()
    });
    const targetDir = join(homeDir, ".config", "opencode");
    const ignoredDir = join(paths.userSkillsDir, "private-local");
    await mkdir(ignoredDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(ignoredDir, "SKILL.md"), "---\nname: Private Local\n---\n", "utf8");
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing\n", "utf8");
    await writeFile(join(targetDir, "opencode.jsonc"), "{}\n", "utf8");
    await skillLibraryStore.ignoreSkillGroup("private-local");

    const preview = await service.previewTarget("opencode");
    expect(preview.resources).toContainEqual(
      expect.objectContaining({
        kind: "skill",
        id: "private-local",
        action: "exclude",
        detail: "Ignored; kept in its current location"
      })
    );

    const result = await service.createFromTarget({ previewId: preview.id, name: "Without Private" });
    expect(result.profile.assetPolicy.skillRefs).toEqual([]);
    await expect(readFile(join(ignoredDir, "SKILL.md"), "utf8")).resolves.toContain("Private Local");
  });

  it("captures Claude without claiming empty instructions or Skills CLI resources", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-claude-external-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "app-data");
    const paths = createPaths({ appDataRoot, homeDir });
    const targetRegistry = createTargetRegistry();
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const activationService = createActivationService({
      paths,
      profileStore,
      targetRegistry,
      settingsStore,
      skillLibraryStore,
      mcpLibraryStore
    });
    const service = createTargetCaptureService({
      paths,
      profileStore,
      targetRegistry,
      skillLibraryStore,
      mcpLibraryStore,
      targetDiscoveryService: installedTargetDiscovery("claude-code")
    });
    const claudeDir = join(homeDir, ".claude");
    const externalSkillDir = join(claudeDir, "skills", "open-browser-use");
    await mkdir(externalSkillDir, { recursive: true });
    await mkdir(join(homeDir, ".agents"), { recursive: true });
    await writeFile(
      join(externalSkillDir, "SKILL.md"),
      "---\nname: open-browser-use\ndescription: Browser workflow.\n---\n\n# Browser\n"
    );
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ env: { MODE: "review" } }));
    await writeFile(
      join(homeDir, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          "open-browser-use": {
            sourceType: "github",
            source: "example/open-browser-use",
            skillPath: "skills/open-browser-use/SKILL.md"
          }
        }
      })
    );

    const capture = await service.previewTarget("claude-code");
    expect(capture.resources).toContainEqual(
      expect.objectContaining({
        kind: "skill",
        id: "open-browser-use",
        action: "exclude",
        detail: "Managed by Skills CLI; remains unchanged"
      })
    );
    const result = await service.createFromTarget({
      previewId: capture.id,
      name: "Claude Existing"
    });
    expect(result.profile.assetPolicy.skillRefs).toEqual([]);
    expect(result.importedSkillCount).toBe(0);

    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(
      join(paths.targetStatesDir, "claude-code.json"),
      JSON.stringify({
        activeProfileId: "legacy-profile",
        managedConfigKeys: [],
        managedMcpNames: [],
        managedResources: []
      })
    );
    const applyPreview = await activationService.previewProfile(result.profile.id, "claude-code");
    expect(applyPreview.errors).toEqual([]);
    expect(applyPreview.errors.join("\n")).not.toContain("Instructions are empty");
    expect(applyPreview.errors.join("\n")).not.toContain("Config key env");
    expect(applyPreview.errors.join("\n")).not.toContain("Skills CLI manages");
  });

  it("leaves duplicate source Skills unchanged across Target captures", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-compatibility-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "app-data");
    const paths = createPaths({ appDataRoot, homeDir });
    const targetRegistry = createTargetRegistry();
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const targetDiscoveryService: TargetDiscoveryService = {
      listTargets: async () => [
        { id: "opencode", health: { executableFound: true } } as TargetInfo,
        { id: "codex", health: { executableFound: true } } as TargetInfo
      ]
    };
    const service = createTargetCaptureService({
      paths,
      profileStore,
      targetRegistry,
      skillLibraryStore,
      mcpLibraryStore,
      targetDiscoveryService
    });
    const sharedSkill = join(paths.userSkillsDir, "shared-review");
    const openCodeDir = join(homeDir, ".config", "opencode");
    await mkdir(sharedSkill, { recursive: true });
    await mkdir(openCodeDir, { recursive: true });
    await mkdir(paths.codexHome, { recursive: true });
    await writeFile(
      join(sharedSkill, "SKILL.md"),
      "---\nname: shared-review\ndescription: Shared review.\n---\n\n# Shared\n"
    );
    await writeFile(join(openCodeDir, "AGENTS.md"), "# OpenCode\n");
    await writeFile(join(openCodeDir, "opencode.jsonc"), "{}\n");
    await writeFile(paths.globalAgentsPath, "# Codex\n");
    await writeFile(paths.codexConfigPath, "");

    const openCodePreview = await service.previewTarget("opencode");
    expect(openCodePreview.resources).toContainEqual(expect.objectContaining({
      kind: "skill",
      id: "shared-review",
      action: "import"
    }));
    await service.createFromTarget({ previewId: openCodePreview.id, name: "OpenCode Imported" });
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).resolves.toContain("# Shared");
    await expect(
      readFile(join(openCodeDir, "skills", "shared-review", "SKILL.md"), "utf8")
    ).rejects.toThrow();

    const codexPreview = await service.previewTarget("codex");
    await service.createFromTarget({ previewId: codexPreview.id, name: "Codex Imported" });

    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).resolves.toContain("# Shared");
    await expect(
      readFile(join(paths.codexHome, "skills", "shared-review", "SKILL.md"), "utf8")
    ).rejects.toThrow();
    await expect(
      readFile(join(openCodeDir, "skills", "shared-review", "SKILL.md"), "utf8")
    ).rejects.toThrow();
  });

  it("keeps Target-specific Skill deployments isolated", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-shared-skills-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "app-data");
    const paths = createPaths({ appDataRoot, homeDir });
    const targetRegistry = createTargetRegistry();
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const activationService = createActivationService({
      paths,
      profileStore,
      targetRegistry,
      settingsStore,
      skillLibraryStore,
      mcpLibraryStore
    });
    const source = join(root, "source", "shared-review");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: shared-review\ndescription: Shared review.\n---\n\n# Shared\n"
    );
    await skillLibraryStore.importSkill({ sourcePath: source, id: "shared-review" });
    const codex = await profileStore.saveProfile({
      manifest: {
        id: "codex-shared",
        targetId: "codex",
        name: "Codex Shared",
        description: "",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      },
      instructions: "# Codex\n",
      configText: "",
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [{ libraryId: "shared-review", targetName: "shared-review" }],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    });
    const opencode = await profileStore.saveProfile({
      manifest: {
        id: "opencode-empty",
        targetId: "opencode",
        name: "OpenCode Empty",
        description: "",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      },
      instructions: "# OpenCode\n",
      configText: "{}\n",
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    });
    const codexPreview = await activationService.previewProfile(codex.id);
    expect(codexPreview.errors).toEqual([]);
    expect((await activationService.applyProfile(codex.id, codexPreview.id)).ok).toBe(true);
    const openCodePreview = await activationService.previewProfile(opencode.id);
    expect(openCodePreview.errors).toEqual([]);
    expect(openCodePreview.resourceChanges).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "remove", name: "shared-review" })])
    );
    expect((await activationService.applyProfile(opencode.id, openCodePreview.id)).ok).toBe(true);
    await expect(
      readFile(join(paths.codexHome, "skills", "shared-review", "SKILL.md"), "utf8")
    ).resolves.toContain("# Shared");
    await expect(
      readFile(join(paths.homeDir, ".config", "opencode", "skills", "shared-review", "SKILL.md"), "utf8")
    ).rejects.toThrow();
    await expect(activationService.listTargetStates()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "codex", lifecycleStatus: "applied" }),
        expect.objectContaining({ targetId: "opencode", lifecycleStatus: "applied" })
      ])
    );
  });
});
