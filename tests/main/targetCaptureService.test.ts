import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createInstructionLibraryStore } from "../../src/main/instructionLibraryStore";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createTargetCaptureService } from "../../src/main/targetCaptureService";
import { createRuntimeDiagnostics } from "../../src/main/runtimeDiagnostics";
import type { TargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { TargetInfo } from "../../src/shared/types";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const discovery = (id: string, installed = true): TargetDiscoveryService => ({
  probeSupportedTargets: async () => [],
  listTargets: async () => [{
    id,
    health: { executableFound: installed, installationFound: installed }
  } as TargetInfo]
});

const setup = async (targetId: string, installed = true) => {
  root = await mkdtemp(join(tmpdir(), "agentenv-capture-v2-"));
  const homeDir = join(root, "home");
  const appDataRoot = join(root, "app-data");
  const paths = createPaths({ appDataRoot, homeDir });
  const targetRegistry = createTargetRegistry();
  const settingsStore = createSettingsStore(paths);
  const instructionLibraryStore = createInstructionLibraryStore(paths);
  const profileStore = createProfileStore(
    { appDataRoot, homeDir },
    targetRegistry,
    instructionLibraryStore
  );
  const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
  const diagnostics = createRuntimeDiagnostics({
    directory: join(root, "logs"),
    homeDir,
    appVersion: "0.1.0",
    packaged: false,
    platform: "darwin",
    arch: "arm64",
    osVersion: "26.0",
    locale: "en-US"
  });
  const service = createTargetCaptureService({
    paths,
    profileStore,
    targetRegistry,
    skillLibraryStore,
    targetDiscoveryService: discovery(targetId, installed),
    diagnostics
  });
  return {
    homeDir,
    paths,
    profileStore,
    skillLibraryStore,
    targetRegistry,
    settingsStore,
    service,
    diagnostics
  };
};

describe("target capture service v2", () => {
  it("blocks capture when the Agent command is missing", async () => {
    const { service, profileStore } = await setup("opencode", false);

    await expect(service.previewTarget("opencode")).rejects.toThrow(
      "Agent installation is not detected"
    );
    await expect(profileStore.listProfiles()).resolves.toEqual([]);
  });

  it("captures OpenCode Instructions, Skills, and controllable MCP state without changing it", async () => {
    const { homeDir, paths, service } = await setup("opencode");
    const targetDir = join(homeDir, ".config", "opencode");
    const skillDir = join(targetDir, "skills", "review-workflow");
    const agentDir = join(targetDir, "agents", "reviewer");
    await mkdir(skillDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n");
    await writeFile(join(targetDir, "opencode.jsonc"), JSON.stringify({
      theme: "dark",
      mcp: { docs: { type: "local", command: ["docs"], enabled: false } }
    }, null, 2));
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: review-workflow", "description: Review changes.", "---", "", "# Review", ""
    ].join("\n"));
    await writeFile(join(agentDir, "agent.md"), "# Reviewer\n");

    const preview = await service.previewTarget("opencode");

    expect(preview.suggestedName).toBe("OpenCode");
    expect(preview.errors).toEqual([]);
    expect(preview.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "instructions", action: "include" }),
      expect.objectContaining({ kind: "skill", id: "review-workflow", action: "import" }),
      expect.objectContaining({ kind: "mcp", id: "docs", action: "include" })
    ]));
    expect(preview.resources.some(({ kind }) => !["instructions", "skill", "mcp"].includes(kind)))
      .toBe(false);

    const result = await service.createFromTarget({ previewId: preview.id, name: "Existing" });

    expect(result.profile.manifest).toMatchObject({
      version: 2,
      preferredTargetId: "opencode",
      createdFromTargetId: "opencode"
    });
    expect(result.profile.resources.skills).toEqual([
      { libraryId: "review-workflow", targetName: "review-workflow", enabled: true }
    ]);
    expect(result.profile.resources.mcpByTarget.opencode).toEqual({
      mode: "manage",
      selections: [{ name: "docs", enabled: false }]
    });
    await expect(readFile(join(paths.skillsLibraryDir, "review-workflow", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    await expect(readFile(join(agentDir, "agent.md"), "utf8")).resolves.toBe("# Reviewer\n");
  });

  it("returns a review decision instead of blocking when active Skill copies differ", async () => {
    const { homeDir, service, diagnostics } = await setup("opencode");
    const preferredSkill = join(homeDir, ".config", "opencode", "skills", "review-helper");
    const sharedSkill = join(homeDir, ".agents", "skills", "review-helper");
    await mkdir(preferredSkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(
      join(preferredSkill, "SKILL.md"),
      "---\nname: review-helper\nversion: 2.0.0\n---\n# Preferred\n"
    );
    await writeFile(
      join(sharedSkill, "SKILL.md"),
      "---\nname: review-helper\nversion: 1.0.0\n---\n# Shared\n"
    );

    const preview = await service.previewTarget("opencode");

    expect(preview.errors).toEqual([]);
    expect(preview.issues).toHaveLength(1);
    expect(preview.issues[0]).toMatchObject({
      code: "conflicting-skill-copies",
      severity: "decision",
      skillName: "review-helper"
    });
    expect(preview.issues[0]?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: preferredSkill,
        version: "2.0.0",
        locationRole: "preferred-runtime"
      }),
      expect.objectContaining({
        path: sharedSkill,
        version: "1.0.0",
        shared: true
      })
    ]));
    expect(await diagnostics.readRecentEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "profiles:capture",
        phase: "inventory-reviewed",
        outcome: "decision-required",
        context: expect.objectContaining({
          targetId: "opencode",
          skillCount: 1,
          decisionCount: 1
        })
      }),
      expect.objectContaining({
        action: "profiles:capture",
        phase: "decision-required",
        outcome: "decision-required",
        context: expect.objectContaining({
          targetId: "opencode",
          skillName: "review-helper",
          candidateCount: 2
        })
      })
    ]));
  });

  it("captures the selected runtime Skill copy without modifying either active source", async () => {
    const { homeDir, paths, service } = await setup("opencode");
    const preferredSkill = join(homeDir, ".config", "opencode", "skills", "review-helper");
    const sharedSkill = join(homeDir, ".agents", "skills", "review-helper");
    await mkdir(preferredSkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    const preferredContent = "---\nname: review-helper\nversion: 2.0.0\n---\n# Preferred\n";
    const sharedContent = "---\nname: review-helper\nversion: 1.0.0\n---\n# Shared\n";
    await writeFile(join(preferredSkill, "SKILL.md"), preferredContent);
    await writeFile(join(sharedSkill, "SKILL.md"), sharedContent);
    const preview = await service.previewTarget("opencode");
    const issue = preview.issues[0]!;
    const preferredCandidate = issue.candidates.find((candidate) => candidate.path === preferredSkill)!;

    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "OpenCode captured",
      decisions: [{
        issueId: issue.id,
        action: "use-copy",
        candidateId: preferredCandidate.id
      }]
    });

    expect(result.profile.resources.skills).toContainEqual({
      libraryId: "review-helper",
      targetName: "review-helper",
      enabled: true
    });
    await expect(readFile(join(paths.skillsLibraryDir, "review-helper", "SKILL.md"), "utf8"))
      .resolves.toBe(preferredContent);
    await expect(readFile(join(preferredSkill, "SKILL.md"), "utf8"))
      .resolves.toBe(preferredContent);
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8"))
      .resolves.toBe(sharedContent);
  });

  it("keeps conflicting runtime copies outside AgentEnv without treating omission as removal", async () => {
    const { homeDir, paths, service } = await setup("opencode");
    const preferredSkill = join(homeDir, ".config", "opencode", "skills", "review-helper");
    const sharedSkill = join(homeDir, ".agents", "skills", "review-helper");
    await mkdir(preferredSkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(preferredSkill, "SKILL.md"), "---\nname: review-helper\n---\n# Preferred\n");
    await writeFile(join(sharedSkill, "SKILL.md"), "---\nname: review-helper\n---\n# Shared\n");
    const preview = await service.previewTarget("opencode");

    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "Keep runtime copies",
      decisions: [{
        issueId: preview.issues[0]!.id,
        action: "keep-outside"
      }]
    });

    expect(result.profile.resources.skills).toEqual([]);
    const boundaries = JSON.parse(
      await readFile(paths.unmanagedSkillLocationsPath, "utf8")
    ) as Array<{ path: string; targetId?: string; coverage: string }>;
    expect(boundaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: preferredSkill, targetId: "opencode", coverage: "exact" }),
      expect.objectContaining({ path: sharedSkill, targetId: "opencode", coverage: "exact" })
    ]));
    await expect(readFile(join(preferredSkill, "SKILL.md"), "utf8"))
      .resolves.toContain("# Preferred");
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8"))
      .resolves.toContain("# Shared");
  });

  it("rolls back Capture management boundaries when Profile persistence fails", async () => {
    const {
      homeDir,
      paths,
      profileStore,
      skillLibraryStore,
      targetRegistry,
      settingsStore,
      diagnostics
    } = await setup("opencode");
    const preferredSkill = join(homeDir, ".config", "opencode", "skills", "review-helper");
    const sharedSkill = join(homeDir, ".agents", "skills", "review-helper");
    await mkdir(preferredSkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(preferredSkill, "SKILL.md"), "---\nname: review-helper\n---\n# Preferred\n");
    await writeFile(join(sharedSkill, "SKILL.md"), "---\nname: review-helper\n---\n# Shared\n");
    const failingService = createTargetCaptureService({
      paths,
      profileStore: {
        ...profileStore,
        saveProfile: async () => {
          throw new Error("injected Profile save failure");
        }
      },
      targetRegistry,
      skillLibraryStore,
      targetDiscoveryService: discovery("opencode"),
      settingsStore,
      diagnostics
    });
    const preview = await failingService.previewTarget("opencode");
    const policyBeforeCreate = await readFile(paths.unmanagedSkillLocationsPath, "utf8");

    await expect(failingService.createFromTarget({
      previewId: preview.id,
      name: "Failure",
      decisions: [{ issueId: preview.issues[0]!.id, action: "keep-outside" }]
    })).rejects.toThrow("injected Profile save failure");

    await expect(readFile(paths.unmanagedSkillLocationsPath, "utf8"))
      .resolves.toBe(policyBeforeCreate);
  });

  it("captures only Skills for the lightweight Agent management flow", async () => {
    const { homeDir, service } = await setup("opencode");
    const targetDir = join(homeDir, ".config", "opencode");
    const skillDir = join(targetDir, "skills", "review-workflow");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n");
    await writeFile(join(targetDir, "opencode.jsonc"), "{ invalid native config\n");
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: review-workflow\ndescription: Review changes.\n---\n"
    );

    const preview = await service.previewTarget("opencode", "skills");

    expect(preview.scope).toBe("skills");
    expect(preview.resources).toEqual([
      expect.objectContaining({
        kind: "skill",
        id: "review-workflow",
        action: "import"
      })
    ]);

    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "OpenCode Skills"
    });
    expect(result.profile.instructions).toBe("");
    expect(result.profile.resources.managementByTarget?.opencode).toEqual({
      instructions: "ignore",
      skills: "manage"
    });
    expect(result.profile.resources.mcpByTarget.opencode).toEqual({
      mode: "ignore",
      selections: []
    });
  });

  it("includes a readable unmanaged Skill without changing the device path", async () => {
    const { homeDir, service, skillLibraryStore } = await setup("opencode");
    const targetDir = join(homeDir, ".config", "opencode");
    const skillDir = join(targetDir, "skills", "local-reviewer");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n");
    await writeFile(join(targetDir, "opencode.jsonc"), "{}\n");
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: local-reviewer\ndescription: Device copy.\n---\n# Local\n"
    );
    await skillLibraryStore.setUnmanagedSkillLocations({
      items: [{
        path: skillDir,
        targetId: "opencode",
        coverage: "exact"
      }],
      unmanaged: true
    });

    const preview = await service.previewTarget("opencode");

    expect(preview.resources).toContainEqual(expect.objectContaining({
      kind: "skill",
      id: "local-reviewer",
      action: "import",
      detail: expect.stringContaining("leaves the current path unmanaged")
    }));
    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "OpenCode local"
    });
    expect(result.profile.resources.skills).toContainEqual({
      libraryId: "local-reviewer",
      targetName: "local-reviewer",
      enabled: true
    });
    await expect(readFile(join(skillDir, "SKILL.md"), "utf8"))
      .resolves.toContain("# Local");
  });

  it("rejects a stale preview before importing anything", async () => {
    const { homeDir, service, profileStore, paths } = await setup("opencode");
    const targetDir = join(homeDir, ".config", "opencode");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Before\n");
    await writeFile(join(targetDir, "opencode.jsonc"), "{}\n");
    const preview = await service.previewTarget("opencode");
    await writeFile(join(targetDir, "AGENTS.md"), "# Changed\n");

    await expect(service.createFromTarget({ previewId: preview.id, name: "Stale" }))
      .rejects.toThrow("Agent changed after capture preview");
    await expect(profileStore.listProfiles()).resolves.toEqual([]);
    await expect(readFile(paths.skillsLibraryDir)).rejects.toThrow();
  });

  it("restores the Library when Profile creation fails after a Skill import", async () => {
    const {
      homeDir,
      paths,
      profileStore,
      skillLibraryStore,
      targetRegistry,
      settingsStore
    } = await setup("opencode");
    const targetDir = join(homeDir, ".config", "opencode");
    const skillDir = join(targetDir, "skills", "review-workflow");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n");
    await writeFile(join(targetDir, "opencode.jsonc"), "{}\n");
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: review-workflow\n---\n# Original Agent copy\n"
    );
    const failingProfileStore = {
      ...profileStore,
      saveProfile: async () => {
        throw new Error("injected Profile save failure");
      }
    };
    const failingService = createTargetCaptureService({
      paths,
      profileStore: failingProfileStore,
      targetRegistry,
      skillLibraryStore,
      targetDiscoveryService: discovery("opencode"),
      settingsStore
    });
    const preview = await failingService.previewTarget("opencode");

    await expect(
      failingService.createFromTarget({ previewId: preview.id, name: "Failure" })
    ).rejects.toThrow("injected Profile save failure");

    await expect(readFile(join(paths.skillsLibraryDir, "review-workflow", "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(skillDir, "SKILL.md"), "utf8"))
      .resolves.toContain("# Original Agent copy");
    await expect(profileStore.listProfiles()).resolves.toEqual([]);
  });

  it("does not overwrite a Library path changed after Capture imported it", async () => {
    const {
      homeDir,
      paths,
      profileStore,
      skillLibraryStore,
      targetRegistry,
      settingsStore
    } = await setup("opencode");
    const targetDir = join(homeDir, ".config", "opencode");
    const skillDir = join(targetDir, "skills", "review-workflow");
    const librarySkillPath = join(paths.skillsLibraryDir, "review-workflow", "SKILL.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n");
    await writeFile(join(targetDir, "opencode.jsonc"), "{}\n");
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: review-workflow\n---\n# Original Agent copy\n"
    );
    const failingProfileStore = {
      ...profileStore,
      saveProfile: async () => {
        await writeFile(librarySkillPath, "# External Library edit\n");
        throw new Error("injected Profile save failure");
      }
    };
    const failingService = createTargetCaptureService({
      paths,
      profileStore: failingProfileStore,
      targetRegistry,
      skillLibraryStore,
      targetDiscoveryService: discovery("opencode"),
      settingsStore
    });
    const preview = await failingService.previewTarget("opencode");

    await expect(
      failingService.createFromTarget({ previewId: preview.id, name: "Failure" })
    ).rejects.toThrow("changed after Capture wrote it and was left in place");

    await expect(readFile(librarySkillPath, "utf8"))
      .resolves.toBe("# External Library edit\n");
    await expect(readFile(join(skillDir, "SKILL.md"), "utf8"))
      .resolves.toContain("# Original Agent copy");
  });

  it("reuses identical Library Skills and preserves a different same-name version", async () => {
    const { homeDir, service, skillLibraryStore, paths } = await setup("codex");
    const codexDir = join(homeDir, ".codex");
    const existingSource = join(root, "existing");
    const matchingSource = join(root, "matching");
    const targetConflict = join(codexDir, "skills", "internal-cli");
    const targetMatching = join(codexDir, "skills", "matching");
    for (const path of [existingSource, matchingSource, targetConflict, targetMatching]) {
      await mkdir(path, { recursive: true });
    }
    await writeFile(join(codexDir, "AGENTS.md"), "# Codex\n");
    await writeFile(join(codexDir, "config.toml"), "");
    await writeFile(join(existingSource, "SKILL.md"), "---\nname: internal-cli\n---\n# Library\n");
    await writeFile(join(targetConflict, "SKILL.md"), "---\nname: internal-cli\n---\n# Target\n");
    const matching = "---\nname: matching\n---\n# Same\n";
    await writeFile(join(matchingSource, "SKILL.md"), matching);
    await writeFile(join(targetMatching, "SKILL.md"), matching);
    await skillLibraryStore.importSkill({ sourcePath: existingSource, id: "internal-cli" });
    await skillLibraryStore.importSkill({ sourcePath: matchingSource, id: "matching" });

    const preview = await service.previewTarget("codex");
    expect(preview.resources).toContainEqual(expect.objectContaining({
      id: "matching", libraryId: "matching", action: "reuse"
    }));
    expect(preview.resources).toContainEqual(expect.objectContaining({
      id: "internal-cli", libraryId: "codex-internal-cli", action: "import"
    }));

    const result = await service.createFromTarget({ previewId: preview.id, name: "Codex Existing" });
    expect(result.profile.resources.skills).toEqual(expect.arrayContaining([
      { libraryId: "matching", targetName: "matching", enabled: true },
      { libraryId: "codex-internal-cli", targetName: "internal-cli", enabled: true }
    ]));
    await expect(readFile(join(paths.skillsLibraryDir, "internal-cli", "SKILL.md"), "utf8"))
      .resolves.toContain("# Library");
    await expect(readFile(join(paths.skillsLibraryDir, "codex-internal-cli", "SKILL.md"), "utf8"))
      .resolves.toContain("# Target");
  });

  it("captures Claude MCPs as Agent-controlled and leaves the Profile in ignore mode", async () => {
    const { homeDir, service } = await setup("claude-code");
    const claudeDir = join(homeDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "CLAUDE.md"), "# Claude\n");
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ permissions: {} }));
    await writeFile(join(homeDir, ".claude.json"), JSON.stringify({
      mcpServers: { docs: { command: "docs" } }
    }));

    const preview = await service.previewTarget("claude-code");
    expect(preview.resources).toContainEqual(expect.objectContaining({
      kind: "mcp",
      id: "docs",
      detail: "Enabled; remains Agent-controlled"
    }));
    const result = await service.createFromTarget({ previewId: preview.id, name: "Claude Existing" });
    expect(result.profile.resources.mcpByTarget["claude-code"]).toEqual({
      mode: "ignore",
      selections: []
    });
  });

  it("captures recognized Trae V2 MCP activation without owning definitions", async () => {
    const { homeDir, service } = await setup("trae-cli");
    const traeDir = join(homeDir, ".trae");
    await mkdir(join(traeDir, "rules"), { recursive: true });
    await writeFile(
      join(traeDir, "rules", "agentenv-manager.md"),
      "# Trae\n"
    );
    await writeFile(join(traeDir, "traecli.toml"), [
      "[mcp_servers.docs]",
      'command = "docs"',
      "enabled = true",
      ""
    ].join("\n"));

    const preview = await service.previewTarget("trae-cli");
    expect(preview.resources).toContainEqual(expect.objectContaining({
      kind: "mcp",
      id: "docs",
      detail: "Enabled; Profile can control activation"
    }));

    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "Trae Existing"
    });
    expect(result.profile.resources.mcpByTarget["trae-cli"]).toEqual({
      mode: "manage",
      selections: [{ name: "docs", enabled: true }]
    });
  });

  it("captures Pi Instructions and Skills while leaving native settings untouched", async () => {
    const { homeDir, service } = await setup("pi");
    const piDir = join(homeDir, ".pi", "agent");
    const skillDir = join(piDir, "skills", "review-workflow");
    const settings = JSON.stringify({
      defaultProvider: "anthropic",
      packages: ["git:github.com/example/pi-package"]
    }, null, 2);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(piDir, "AGENTS.md"), "# Pi instructions\n");
    await writeFile(join(piDir, "settings.json"), `${settings}\n`);
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: review-workflow\ndescription: Review changes.\n---\n"
    );

    const preview = await service.previewTarget("pi");

    expect(preview.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "instructions", action: "include" }),
      expect.objectContaining({
        kind: "skill",
        id: "review-workflow",
        action: "import"
      })
    ]));
    expect(preview.resources.some(({ kind }) => kind === "mcp")).toBe(false);
    expect(preview.warnings).toContain(
      "Pi settings, authentication, packages, and extensions remain Agent-owned"
    );

    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "Pi Existing"
    });

    expect(result.profile.manifest).toMatchObject({
      iconKey: "pi",
      preferredTargetId: "pi",
      createdFromTargetId: "pi"
    });
    expect(result.profile.instructions).toBe("");
    expect(result.profile.resolvedInstructions).toBe("# Pi instructions\n");
    expect(result.profile.resources.instructions).toEqual([
      { libraryId: expect.any(String), enabled: true }
    ]);
    expect(result.profile.resources.skills).toEqual([
      { libraryId: "review-workflow", targetName: "review-workflow", enabled: true }
    ]);
    expect(result.profile.resources.mcpByTarget.pi).toEqual({
      mode: "ignore",
      selections: []
    });
    await expect(readFile(join(piDir, "settings.json"), "utf8"))
      .resolves.toBe(`${settings}\n`);
  });

  it("warns and skips a broken Trae Skill link without blocking Profile capture", async () => {
    const { homeDir, service } = await setup("trae-cli");
    const traeDir = join(homeDir, ".trae");
    const skillLink = join(traeDir, "skills", "api-mock");
    await mkdir(join(traeDir, "skills"), { recursive: true });
    await writeFile(join(traeDir, "AGENTS.md"), "# Trae\n");
    await symlink("../../.agents/skills/api-mock", skillLink);

    const preview = await service.previewTarget("trae-cli");

    expect(preview.errors).toEqual([]);
    expect(preview.resources).toContainEqual(expect.objectContaining({
      kind: "skill",
      name: "api-mock",
      sourcePath: skillLink,
      action: "exclude",
      detail: "Broken link; skipped"
    }));
    expect(preview.warnings).toContain(
      `Skill api-mock was skipped. Skill link target is unavailable: ${skillLink}`
    );

    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "Trae with broken link"
    });
    expect(result.profile.resources.skills).toEqual([]);
    expect((await lstat(skillLink)).isSymbolicLink()).toBe(true);
  });
});
