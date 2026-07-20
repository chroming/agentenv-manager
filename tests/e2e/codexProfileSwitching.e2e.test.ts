import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createTargetCaptureService } from "../../src/main/targetCaptureService";
import type { TargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { TargetInfo } from "../../src/shared/types";
import { createCaptureReceiptStore } from "../../src/main/captureReceiptStore";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Codex Profile v2 switching e2e", () => {
  it("switches portable resources and preserves unrelated config.toml keys", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-v2-e2e-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const profileStore = createProfileStore({ appDataRoot: paths.appDataRoot, homeDir: paths.homeDir });
    const settingsStore = createSettingsStore(paths);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    for (const id of ["alpha", "beta"]) {
      const source = join(root, "sources", id);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "SKILL.md"), `---\nname: ${id}\n---\n# ${id}\n`);
      await skillLibraryStore.importSkill({ sourcePath: source, id });
      await profileStore.saveProfile({
        manifest: { id, name: id, description: "", preferredTargetId: "codex", version: 2 },
        instructions: `# ${id.toUpperCase()}\n`,
        resources: {
          skills: [{ libraryId: id, targetName: id, enabled: true }],
          mcpByTarget: {
            codex: {
              mode: "manage",
              selections: [
                { name: "alpha", enabled: id === "alpha" },
                { name: "beta", enabled: id === "beta" }
              ]
            }
          }
        }
      });
    }
    await mkdir(paths.codexHome, { recursive: true });
    await writeFile(paths.globalAgentsPath, "# Before\n");
    await writeFile(paths.codexConfigPath, [
      'model = "gpt-5"',
      'approval_policy = "on-request"',
      "",
      "[mcp_servers.alpha]", 'command = "alpha"', "enabled = false",
      "",
      "[mcp_servers.beta]", 'command = "beta"', "enabled = true", ""
    ].join("\n"));
    const service = createActivationService({ paths, profileStore, settingsStore, skillLibraryStore });

    for (const id of ["alpha", "beta"] as const) {
      const preview = await service.previewProfile(id, "codex");
      expect(preview.errors).toEqual([]);
      expect((await service.applyProfile(id, preview.id)).ok).toBe(true);
    }

    expect(await readFile(paths.globalAgentsPath, "utf8")).toBe("# BETA\n");
    const config = await readFile(paths.codexConfigPath, "utf8");
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain('approval_policy = "on-request"');
    expect(config.match(/enabled = false/g)).toHaveLength(1);
    expect(config.match(/enabled = true/g)).toHaveLength(1);
    await expect(readFile(join(paths.codexHome, "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(paths.codexHome, "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");
  });

  it("takes over an exact captured Codex Skill copy while preserving its shared copy", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-capture-takeover-e2e-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home")
    });
    const targetRegistry = createTargetRegistry();
    const profileStore = createProfileStore(
      { appDataRoot: paths.appDataRoot, homeDir: paths.homeDir },
      targetRegistry
    );
    const settingsStore = createSettingsStore(paths);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const activationService = createActivationService({
      paths,
      profileStore,
      settingsStore,
      skillLibraryStore,
      targetRegistry
    });
    const captureService = createTargetCaptureService({
      paths,
      profileStore,
      skillLibraryStore,
      targetRegistry,
      targetDiscoveryService: {
        listTargets: async () => [
          { id: "codex", health: { executableFound: true } } as TargetInfo
        ]
      } satisfies TargetDiscoveryService
    });
    const skillId = "k8s-ops";
    const skillContent =
      "---\nname: k8s-ops\ndescription: Captured operations workflow.\n---\n\n# K8s Ops\n";
    const privateSkill = join(paths.codexHome, "skills", skillId);
    const sharedSkill = join(paths.userSkillsDir, skillId);
    await mkdir(privateSkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(privateSkill, "SKILL.md"), skillContent, "utf8");
    await writeFile(join(sharedSkill, "SKILL.md"), skillContent, "utf8");
    await writeFile(paths.globalAgentsPath, "# Captured Codex\n", "utf8");
    await writeFile(paths.codexConfigPath, "model = \"gpt-5\"\n", "utf8");

    const capturePreview = await captureService.previewTarget("codex");
    expect(capturePreview.errors).toEqual([]);
    expect(capturePreview.resources).toContainEqual(
      expect.objectContaining({
        kind: "skill",
        id: skillId,
        action: "import",
        detail: "2 source copies stay unchanged"
      })
    );
    const captured = await captureService.createFromTarget({
      previewId: capturePreview.id,
      name: "Captured Codex"
    });
    const captureReceiptStore = createCaptureReceiptStore(paths);
    await expect(captureReceiptStore.read(captured.profile.id, "codex")).resolves.toEqual(
      expect.objectContaining({
        profileId: captured.profile.id,
        targetId: "codex",
        skills: [
          expect.objectContaining({
            libraryId: skillId,
            copies: expect.arrayContaining([
              expect.objectContaining({ path: privateSkill }),
              expect.objectContaining({ path: sharedSkill })
            ])
          })
        ]
      })
    );

    const applyPreview = await activationService.previewProfile(captured.profile.id, "codex");
    expect(applyPreview.errors).toEqual([]);
    expect(applyPreview.resourceChanges).toContainEqual(
      expect.objectContaining({
        kind: "skill",
        action: "replace",
        name: skillId,
        path: privateSkill
      })
    );
    const applied = await activationService.applyProfile(
      captured.profile.id,
      applyPreview.id
    );
    if (!applied.ok) throw new Error(applied.errors.join("; "));
    await expect(captureReceiptStore.read(captured.profile.id, "codex"))
      .resolves.toBeUndefined();

    expect((await lstat(privateSkill)).isSymbolicLink()).toBe(true);
    await expect(readFile(`${privateSkill}.agentenv-owner.json`, "utf8"))
      .resolves.toContain(`"source": "skills-library/${skillId}"`);
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8"))
      .resolves.toBe(skillContent);
    await expect(readFile(join(sharedSkill, ".agentenv-owner.json"), "utf8"))
      .rejects.toThrow();

    const stablePreview = await activationService.previewProfile(
      captured.profile.id,
      "codex"
    );
    expect(stablePreview.errors).toEqual([]);
    expect(stablePreview.changes).toEqual([]);
    expect(stablePreview.resourceChanges).toEqual([]);
    expect(stablePreview.sharedSkillPreparationChanged).toBe(false);

    const rollbackPreview = await activationService.previewRollback(applied.backupId);
    expect(rollbackPreview.errors).toEqual([]);
    expect((await activationService.rollback(applied.backupId)).ok).toBe(true);
    expect((await lstat(privateSkill)).isDirectory()).toBe(true);
    await expect(readFile(join(privateSkill, "SKILL.md"), "utf8"))
      .resolves.toBe(skillContent);
    await expect(readFile(`${privateSkill}.agentenv-owner.json`, "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8"))
      .resolves.toBe(skillContent);

    await writeFile(join(privateSkill, "SKILL.md"), "# Changed after capture\n", "utf8");
    const changedPreview = await activationService.previewProfile(
      captured.profile.id,
      "codex"
    );
    expect(changedPreview.errors).toContainEqual(
      expect.stringContaining(`${privateSkill} is occupied by a non-AgentEnv Skill`)
    );
    expect((await lstat(privateSkill)).isDirectory()).toBe(true);
    await expect(readFile(join(privateSkill, "SKILL.md"), "utf8"))
      .resolves.toBe("# Changed after capture\n");
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8"))
      .resolves.toBe(skillContent);
  });
});
