import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { createTargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createAntigravityTargetAdapter } from "../../src/main/targets/integrations/antigravity";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { ActivationService } from "../../src/main/activationService";
import type { ProfileStore } from "../../src/main/profileStore";
import type { TargetInfo } from "../../src/shared/types";

let root = "";

const createProfile = async (
  store: ProfileStore,
  variant: "alpha" | "beta"
) => {
  const profile = await store.saveProfile({
    manifest: {
      id: `antigravity-${variant}`,
      targetId: "antigravity",
      name: `Antigravity ${variant}`,
      description: `${variant} switching Profile`,
      version: 1,
      managed: { instructions: true, config: true, assets: true }
    },
    instructions: `# ${variant.toUpperCase()} Antigravity rules\n`,
    configText: '{\n  "mcpServers": {}\n}\n',
    assetPolicy: {
      ownedDirs: [
        { kind: "skill", source: `skills/${variant}`, targetName: `agentenv-${variant}` }
      ],
      ownedFiles: [],
      skillRefs: [],
      mcpRefs: [],
      mcpSelections: [
        {
          targetId: "antigravity",
          name: "native-private",
          enabled: variant === "alpha"
        }
      ],
      disabledSkillPaths: []
    }
  });
  const skillDir = join(profile.profileDir ?? "", "skills", variant);
  await mkdir(skillDir, { recursive: true });
  await writeFile(skillDir + "/SKILL.md", `---\ndescription: ${variant}\n---\n`, "utf8");
  return profile;
};

const apply = async (service: ActivationService, profileId: string) => {
  const preview = await service.previewProfile(profileId, "antigravity");
  expect(preview.errors).toEqual([]);
  const result = await service.applyProfile(profileId, preview.id);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result;
};

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Antigravity Profile switching e2e", () => {
  it("captures an AgentEnv-owned legacy Skill before migrating it to the CLI root", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-capture-legacy-e2e-"));
    const homeDir = join(root, "home");
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir });
    const registry = createTargetRegistry([createAntigravityTargetAdapter()]);
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot: paths.appDataRoot, homeDir }, registry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore, {
      runtimeSnapshotProvider: (targetPaths) =>
        registry.get(targetPaths.targetId).skills.inspectRuntime(targetPaths)
    });
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const targetPaths = registry.get("antigravity").createTargetPaths({ homeDir });
    const legacyPath = join(homeDir, ".gemini", "config", "skills", "legacy-review");
    await mkdir(legacyPath, { recursive: true });
    await writeFile(
      join(legacyPath, "SKILL.md"),
      "---\nname: legacy-review\ndescription: Legacy review\n---\n# Legacy\n"
    );
    await writeFile(
      join(legacyPath, ".agentenv-owner.json"),
      `${JSON.stringify({
        owner: "agentenv-manager",
        profileId: "legacy-profile",
        targetId: "antigravity",
        kind: "skill",
        source: "skills/legacy-review"
      }, null, 2)}\n`
    );
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.instructionsPath, "# Existing Antigravity\n");
    await writeFile(targetPaths.configPath, '{"mcpServers":{}}\n');
    const captureService = createTargetCaptureService({
      paths,
      profileStore,
      targetRegistry: registry,
      skillLibraryStore,
      mcpLibraryStore,
      targetDiscoveryService: {
        listTargets: async () => [
          { id: "antigravity", health: { executableFound: true } } as TargetInfo
        ]
      }
    });

    const capturePreview = await captureService.previewTarget("antigravity");
    expect(capturePreview.resources).toContainEqual(expect.objectContaining({
      kind: "skill",
      name: "legacy-review",
      action: "import"
    }));
    const captured = await captureService.createFromTarget({
      previewId: capturePreview.id,
      name: "Captured Antigravity"
    });
    expect(captured.profile.assetPolicy.skillRefs).toEqual([
      { libraryId: "legacy-review", targetName: "legacy-review" }
    ]);

    const activationService = createActivationService({
      paths,
      profileStore,
      targetRegistry: registry,
      settingsStore,
      skillLibraryStore,
      mcpLibraryStore
    });
    const applyPreview = await activationService.previewProfile(
      captured.profile.id,
      "antigravity"
    );
    expect(applyPreview.errors).toEqual([]);
    expect(applyPreview.resourceChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "remove", path: legacyPath }),
      expect.objectContaining({
        action: "install",
        path: join(targetPaths.skillsDir ?? "", "legacy-review")
      })
    ]));
    const result = await activationService.applyProfile(captured.profile.id, applyPreview.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    await expect(readFile(join(legacyPath, "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(
      readFile(join(targetPaths.skillsDir ?? "", "legacy-review", "SKILL.md"), "utf8")
    ).resolves.toContain("# Legacy");

    await activationService.previewRollback(result.backupId);
    await expect(activationService.rollback(result.backupId)).resolves.toEqual({ ok: true });
    await expect(readFile(join(legacyPath, "SKILL.md"), "utf8")).resolves.toContain("# Legacy");
  });

  it("switches rules and skills while preserving Antigravity-owned MCP definitions", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-e2e-"));
    const homeDir = join(root, "home");
    const binDir = join(root, "bin");
    await mkdir(homeDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const executable = join(binDir, "agy");
    await writeFile(executable, "#!/bin/sh\necho antigravity\n", "utf8");
    await chmod(executable, 0o755);
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir,
      fakeHomeRoot: join(root, "fake-home")
    });
    const registry = createTargetRegistry([createAntigravityTargetAdapter()]);
    const profileStore = createProfileStore(
      { appDataRoot: paths.appDataRoot, homeDir, fakeHomeRoot: paths.fakeHomeRoot },
      registry
    );
    const activationService = createActivationService({ paths, profileStore, targetRegistry: registry });
    const discovery = createTargetDiscoveryService({
      paths,
      targetRegistry: registry,
      pathEnv: binDir,
      platform: "linux"
    });
    const targetPaths = registry.get("antigravity").createTargetPaths({ homeDir });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.instructionsPath, "# Existing rules\n", "utf8");
    await writeFile(
      targetPaths.configPath,
      `${JSON.stringify(
        {
          mcpServers: {
            unmanaged: { serverUrl: "https://example.com/unmanaged" },
            "native-private": {
              command: "node",
              args: ["server.js"],
              env: { API_TOKEN: "private-value" }
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const alpha = await createProfile(profileStore, "alpha");
    const beta = await createProfile(profileStore, "beta");

    await apply(activationService, alpha.id);
    const betaApply = await apply(activationService, beta.id);
    const [target] = await discovery.listTargets();
    const betaConfig = JSON.parse(await readFile(targetPaths.configPath, "utf8"));

    expect(target.health).toEqual(expect.objectContaining({
      status: "ready",
      installationFound: true,
      executableFound: true,
      executablePath: executable
    }));
    await expect(readFile(targetPaths.instructionsPath, "utf8")).resolves.toContain("BETA");
    expect(betaConfig.mcpServers).toEqual({
      unmanaged: { serverUrl: "https://example.com/unmanaged" },
      "native-private": {
        command: "node",
        args: ["server.js"],
        env: { API_TOKEN: "private-value" }
      }
    });
    await expect(
      readFile(join(targetPaths.skillsDir ?? "", "agentenv-beta", "SKILL.md"), "utf8")
    ).resolves.toContain("description: beta");
    await expect(
      readFile(join(targetPaths.skillsDir ?? "", "agentenv-alpha", "SKILL.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });

    const rollbackPreview = await activationService.previewRollback(betaApply.backupId);
    expect(rollbackPreview.errors).toEqual([]);
    await expect(
      activationService.rollback(betaApply.backupId)
    ).resolves.toEqual({ ok: true });
    const alphaConfig = JSON.parse(
      await readFile(targetPaths.configPath, "utf8")
    );
    await expect(
      readFile(targetPaths.instructionsPath, "utf8")
    ).resolves.toContain("ALPHA");
    expect(alphaConfig).toEqual(betaConfig);
  });

  it("warns about missing native MCPs without blocking other Profile resources", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-env-e2e-"));
    const homeDir = join(root, "home");
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir });
    const registry = createTargetRegistry([createAntigravityTargetAdapter()]);
    const profileStore = createProfileStore(
      { appDataRoot: paths.appDataRoot, homeDir },
      registry
    );
    const profile = await profileStore.createProfile({
      targetId: "antigravity",
      name: "Private"
    });
    profile.instructions = "# Still applies\n";
    profile.assetPolicy.mcpSelections = [
      { targetId: "antigravity", name: "private", enabled: true }
    ];
    await profileStore.saveProfile(profile);
    const service = createActivationService({
      paths,
      profileStore,
      targetRegistry: registry
    });

    const preview = await service.previewProfile(profile.id, "antigravity");

    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toContain(
      "MCP server private is not configured in Antigravity; set it up in Antigravity"
    );
    const result = await service.applyProfile(profile.id, preview.id);
    expect(result.ok).toBe(true);
    await expect(
      readFile(join(homeDir, ".gemini", "GEMINI.md"), "utf8")
    ).resolves.toBe("# Still applies\n");
  });

  it("moves AgentEnv-owned legacy Skills to the CLI root and restores both paths on rollback", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-legacy-e2e-"));
    const homeDir = join(root, "home");
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir });
    const registry = createTargetRegistry([createAntigravityTargetAdapter()]);
    const profileStore = createProfileStore({ appDataRoot: paths.appDataRoot, homeDir }, registry);
    const profile = await createProfile(profileStore, "alpha");
    const targetPaths = registry.get("antigravity").createTargetPaths({ homeDir });
    const legacyPath = join(homeDir, ".gemini", "config", "skills", "agentenv-alpha");
    await mkdir(legacyPath, { recursive: true });
    await writeFile(join(legacyPath, "SKILL.md"), "---\nname: agentenv-alpha\n---\n# Legacy\n");
    await writeFile(
      join(legacyPath, ".agentenv-owner.json"),
      `${JSON.stringify({
        owner: "agentenv-manager",
        profileId: profile.id,
        targetId: "antigravity",
        kind: "skill",
        source: "skills/alpha"
      }, null, 2)}\n`
    );
    const service = createActivationService({ paths, profileStore, targetRegistry: registry });

    const preview = await service.previewProfile(profile.id, "antigravity");
    expect(preview.errors).toEqual([]);
    expect(preview.legacySkillPaths).toEqual([legacyPath]);
    expect(preview.resourceChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "remove", path: legacyPath }),
      expect.objectContaining({ action: "install", path: join(targetPaths.skillsDir ?? "", "agentenv-alpha") })
    ]));

    const result = await service.applyProfile(profile.id, preview.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    await expect(readFile(join(legacyPath, "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(targetPaths.skillsDir ?? "", "agentenv-alpha", "SKILL.md"), "utf8"))
      .resolves.toContain("description: alpha");

    const rollbackPreview = await service.previewRollback(result.backupId);
    expect(rollbackPreview.errors).toEqual([]);
    await expect(service.rollback(result.backupId)).resolves.toEqual({ ok: true });
    await expect(readFile(join(legacyPath, "SKILL.md"), "utf8"))
      .resolves.toContain("# Legacy");
  });
});
