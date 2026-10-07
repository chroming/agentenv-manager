import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createAntigravityAppTargetAdapter } from "../../src/main/targets/integrations/antigravity-app";
import { createTargetRegistry } from "../../src/main/targets/registry";
import { blockingMessages } from "../helpers/applyIssues";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Antigravity App deployment directory", () => {
  it("repairs an old deployment through Preview/Apply without changing Gemini or CLI copies", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-app-e2e-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const profileStore = createProfileStore({ appDataRoot: paths.appDataRoot, homeDir: paths.homeDir });
    const settingsStore = createSettingsStore(paths);
    await settingsStore.updateSettings({ enabledTargetIds: ["antigravity-app"], skillSyncMethod: "copy" });
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    const skillContent = "---\nname: reviewer\ndescription: Review changes\n---\n# Reviewer\n";
    await writeFile(join(source, "SKILL.md"), skillContent);
    await skillLibraryStore.importSkill({ sourcePath: source, id: "reviewer" });
    const profile = await profileStore.saveProfile({
      manifest: { id: "daily", name: "Daily", description: "", preferredTargetId: "codex", version: 2 },
      instructions: "# Guidance\n",
      resources: { skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: true }], mcpByTarget: {} }
    });
    const adapter = createAntigravityAppTargetAdapter();
    const legacyService = createActivationService({
      paths, profileStore, settingsStore, skillLibraryStore,
      targetRegistry: createTargetRegistry([{
        ...adapter,
        createTargetPaths: (input) => {
          const targetPaths = adapter.createTargetPaths(input);
          const skillsDir = join(paths.homeDir, ".gemini", "skills");
          return { ...targetPaths, skillsDir, skillLocations: [{
            path: skillsDir, role: "preferred-runtime", shared: false,
            scope: "user", scanDepth: "direct", management: "managed"
          }], skillScanDirs: [skillsDir] };
        }
      }])
    });
    const originalPreview = await legacyService.previewProfile(profile.id, "antigravity-app");
    expect((await legacyService.applyProfile(profile.id, originalPreview.id)).ok).toBe(true);
    const geminiSkill = join(paths.homeDir, ".gemini", "skills", "reviewer", "SKILL.md");
    const appSkill = join(paths.homeDir, ".gemini", "config", "skills", "reviewer", "SKILL.md");
    const cliSkill = join(paths.homeDir, ".gemini", "antigravity-cli", "skills", "reviewer", "SKILL.md");
    await mkdir(dirname(cliSkill), { recursive: true });
    await writeFile(cliSkill, "# CLI-owned copy\n");
    const nativeConfigs = [
      adapter.createTargetPaths({ homeDir: paths.homeDir }).configPath,
      join(paths.homeDir, ".gemini", "config", "config.json")
    ];
    const nativeConfigContent = '{"fixture":"Agent-owned"}\n';
    for (const path of nativeConfigs) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, nativeConfigContent);
    }
    const service = createActivationService({ paths, profileStore, settingsStore, skillLibraryStore });

    expect((await service.listTargetStates())[0].lifecycleStatus).toBe("pending");
    const preview = await service.previewProfile(profile.id, "antigravity-app");
    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.resourceChanges).toContainEqual(expect.objectContaining({
      kind: "skill", action: "install", path: dirname(appSkill)
    }));
    expect(preview.resourceChanges.some((change) => change.action === "remove")).toBe(false);
    await expect(readFile(appSkill, "utf8")).rejects.toThrow();
    expect((await service.applyProfile(profile.id, preview.id)).ok).toBe(true);
    expect(await readFile(appSkill, "utf8")).toBe(skillContent);
    expect(await readFile(geminiSkill, "utf8")).toBe(skillContent);
    expect(await readFile(cliSkill, "utf8")).toBe("# CLI-owned copy\n");
    expect((await service.listTargetStates())[0].lifecycleStatus).toBe("applied");
    const noOp = await service.previewProfile(profile.id, "antigravity-app");
    expect(noOp.changes).toEqual([]);
    expect(noOp.resourceChanges).toEqual([]);
    const runtime = await adapter.skills.inspectRuntime(adapter.createTargetPaths({ homeDir: paths.homeDir }));
    expect(runtime.observations.filter((item) => item.availability === "enabled")
      .map((item) => item.path)).toEqual([dirname(appSkill)]);

    const saved = await profileStore.readProfile(profile.id);
    await profileStore.saveProfile({ ...saved, expectedContentHash: saved.contentHash,
      resources: { ...saved.resources, skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: false }] }
    });
    const disabled = await service.previewProfile(profile.id, "antigravity-app");
    expect(blockingMessages(disabled.issues)).toEqual([]);
    expect((await service.applyProfile(profile.id, disabled.id)).ok).toBe(true);
    await expect(readFile(appSkill, "utf8")).rejects.toThrow();
    expect(await readFile(geminiSkill, "utf8")).toBe(skillContent);
    expect(await readFile(cliSkill, "utf8")).toBe("# CLI-owned copy\n");
    for (const path of nativeConfigs) expect(await readFile(path, "utf8")).toBe(nativeConfigContent);
  });
});
